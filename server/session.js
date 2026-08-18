import { randomUUID } from 'node:crypto';

import { clean } from './room.js';
import { createInvite, readInvite } from './tokens.js';
import { toSlug } from './rooms.js';

/** Janela de rate limit por conexão. */
const RATE_LIMIT = 300;
const RATE_WINDOW_MS = 10_000;
const REACTIONS = new Set(['👏', '😂', '❤️', '🔥', '👍', '🎉', '🦜', '😮']);
/** A soundboard não trafega áudio: manda o nome do som e cada um sintetiza. */
const SOUNDS = new Set(['palmas', 'buzina', 'tambor', 'triste', 'grilo', 'loro']);

/**
 * Uma conexão. Nasce no saguão (sem sala), entra numa toca e some quando cai.
 * Toda mensagem do cliente passa por aqui antes de tocar em qualquer sala.
 */
export class Session {
  room = null;
  peer = null;

  constructor(ws, { rooms, iceServers, version, onLobbyChange, canJoin }) {
    this.ws = ws;
    this.rooms = rooms;
    this.iceServers = iceServers;
    this.version = version;
    this.onLobbyChange = onLobbyChange;
    this.canJoin = canJoin ?? (() => true);
    this.rate = { count: 0, since: Date.now() };

    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (raw) => this.onMessage(raw));
    // Fechamento com frame de encerramento é gente saindo; 1006 é a conexão
    // morrendo sem avisar, e só esse caso merece a janela de retomada.
    ws.on('close', (code) => this.leave({ graceful: code !== 1006 }));
    ws.on('error', () => ws.terminate());

