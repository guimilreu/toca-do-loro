import { Room } from './room.js';

const SLUG_MAX = 32;
/** Sala efêmera vazia some depois disso; sala fixa fica de pé. */
const EMPTY_TTL_MS = 5 * 60_000;

const ACCENTS = new RegExp('[\\u0300-\\u036f]', 'g');

export const toSlug = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(ACCENTS, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX);

/**
 * Todas as tocas do servidor, em memória. Reiniciar o processo zera tudo — o que
 * é o comportamento desejado: toca vazia é toca zerada.
 */
export class Rooms {
  #rooms = new Map();

  constructor({ defaultSlug, defaultName, maxPeers, maxRooms = 50 }) {
    this.defaultSlug = defaultSlug;
    this.maxPeers = maxPeers;
    this.maxRooms = maxRooms;
    this.get(defaultSlug, { name: defaultName, ephemeral: false });
  }

  has(slug) {
    return this.#rooms.has(slug);
  }

  /** Cria sob demanda: entrar num endereço que não existe abre a toca. */
  get(slug, options = {}) {
    const key = toSlug(slug) || this.defaultSlug;
    const found = this.#rooms.get(key);
    if (found) return found;
    if (this.#rooms.size >= this.maxRooms) return null;

    const room = new Room({
      slug: key,
      name: options.name || key,
      ephemeral: options.ephemeral ?? true,
      maxPeers: options.maxPeers || this.maxPeers,
      opensAt: options.opensAt || 0,
    });
    this.#rooms.set(key, room);
    return room;
  }

  /** Só as tocas com gente dentro — é o que a tela inicial mostra. */
  active() {
    return [...this.#rooms.values()]
      .filter((room) => room.size > 0)
      .sort((a, b) => b.size - a.size)
      .map((room) => ({ slug: room.slug, name: room.name, count: room.size, needsPassword: room.needsPassword }));
  }

  get totalPeers() {
    let total = 0;
    for (const room of this.#rooms.values()) total += room.size;
    return total;
  }

  /** Recolhe salas efêmeras vazias e derruba conexões mortas. */
  sweep() {
    for (const room of this.#rooms.values()) {
      for (const peer of room.peers.values()) {
        if (!peer.ws.isAlive) {
          peer.ws.terminate();
          continue;
        }
        peer.ws.isAlive = false;
        peer.ws.ping();
      }

      const expired = room.ephemeral && room.emptySince && Date.now() - room.emptySince > EMPTY_TTL_MS;
      if (expired && room.slug !== this.defaultSlug) this.#rooms.delete(room.slug);
    }
  }

  [Symbol.iterator]() {
    return this.#rooms.values();
  }
}
