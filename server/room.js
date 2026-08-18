import { randomUUID } from 'node:crypto';

import { checkPassword, hashPassword } from './tokens.js';

const NAME_MAX = 24;
const CHAT_MAX = 800;
const PINNED_MAX = 200;
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');
const STATUSES = new Set(['ativo', 'ausente', 'ocupado']);
/** Janela pra reconectar sem sair da toca: o card fica "reconectando" e volta. */
const RESUME_MS = 15_000;
/** SDP de uma call com 4 transceivers não passa disso nem de longe. */
const SDP_MAX = 64 * 1024;

export const clean = (value, max = NAME_MAX) =>
  typeof value === 'string' ? value.replace(CONTROL_CHARS, '').trim().slice(0, max) : '';

/** Nome repetido vira "Fred (2)" em vez de duas pessoas indistinguíveis. */
function uniqueName(wanted, taken) {
  const base = clean(wanted) || 'Anônimo';
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const tentative = `${base} (${i})`;
    if (!taken.has(tentative)) return tentative;
  }
  return `${base} (${randomUUID().slice(0, 4)})`;
}

const publicPeer = (peer) => ({
  id: peer.id,
  name: peer.name,
  avatar: peer.avatar,
  color: peer.color,
  pronouns: peer.pronouns,
  status: peer.status,
  watching: peer.watching,
  pending: peer.pending,
  forcedMute: peer.forcedMute,
  muted: peer.muted,
  sharing: peer.sharing,
  camera: peer.camera,
  hasMic: peer.hasMic,
  hand: peer.hand,
  role: peer.role,
});

/**
 * Uma toca. Guarda presença, papéis e o chat da sessão — nada além do que está
 * acontecendo agora. Mídia nunca passa por aqui: o servidor só relaya SDP/ICE.
 */
export class Room {
  peers = new Map();
  waiting = new Map();
  waitingEnabled = false;
  blocked = new Set();
  pinned = null;
  locked = false;
  passwordHash = null;
  ownerKey = null;

  /**
   * @param {object} options
   * @param {string} options.slug endereço da sala na URL
   * @param {string} options.name nome exibido
   * @param {boolean} [options.ephemeral] some sozinha quando esvazia
   * @param {number} [options.maxPeers] teto de gente simultânea
   * @param {number} [options.opensAt] timestamp em ms; antes disso ninguém entra
   * @param {number} [options.maxBitrate] teto de vídeo que a toca inteira respeita
   */
  constructor({ slug, name, ephemeral = true, maxPeers = 12, opensAt = 0, maxBitrate = 0 }) {
    this.maxBitrate = maxBitrate;
    this.slug = slug;
    this.name = name;
    this.ephemeral = ephemeral;
    this.maxPeers = maxPeers;
    this.opensAt = opensAt;
    this.createdAt = Date.now();
    this.emptySince = Date.now();
  }

  get size() {
    return this.peers.size;
  }

  get needsPassword() {
    return Boolean(this.passwordHash);
  }

  get info() {
    return {
      slug: this.slug,
      name: this.name,
      locked: this.locked,
      needsPassword: this.needsPassword,
      waitingEnabled: this.waitingEnabled,
      ephemeral: this.ephemeral,
      maxPeers: this.maxPeers,
      opensAt: this.opensAt,
      maxBitrate: this.maxBitrate,
      pinned: this.pinned,
      count: this.size,
    };
  }

  /**
   * @param {{ password?: string, ownerKey?: string|null, invited?: boolean }} pedido
   * @returns {{code: string, detail?: object}|null} motivo da recusa, ou null se pode entrar
   */
  denyReason({ password, ownerKey, invited }) {
    const isOwner = Boolean(this.ownerKey) && this.ownerKey === ownerKey;

    if (this.opensAt && Date.now() < this.opensAt && !isOwner) {
      return { code: 'not-open', detail: { opensAt: this.opensAt } };
    }
    if (ownerKey && this.blocked.has(ownerKey)) return { code: 'blocked' };
    if (this.size >= this.maxPeers) return { code: 'room-full', detail: { max: this.maxPeers } };
    if (this.locked && !isOwner) return { code: 'locked' };
    // Convite assinado vale como senha: quem recebeu o link já foi autorizado.
    if (this.needsPassword && !isOwner && !invited && !checkPassword(this.passwordHash, password ?? '')) {
      return { code: 'bad-password' };
    }
    return null;
  }

  /**
   * @param {any} ws
   * @param {{ name?: string, avatar?: string, color?: string, pronouns?: string,
   *           ownerKey?: string|null, hasMic?: boolean, muted?: boolean }} dados
   */
  add(ws, { name, avatar, color, pronouns, ownerKey, hasMic, muted }) {
    const peer = {
      id: randomUUID(),
      ownerKey,
      name: uniqueName(name, new Set([...this.peers.values()].map((p) => p.name))),
      avatar: clean(avatar, 8),
      color: clean(color, 16),
      pronouns: clean(pronouns, 16),
      status: 'ativo',
      muted: Boolean(muted),
      sharing: false,
      camera: false,
      hasMic: hasMic !== false,
      hand: false,
      watching: null,
      pending: false,
      dropTimer: null,
      forcedMute: false,
      role: 'guest',
      ws,
    };

    // Quem cria a toca fica dono; se o dono voltar com a mesma chave, reassume.
    if (!this.ownerKey || this.ownerKey === ownerKey) {
      this.ownerKey = ownerKey;
      peer.role = 'owner';
    }

    this.peers.set(peer.id, peer);
    this.emptySince = 0;
    return peer;
  }

