/**
 * Todo o áudio da toca num grafo só de Web Audio.
 *
 * Entrada (microfone): fonte → filtro grave → noise gate → ganho → destino WebRTC.
 * Saída (cada pessoa): fonte → ganho dela → posição no estéreo → alto-falante.
 *
 * O elemento <audio> continua existindo, mudo, porque o Chrome só faz a mídia
 * remota fluir de verdade quando ela está pendurada num elemento.
 */

import { prefs } from './storage.js';

const SPEAK_HOLD_MS = 300;
/** Nível de fala vai de 1 (muito sensível) a 10 (só voz alta). */
const vadThreshold = (level) => 0.012 + (level - 1) * 0.008;

export class AudioHub {
  #ctx = null;
  #master = null;
  #peers = new Map();
  #mic = null;
  #raf = null;
  #deafened = false;
  #workletReady = null;

  /**
   * @param {(id: string, speaking: boolean, level: number) => void} onLevel
   */
  constructor(onLevel) {
    this.onLevel = onLevel;
  }

  get context() {
    if (!this.#ctx) {
      this.#ctx = new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)();
      this.#master = this.#ctx.createGain();
      this.#master.connect(this.#ctx.destination);
    }
    return this.#ctx;
  }

  resume() {
    this.context.resume().catch(() => {});
  }

