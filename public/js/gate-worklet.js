/**
 * Processamento do microfone na thread de áudio: portão de ruído e efeitos.
 *
 * Precisa rodar aqui, e não no laço de animação: o navegador congela
 * requestAnimationFrame em aba de fundo, e um portão congelado fechado cortaria
 * a voz de quem trocou de janela — que é justamente quem está compartilhando a
 * tela e falando.
 */

const BUFFER = 4096;

class GateProcessor extends AudioWorkletProcessor {
  #envelope = 0;
  #lastLoud = 0;
  #frames = 0;
  #ring = new Float32Array(BUFFER);
  #write = 0;
  #read = 0;
  #phase = 0;

  constructor() {
    super();
    this.enabled = true;
    this.threshold = 0.045;
    this.holdSeconds = 0.3;
    this.effect = 'none';
    this.port.onmessage = ({ data }) => Object.assign(this, data);
  }

  /**
   * Deslocamento de tom por duas cabeças de leitura em fade cruzado: é o
   * suficiente pra brincadeira, sem o custo de um vocoder de verdade.
   */
  #pitch(sample, ratio) {
    this.#ring[this.#write] = sample;
    this.#write = (this.#write + 1) % BUFFER;
    this.#read = (this.#read + ratio) % BUFFER;

    const base = Math.floor(this.#read);
    const frac = this.#read - base;
    const a = this.#ring[base];
    const b = this.#ring[(base + 1) % BUFFER];
    const principal = a + (b - a) * frac;

    // segunda cabeça meia volta atrás, pra tapar o salto quando a leitura passa
    const outro = (base + BUFFER / 2) % BUFFER;
    const secundaria = this.#ring[outro];
    const distancia = ((this.#write - this.#read + BUFFER) % BUFFER) / BUFFER;
    const mistura = Math.abs(distancia - 0.5) * 2;
    return principal * (1 - mistura) + secundaria * mistura;
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
    const ratio = this.effect === 'grave' ? 0.72 : this.effect === 'agudo' ? 1.45 : 1;

    for (let channel = 0; channel < input.length; channel++) {
      const from = input[channel];
      const to = output[channel];
      let envelope = this.#envelope;
      let phase = this.#phase;

      for (let i = 0; i < from.length; i++) {
        envelope += (target - envelope) * coefficient;
        let sample = from[i];

        if (channel === 0 && ratio !== 1) sample = this.#pitch(sample, ratio);
        if (this.effect === 'robo') {
          phase += (2 * Math.PI * 42) / sampleRate;
          sample *= Math.sin(phase);
        }
        to[i] = sample * envelope;
      }

      if (channel === input.length - 1) {
        this.#envelope = envelope;
        this.#phase = phase % (2 * Math.PI);
      }
    }

    // A interface não precisa de 128 avisos por segundo.
    if ((this.#frames += 1) % 4 === 0) this.port.postMessage({ level, speaking });
    return true;
  }
}

registerProcessor('toca-gate', GateProcessor);
