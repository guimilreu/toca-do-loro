/**
 * Limites por IP. O rate limit por conexão não protege de nada sozinho: basta
 * abrir várias conexões. Aqui a conta é por endereço.
 */
const WINDOW_MS = 60_000;

export class IpLimiter {
  #ips = new Map();

  constructor({ maxConnections = 8, maxJoins = 20 } = {}) {
    this.maxConnections = maxConnections;
    this.maxJoins = maxJoins;
  }

  #entry(ip) {
    const now = Date.now();
    let entry = this.#ips.get(ip);
    if (!entry) {
      entry = { connections: 0, joins: 0, since: now };
      this.#ips.set(ip, entry);
    }
    if (now - entry.since > WINDOW_MS) {
      entry.joins = 0;
      entry.since = now;
    }
    return entry;
  }

  /** @returns {boolean} false quando o IP já tem conexões demais abertas */
  connect(ip) {
    const entry = this.#entry(ip);
    if (entry.connections >= this.maxConnections) return false;
    entry.connections += 1;
    return true;
  }

  disconnect(ip) {
    const entry = this.#ips.get(ip);
    if (!entry) return;
    entry.connections = Math.max(0, entry.connections - 1);
    if (!entry.connections && Date.now() - entry.since > WINDOW_MS) this.#ips.delete(ip);
  }

  /** @returns {boolean} false quando o IP tentou entrar vezes demais na janela */
  join(ip) {
    const entry = this.#entry(ip);
    if (entry.joins >= this.maxJoins) return false;
    entry.joins += 1;
    return true;
  }

  get size() {
    return this.#ips.size;
  }
}

/** IP real por trás do proxy do Easypanel, com o socket como último recurso. */
export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'desconhecido';
}
