/**
 * Portão de ruído na thread de áudio.
 *
 * Precisa rodar aqui, e não no laço de animação: o navegador congela
 * requestAnimationFrame em aba de fundo, e um portão congelado fechado cortaria
 * a voz de quem trocou de janela — que é justamente quem está compartilhando a
 * tela e falando.
 */
class GateProcessor extends AudioWorkletProcessor {
  #envelope = 0;
  #lastLoud = 0;
  #frames = 0;

  constructor() {
    super();
    this.enabled = true;
    this.threshold = 0.045;
    this.holdSeconds = 0.3;
    this.port.onmessage = ({ data }) => Object.assign(this, data);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input?.length) return true;

    let sum = 0;
    const canal = input[0];
    for (let i = 0; i < canal.length; i++) sum += canal[i] * canal[i];
    const level = Math.sqrt(sum / canal.length);

    if (level > this.threshold) this.#lastLoud = currentTime;
    const speaking = currentTime - this.#lastLoud < this.holdSeconds;
    const target = !this.enabled || speaking ? 1 : 0;

    // Sobe rápido (não corta o começo da palavra), desce devagar (não engasga).
    const coefficient = target > this.#envelope ? 0.35 : 0.02;

    for (let channel = 0; channel < input.length; channel++) {
      const from = input[channel];
      const to = output[channel];
      let envelope = this.#envelope;
      for (let i = 0; i < from.length; i++) {
        envelope += (target - envelope) * coefficient;
        to[i] = from[i] * envelope;
      }
      if (channel === input.length - 1) this.#envelope = envelope;
    }

    // A interface não precisa de 128 avisos por segundo.
    if ((this.#frames += 1) % 4 === 0) this.port.postMessage({ level, speaking });
    return true;
  }
}

registerProcessor('toca-gate', GateProcessor);