  /** Conexão caiu sem avisar: segura a vaga por alguns segundos antes de tirar. */
  detach(id) {
    const peer = this.peers.get(id);
    if (!peer || peer.pending) return;

    peer.pending = true;
    peer.ws = null;
    peer.dropTimer = setTimeout(() => this.drop(id), RESUME_MS);
    peer.dropTimer.unref?.();
    this.broadcast({ type: 'peer-state', id, pending: true });
  }

  /** Voltou a tempo: mesma pessoa, mesmo id, ninguém viu "fulano saiu". */
  reattach(id, ws, ownerKey) {
    const peer = this.peers.get(id);
    if (!peer || !peer.pending || !ownerKey || peer.ownerKey !== ownerKey) return null;

    clearTimeout(peer.dropTimer);
    peer.dropTimer = null;
    peer.pending = false;
    peer.ws = ws;
    this.broadcast({ type: 'peer-state', id, pending: false });
    return peer;
  }

  drop(id) {
    const peer = this.remove(id);
    if (peer) this.broadcast({ type: 'peer-left', id });
    return peer;
  }

  remove(id) {
    const peer = this.peers.get(id);
    if (!peer) return null;

    clearTimeout(peer.dropTimer);
    this.peers.delete(id);

    // Toca vazia volta ao estado de fábrica: sem dono, sem tranca, sem senha.
    // Sem isso a toca fixa ficaria dona de alguém que foi embora faz três dias.
    if (!this.peers.size) {
      this.emptySince = Date.now();
      this.ownerKey = null;
      this.locked = false;
      this.passwordHash = null;
      this.waitingEnabled = false;
      this.pinned = null;
      this.blocked.clear();
    }

    // O bastão de dono passa pra quem estiver há mais tempo na sala.
    if (peer.role === 'owner') {
      const next = this.peers.values().next().value;
      if (next) {
        next.role = 'owner';
        this.ownerKey = next.ownerKey;
        this.broadcast({ type: 'peer-state', id: next.id, role: 'owner' });
      }
    }
    return peer;
  }

  canModerate(peer) {
    return peer?.role === 'owner' || peer?.role === 'mod';
  }

  /** Fila de espera: quem chega fica visível só pra quem modera, até ser aceito. */
  addToWaiting(entry) {
    this.waiting.set(entry.id, entry);
    this.notifyWaiting();
  }

  removeFromWaiting(id) {
    const entry = this.waiting.get(id);
    this.waiting.delete(id);
    this.notifyWaiting();
    return entry;
  }

  notifyWaiting() {
    const people = [...this.waiting.values()].map(({ id, name }) => ({ id, name }));
    for (const peer of this.peers.values()) {
      if (this.canModerate(peer)) this.send(peer.ws, { type: 'waiting-list', people });
    }
  }

  setPassword(password) {
    this.passwordHash = password ? hashPassword(password) : null;
  }

  /** Só repassa o que o handshake precisa — nada de payload arbitrário entre clientes. */
  relaySignal(from, msg) {
    const to = typeof msg.to === 'string' ? this.peers.get(msg.to) : null;
    if (!to || !msg.data || typeof msg.data !== 'object') return;

    const { description, candidate } = msg.data;
    if (!description && !candidate) return;
    if (description && JSON.stringify(description).length > SDP_MAX) return;

    this.send(to.ws, { type: 'signal', from: from.id, data: { description, candidate } });
  }

  updateState(peer, msg) {
    const changed = { type: 'peer-state', id: peer.id };

    if (typeof msg.muted === 'boolean' && !peer.forcedMute) changed.muted = peer.muted = msg.muted;
    if (typeof msg.sharing === 'boolean') changed.sharing = peer.sharing = msg.sharing;
    if (typeof msg.camera === 'boolean') changed.camera = peer.camera = msg.camera;
    if (typeof msg.hasMic === 'boolean') changed.hasMic = peer.hasMic = msg.hasMic;
    if (typeof msg.hand === 'boolean') changed.hand = peer.hand = msg.hand;
    if (msg.watching === null || typeof msg.watching === 'string') changed.watching = peer.watching = msg.watching;
    if (typeof msg.status === 'string' && STATUSES.has(msg.status)) changed.status = peer.status = msg.status;

    this.broadcast(changed);
  }

  chat(peer, text) {
    const body = clean(text, CHAT_MAX);
    if (!body) return;
    this.broadcast({ type: 'chat', from: peer.id, name: peer.name, text: body, at: Date.now() });
  }

  pin(text) {
    this.pinned = text ? clean(text, PINNED_MAX) : null;
    this.broadcast({ type: 'pinned', text: this.pinned });
  }

  roster() {
    return [...this.peers.values()].map(publicPeer);
  }

  broadcast(msg, exceptId) {
    for (const peer of this.peers.values()) {
      if (peer.id !== exceptId) this.send(peer.ws, msg);
    }
  }

  send(ws, msg) {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}

export { publicPeer };
