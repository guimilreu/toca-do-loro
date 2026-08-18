import { randomUUID } from 'node:crypto';

const NAME_MAX = 24;
/** Janela de rate limit por conexão: mensagens permitidas a cada RATE_WINDOW_MS. */
const RATE_LIMIT = 300;
const RATE_WINDOW_MS = 10_000;

const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

const sanitizeName = (value) =>
  typeof value === 'string' ? value.replace(CONTROL_CHARS, '').trim().slice(0, NAME_MAX) : '';

const publicPeer = ({ id, name, muted, sharing, hasMic }) => ({ id, name, muted, sharing, hasMic });

/**
 * Sala única. Guarda apenas presença — nenhuma mídia passa pelo servidor,
 * que só relaya SDP/ICE entre os pares (mesh P2P).
 */
export class Room {
  #peers = new Map();
  #lobby = new Set();

  constructor({ name, maxPeers, iceServers }) {
    this.name = name;
    this.maxPeers = maxPeers;
    this.iceServers = iceServers;
  }

  get size() {
    return this.#peers.size;
  }

  attach(ws) {
    ws.isAlive = true;
    ws.peerId = null;
    ws.rate = { count: 0, since: Date.now() };
    this.#lobby.add(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('message', (raw) => this.#onMessage(ws, raw));
    ws.on('close', () => this.#onClose(ws));
    ws.on('error', () => ws.terminate());

    this.#send(ws, { type: 'hello', room: this.name, count: this.size, maxPeers: this.maxPeers });
  }

  #onMessage(ws, raw) {
    const now = Date.now();
    if (now - ws.rate.since > RATE_WINDOW_MS) ws.rate = { count: 0, since: now };
    if (++ws.rate.count > RATE_LIMIT) {
      this.#send(ws, { type: 'error', code: 'rate-limited' });
      ws.close(1008, 'rate limited');
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'join':
        return this.#onJoin(ws, msg);
      case 'signal':
        return this.#onSignal(ws, msg);
      case 'state':
        return this.#onState(ws, msg);
      case 'ping':
        return this.#send(ws, { type: 'pong' });
      default:
    }
  }

  #onJoin(ws, msg) {
    if (ws.peerId) return;

    if (this.size >= this.maxPeers) {
      this.#send(ws, { type: 'error', code: 'room-full', max: this.maxPeers });
      return;
    }

    const peer = {
      id: randomUUID(),
      name: sanitizeName(msg.name) || 'Anônimo',
      muted: Boolean(msg.muted),
      sharing: false,
      hasMic: msg.hasMic !== false,
      ws,
    };

    this.#lobby.delete(ws);
    ws.peerId = peer.id;
    this.#peers.set(peer.id, peer);

    this.#send(ws, {
      type: 'welcome',
      self: publicPeer(peer),
      room: this.name,
      iceServers: this.iceServers,
      peers: [...this.#peers.values()].filter((p) => p.id !== peer.id).map(publicPeer),
    });
    this.#broadcast({ type: 'peer-joined', peer: publicPeer(peer) }, peer.id);
    this.#updateLobby();
  }

  #onSignal(ws, msg) {
    const from = this.#peers.get(ws.peerId);
    const to = typeof msg.to === 'string' ? this.#peers.get(msg.to) : null;
    if (!from || !to || !msg.data || typeof msg.data !== 'object') return;

    // Só repassa o que o handshake precisa — nada de payload arbitrário entre clientes.
    const { description, candidate } = msg.data;
    if (!description && !candidate) return;

    this.#send(to.ws, { type: 'signal', from: from.id, data: { description, candidate } });
  }

  #onState(ws, msg) {
    const peer = this.#peers.get(ws.peerId);
    if (!peer) return;

    if (typeof msg.muted === 'boolean') peer.muted = msg.muted;
    if (typeof msg.sharing === 'boolean') peer.sharing = msg.sharing;
    if (typeof msg.hasMic === 'boolean') peer.hasMic = msg.hasMic;

    this.#broadcast(
      { type: 'peer-state', id: peer.id, muted: peer.muted, sharing: peer.sharing, hasMic: peer.hasMic },
      peer.id,
    );
  }

  #onClose(ws) {
    this.#lobby.delete(ws);
    const peer = this.#peers.get(ws.peerId);
    if (!peer) return;

    this.#peers.delete(peer.id);
    this.#broadcast({ type: 'peer-left', id: peer.id });
    this.#updateLobby();
  }

  /** Marca conexões mortas (sem pong) para o heartbeat derrubar. */
  sweep() {
    const sockets = [...this.#lobby, ...[...this.#peers.values()].map((p) => p.ws)];
    for (const ws of sockets) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }

  #updateLobby() {
    for (const ws of this.#lobby) this.#send(ws, { type: 'lobby', count: this.size });
  }

  #broadcast(msg, exceptId) {
    for (const peer of this.#peers.values()) {
      if (peer.id !== exceptId) this.#send(peer.ws, msg);
    }
  }

  #send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}
