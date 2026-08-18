const SPEAK_ON = 0.045;
const SPEAK_OFF = 0.028;
const HOLD_MS = 300;

/**
 * Detecção de fala por RMS. Um único AudioContext e um único laço de RAF
 * para todos os participantes — um analyser por stream.
 */
export class LevelMonitor {
  #ctx = null;
  #entries = new Map();
  #raf = null;

  /** @param {(id: string, speaking: boolean, level: number) => void} onUpdate */
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
  }

  attach(id, stream) {
    if (!stream?.getAudioTracks().length) return;
    this.detach(id);

    const ctx = this.#context();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);

    this.#entries.set(id, {
      source,
      analyser,
      data: new Uint8Array(analyser.fftSize),
      speaking: false,
      lastLoud: 0,
    });
    this.#start();
  }

  detach(id) {
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.source.disconnect();
    this.#entries.delete(id);
    if (!this.#entries.size) this.#stop();
  }

  /** Navegadores só liberam o AudioContext depois de um gesto do usuário. */
  resume() {
    this.#context().resume().catch(() => {});
  }

  destroy() {
    for (const id of [...this.#entries.keys()]) this.detach(id);
    this.#ctx?.close().catch(() => {});
    this.#ctx = null;
  }

  #context() {
    this.#ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    return this.#ctx;
  }

  #start() {
    this.#raf ??= requestAnimationFrame(() => this.#tick());
  }

  #stop() {
    cancelAnimationFrame(this.#raf);
    this.#raf = null;
  }

  #tick() {
    this.#raf = null;
    const now = performance.now();

    for (const [id, entry] of this.#entries) {
      const { analyser, data } = entry;
      analyser.getByteTimeDomainData(data);

      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const value = (data[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / data.length);

      // Histerese: sobe rápido no SPEAK_ON, segura por HOLD_MS, solta no SPEAK_OFF.
      if (rms > SPEAK_ON) entry.lastLoud = now;
      entry.speaking = now - entry.lastLoud < HOLD_MS || (entry.speaking && rms > SPEAK_OFF);

      this.onUpdate(id, entry.speaking, rms);
    }

    if (this.#entries.size) this.#start();
  }
}