  /** O portão vive na thread de áudio; carregar o módulo é assíncrono e único. */
  #loadWorklet() {
    if (!this.context.audioWorklet) return null;
    this.#workletReady ??= this.context.audioWorklet.addModule('/js/gate-worklet.js').catch((error) => {
      console.warn('[áudio] portão indisponível, seguindo sem ele', error);
      return null;
    });
    return this.#workletReady;
  }

  /* ---------------- microfone ---------------- */

  /**
   * Monta a cadeia de entrada e devolve a trilha que vai pra rede — já filtrada,
   * com portão de ruído e ganho aplicados.
   */
  setMicStream(stream) {
    // Remontar a cadeia gera uma trilha nova: se nada mudou, devolve a atual em
    // vez de deixar o sender segurando uma trilha sem fonte.
    if (this.#mic?.stream === stream) return this.micTrack;

    const ctx = this.context;
    this.#mic?.source.disconnect();

    const source = ctx.createMediaStreamSource(stream);
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 90; // corta ronco de ventilador e mesa

    const gain = ctx.createGain();
    const destination = ctx.createMediaStreamDestination();
    source.connect(highpass);
    highpass.connect(gain);
    gain.connect(destination);

    this.#mic = { stream, source, highpass, gain, destination, gate: null, level: 0, speaking: false, talk: 0 };
    this.applyGain();
    this.#attachGate();
    this.#start();
    return destination.stream.getAudioTracks()[0];
  }

  /** Insere o portão entre o filtro e o ganho assim que o worklet carrega. */
  async #attachGate() {
    const mic = this.#mic;
    const ready = this.#loadWorklet();
    if (!ready) return;
    await ready;
    if (this.#mic !== mic) return;

    try {
      const gate = new AudioWorkletNode(this.context, 'toca-gate');
      gate.port.onmessage = ({ data }) => {
        mic.level = data.level;
        mic.speaking = data.speaking;
      };
      mic.highpass.disconnect();
      mic.highpass.connect(gate);
      gate.connect(mic.gain);
      mic.gate = gate;
      this.syncGate();
    } catch (error) {
      console.warn('[áudio] portão não pôde ser criado', error);
    }
  }

  /** Repassa ao worklet o que o usuário escolheu nos ajustes. */
  syncGate() {
    this.#mic?.gate?.port.postMessage({
      enabled: prefs.gate,
      threshold: vadThreshold(prefs.vad),
      effect: prefs.effect ?? 'none',
    });
  }

  applyGain() {
    if (!this.#mic) return;
    this.#mic.gain.gain.value = Math.max(0, prefs.gain / 100);
  }

  get micTrack() {
    return this.#mic?.destination.stream.getAudioTracks()[0] ?? null;
  }

  get speaking() {
    return Boolean(this.#mic?.speaking);
  }

  /** Só pra medir no lobby, antes de entrar: não fala com a rede. */
  meter(stream) {
    const ctx = this.context;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    return {
      read() {
        analyser.getByteTimeDomainData(data);
        return rms(data);
      },
      stop() {
        source.disconnect();
      },
    };
  }

  /* ---------------- pessoas ---------------- */

  addPeer(id, stream) {
    const ctx = this.context;
    this.removePeer(id);

    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;

    source.connect(analyser);
    source.connect(gain);
    gain.connect(panner);
    panner.connect(this.#master);

    this.#peers.set(id, {
      source,
      gain,
      panner,
      analyser,
      data: new Uint8Array(analyser.fftSize),
      volume: 1,
      muted: false,
      lastLoud: 0,
      speaking: false,
      talk: 0,
    });
    this.#start();
  }

  removePeer(id) {
    const peer = this.#peers.get(id);
    if (!peer) return;
    peer.source.disconnect();
    peer.gain.disconnect();
    peer.panner.disconnect();
    this.#peers.delete(id);
  }

  setVolume(id, volume) {
    const peer = this.#peers.get(id);
    if (!peer) return;
    peer.volume = volume;
    peer.gain.gain.value = peer.muted ? 0 : volume;
  }

  setMuted(id, muted) {
    const peer = this.#peers.get(id);
    if (!peer) return;
    peer.muted = muted;
    peer.gain.gain.value = muted ? 0 : peer.volume;
  }

  /** Espalha as vozes no estéreo pra sala ficar inteligível com muita gente. */
  layout(ids) {
    const ativo = prefs.spatial;
    ids.forEach((id, index) => {
      const peer = this.#peers.get(id);
      if (!peer) return;
      const posicao = ids.length < 2 ? 0 : (index / (ids.length - 1)) * 2 - 1;
      peer.panner.pan.value = ativo ? posicao * 0.65 : 0;
    });
  }

  setDeafened(value) {
    this.#deafened = value;
    if (this.#master) this.#master.gain.value = value ? 0 : 1;
  }

  get deafened() {
    return this.#deafened;
  }

  /* ---------------- sons e avisos ---------------- */

  /** Sons curtos sintetizados: nenhum arquivo pra baixar, nenhuma licença pra checar. */
  blip(kind = 'join') {
    if (!prefs.sounds) return;
    const notes = { join: [660, 880], leave: [520, 390], hand: [880, 1320], chat: [740] }[kind] ?? [660];
    notes.forEach((freq, index) => this.#tone({ freq, delay: index * 0.09, volume: 0.14 }));
  }

  #tone({ freq, delay = 0, volume = 0.15, duration = 0.18, type = 'sine', sweep = 0 }) {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + delay;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), start + duration);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  /** Ruído curto — base de palma, prato e tambor. */
  #noise({ duration = 0.25, volume = 0.2, highpass = 800 }) {
    const ctx = this.context;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;

    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }

  /**
   * Soundboard: cada som é sintetizado na hora e tocado localmente por quem
   * recebe o aviso — não gasta um byte de banda de áudio.
   */
  play(sound) {
    this.resume();
    const receitas = {
      palmas: () => {
        for (let i = 0; i < 12; i++) setTimeout(() => this.#noise({ duration: 0.12, volume: 0.12 }), i * 70 + Math.random() * 40);
      },
      buzina: () => {
        this.#tone({ freq: 420, volume: 0.18, duration: 0.5, type: 'sawtooth' });
        this.#tone({ freq: 528, volume: 0.14, duration: 0.5, type: 'sawtooth' });
      },
      tambor: () => {
        this.#tone({ freq: 180, volume: 0.3, duration: 0.22, type: 'sine', sweep: 0.3 });
        this.#noise({ duration: 0.18, volume: 0.15, highpass: 1800 });
      },
      triste: () => [0, 1, 2, 3].forEach((i) => this.#tone({ freq: 330 * 0.89 ** i, delay: i * 0.16, duration: 0.2, type: 'triangle' })),
      grilo: () => [0, 1, 2].forEach((i) => this.#tone({ freq: 2400, delay: i * 0.35, duration: 0.05, volume: 0.08 })),
      loro: () => [880, 1320, 990, 1480].forEach((freq, i) => this.#tone({ freq, delay: i * 0.08, duration: 0.09, type: 'square', volume: 0.1 })),
    };
    receitas[sound]?.();
  }

  /**
   * Microfonia: se cada vez que alguém fala o seu microfone também acende, o som
   * está saindo na caixa e voltando pelo mic.
   */
  feedbackRisk() {
    if (!this.#mic?.speaking) return false;
    for (const peer of this.#peers.values()) if (peer.speaking) return true;
    return false;
  }

  /** Segundos que cada pessoa passou falando nesta sessão. */
  talkTime(id) {
    return Math.round((id === 'self' ? this.#mic?.talk : this.#peers.get(id)?.talk) ?? 0);
  }

  /* ---------------- laço de medição ---------------- */

  #start() {
    this.#raf ??= requestAnimationFrame(() => this.#tick());
  }

  #tick() {
    const now = performance.now();
    const decorrido = this.#raf ? Math.min(0.2, (now - this.#raf.at) / 1000) : 0;
    this.#raf = null;
    const limiar = vadThreshold(prefs.vad);

    // O nível do microfone vem do worklet; aqui só repassamos pra interface.
    if (this.#mic) {
      if (this.#mic.speaking) this.#mic.talk += decorrido;
      this.onLevel('self', this.#mic.speaking, this.#mic.level);
    }

    for (const [id, peer] of this.#peers) {
      peer.analyser.getByteTimeDomainData(peer.data);
      const level = rms(peer.data);
      if (level > limiar) peer.lastLoud = now;
      peer.speaking = now - peer.lastLoud < SPEAK_HOLD_MS;
      if (peer.speaking) peer.talk += decorrido;
      this.onLevel(id, peer.speaking, level);
    }

    if (this.#mic || this.#peers.size) this.#start();
  }

  destroy() {
    cancelAnimationFrame(this.#raf?.id);
    this.#raf = null;
    for (const id of [...this.#peers.keys()]) this.removePeer(id);
    this.#mic?.source.disconnect();
    this.#mic = null;
  }
}

function rms(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const value = (data[i] - 128) / 128;
    sum += value * value;
  }
  return Math.sqrt(sum / data.length);
}