    this.send({ type: 'hello', version, rooms: rooms.active(), defaultSlug: rooms.defaultSlug });
  }

  onMessage(raw) {
    const now = Date.now();
    if (now - this.rate.since > RATE_WINDOW_MS) this.rate = { count: 0, since: now };
    if (++this.rate.count > RATE_LIMIT) {
      this.send({ type: 'error', code: 'rate-limited' });
      this.ws.close(1008, 'rate limited');
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    HANDLERS[msg.type]?.(this, msg);
  }

  /* ---------- entrada e saída ---------- */

  join(msg) {
    if (this.peer) return;

    // Reconexão: se a vaga ainda está segurada, volta pro mesmo lugar.
    if (msg.resume) {
      const room = this.rooms.get(toSlug(msg.slug));
      const peer = room?.reattach(msg.resume, this.ws, clean(msg.clientId, 64));
      if (peer) {
        this.room = room;
        this.peer = peer;
        const roster = room.roster();
        this.send({
          type: 'welcome',
          resumed: true,
          self: roster.find((p) => p.id === peer.id),
          room: room.info,
          peers: roster.filter((p) => p.id !== peer.id),
          iceServers: this.iceServers(),
          version: this.version,
          invite: createInvite(room.slug),
        });
        return;
      }
    }
    if (!this.canJoin()) {
      this.send({ type: 'error', code: 'too-many-joins' });
      return;
    }

    const invite = readInvite(msg.token);
    const slug = toSlug(invite?.slug || msg.slug) || this.rooms.defaultSlug;
    const room = this.rooms.get(slug, { name: clean(msg.roomName) || slug });
    if (!room) {
      this.send({ type: 'error', code: 'too-many-rooms' });
      return;
    }

    const ownerKey = clean(msg.clientId, 64) || null;
    const denied = room.denyReason({ password: msg.password, ownerKey, invited: Boolean(invite) });
    if (denied) {
      this.send({ type: 'error', code: denied.code, slug, ...denied.detail });
      return;
    }

    // Fila de espera: só entra depois que alguém da moderação aceitar.
    const isOwner = Boolean(ownerKey) && room.ownerKey === ownerKey;
    if (room.waitingEnabled && !isOwner && !invite && !msg.approved && room.size > 0) {
      this.waitingId = randomUUID();
      this.waitingRoom = room;
      this.pendingJoin = msg;
      room.addToWaiting({ id: this.waitingId, name: clean(msg.name) || 'Anônimo', session: this });
      this.send({ type: 'waiting', room: room.info });
      return;
    }

    this.room = room;
    this.peer = room.add(this.ws, {
      name: msg.name,
      avatar: msg.avatar,
      color: msg.color,
      pronouns: msg.pronouns,
      hasMic: msg.hasMic,
      muted: msg.muted,
      ownerKey,
    });

    const roster = room.roster();
    this.send({
      type: 'welcome',
      self: roster.find((p) => p.id === this.peer.id),
      room: room.info,
      peers: roster.filter((p) => p.id !== this.peer.id),
      iceServers: this.iceServers(),
      version: this.version,
      invite: createInvite(room.slug),
    });
    room.broadcast({ type: 'peer-joined', peer: roster.find((p) => p.id === this.peer.id) }, this.peer.id);
    this.onLobbyChange();
  }

  leave({ graceful = true } = {}) {
    if (this.waitingRoom) {
      this.waitingRoom.removeFromWaiting(this.waitingId);
      this.waitingRoom = null;
      this.waitingId = null;
    }
    if (!this.room || !this.peer) return;

    const { room, peer } = this;
    this.room = null;
    this.peer = null;
    if (graceful) room.drop(peer.id);
    else room.detach(peer.id);
    this.onLobbyChange();
  }

  /* ---------- moderação ---------- */

  moderate(msg) {
    const room = this.room;
    if (!room || !room.canModerate(this.peer)) {
      this.send({ type: 'error', code: 'not-allowed' });
      return;
    }

    const target = typeof msg.target === 'string' ? room.peers.get(msg.target) : null;
    const action = MODERATION[msg.action];
    if (action) action(room, this.peer, target, msg);
  }

  configure(msg) {
    const room = this.room;
    if (!room || !room.canModerate(this.peer)) {
      this.send({ type: 'error', code: 'not-allowed' });
      return;
    }

    switch (msg.action) {
      case 'lock':
        room.locked = Boolean(msg.value);
        break;
      case 'password':
        room.setPassword(clean(msg.value, 64));
        break;
      case 'rename':
        room.name = clean(msg.value) || room.name;
        break;
      case 'limit':
        room.maxPeers = Math.max(2, Math.min(24, Number(msg.value) || room.maxPeers));
        break;
      case 'waiting':
        room.waitingEnabled = Boolean(msg.value);
        break;
      case 'schedule':
        room.opensAt = Math.max(0, Number(msg.value) || 0);
        break;
      case 'pin':
        room.pin(msg.value);
        return;
      default:
        return;
    }

    room.broadcast({ type: 'room-info', room: room.info });
    this.onLobbyChange();
  }

  send(msg) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

/** Cada ação de moderação recebe (sala, quem pediu, alvo, mensagem). */
const MODERATION = {
  kick(room, actor, target) {
    if (!target || target.id === actor.id) return;
    room.send(target.ws, { type: 'kicked', by: actor.name, blocked: false });
    target.ws.close(4001, 'kicked');
  },

  block(room, actor, target) {
    if (!target || target.id === actor.id) return;
    if (target.ownerKey) room.blocked.add(target.ownerKey);
    room.send(target.ws, { type: 'kicked', by: actor.name, blocked: true });
    target.ws.close(4001, 'blocked');
  },

  mute(room, actor, target, msg) {
    if (!target) return;
    target.forcedMute = Boolean(msg.value);
    if (target.forcedMute) target.muted = true;
    room.send(target.ws, { type: 'forced', muted: target.forcedMute, by: actor.name });
    room.broadcast({ type: 'peer-state', id: target.id, muted: target.muted, forcedMute: target.forcedMute });
  },

  'mute-all'(room, actor) {
    for (const other of room.peers.values()) {
      if (other.id === actor.id || other.role === 'owner') continue;
      other.forcedMute = true;
      other.muted = true;
      room.send(other.ws, { type: 'forced', muted: true, by: actor.name });
      room.broadcast({ type: 'peer-state', id: other.id, muted: true, forcedMute: true });
    }
  },

  'stop-screen'(room, actor, target) {
    if (!target) return;
    room.send(target.ws, { type: 'forced', sharing: false, by: actor.name });
  },

  promote(room, actor, target) {
    if (!target || actor.role !== 'owner') return;
    target.role = target.role === 'mod' ? 'guest' : 'mod';
    room.broadcast({ type: 'peer-state', id: target.id, role: target.role });
  },

  move(room, actor, target, msg) {
    const destination = toSlug(msg.slug);
    if (!target || !destination) return;
    room.send(target.ws, { type: 'move', slug: destination, by: actor.name });
  },
};

const HANDLERS = {
  join: (s, msg) => s.join(msg),
  leave: (s) => s.leave({ graceful: true }),
  ping: (s) => s.send({ type: 'pong' }),
  mod: (s, msg) => s.moderate(msg),
  room: (s, msg) => s.configure(msg),
  rooms: (s) => s.send({ type: 'rooms', rooms: s.rooms.active() }),

  invite: (s, msg) => {
    if (!s.room) return;
    const hours = Math.max(0, Math.min(168, Number(msg.hours) || 0));
    const expiresAt = hours ? Date.now() + hours * 3_600_000 : 0;
    s.send({ type: 'invite', token: createInvite(s.room.slug, expiresAt), expiresAt });
  },

  approve: (s, msg) => {
    const room = s.room;
    if (!room || !room.canModerate(s.peer)) return;

    const entry = room.removeFromWaiting(msg.id);
    if (!entry) return;
    if (!msg.accept) {
      entry.session.send({ type: 'error', code: 'rejected' });
      entry.session.waitingRoom = null;
      return;
    }

    // Aceito: refaz a entrada dele como se tivesse acabado de chegar.
    const pedido = entry.session.pendingJoin;
    entry.session.waitingRoom = null;
    entry.session.waitingId = null;
    entry.session.approved = true;
    entry.session.join({ ...pedido, approved: true });
  },

  signal: (s, msg) => s.peer && s.room?.relaySignal(s.peer, msg),
  state: (s, msg) => s.peer && s.room?.updateState(s.peer, msg),
  chat: (s, msg) => s.peer && s.room?.chat(s.peer, msg.text),

  reaction: (s, msg) => {
    if (!s.peer || !REACTIONS.has(msg.emoji)) return;
    s.room.broadcast({ type: 'reaction', from: s.peer.id, emoji: msg.emoji });
  },

  sound: (s, msg) => {
    if (!s.peer || !SOUNDS.has(msg.name)) return;
    s.room.broadcast({ type: 'sound', from: s.peer.id, name: msg.name });
  },

  typing: (s) => {
    if (!s.peer) return;
    s.room.broadcast({ type: 'typing', id: s.peer.id, name: s.peer.name }, s.peer.id);
  },
};
