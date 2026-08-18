const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 8000;
const KEEPALIVE_MS = 25_000;

/**
 * Canal de sinalização. Só carrega SDP/ICE e presença — nunca mídia.
 * Reconecta sozinho com backoff; quem consome decide o que fazer no `open`.
 */
export class Signaling {
  #handlers = new Map();
  #ws = null;
  #attempt = 0;
  #timer = null;
  #keepalive = null;
  #manualClose = false;

  constructor(url) {
    this.url = url;
  }

  get connected() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  on(type, handler) {
    this.#handlers.set(type, handler);
    return this;
  }

  connect() {
    this.#manualClose = false;
    clearTimeout(this.#timer);

    const ws = new WebSocket(this.url);
    this.#ws = ws;

    ws.onopen = () => {
      this.#attempt = 0;
      this.#keepalive = setInterval(() => this.send({ type: 'ping' }), KEEPALIVE_MS);
      this.#emit('open', {});
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg && typeof msg.type === 'string') this.#emit(msg.type, msg);
    };

    ws.onclose = () => {
      clearInterval(this.#keepalive);
      this.#emit('close', {});
      if (!this.#manualClose) this.#scheduleReconnect();
    };

    ws.onerror = () => {
      /* onclose cuida da recuperação */
    };
  }

  send(msg) {
    if (this.connected) this.#ws.send(JSON.stringify(msg));
  }

  close() {
    this.#manualClose = true;
    clearTimeout(this.#timer);
    clearInterval(this.#keepalive);
    this.#ws?.close();
    this.#ws = null;
  }

  #scheduleReconnect() {
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.#attempt++);
    this.#emit('reconnecting', { delay });
    this.#timer = setTimeout(() => this.connect(), delay);
  }

  #emit(type, msg) {
    this.#handlers.get(type)?.(msg);
  }
}
