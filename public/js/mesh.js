/**
 * Malha P2P (mesh): uma RTCPeerConnection por participante.
 *
 * Cada conexão nasce com quatro transceivers em ordem fixa — microfone, áudio da
 * tela, vídeo da tela e câmera — criados só por quem inicia. Como os m-lines
 * existem desde o primeiro offer, ligar e desligar qualquer coisa é apenas um
 * `replaceTrack`: nenhuma renegociação depois do handshake.
 */

import { prefs } from './storage.js';

export const ROLES = ['mic', 'screen-audio', 'screen-video', 'camera'];
const KIND_BY_ROLE = { mic: 'audio', 'screen-audio': 'audio', 'screen-video': 'video', camera: 'video' };

const SCREEN_MAX_BITRATE = 3_000_000;
const CAMERA_MAX_BITRATE = 900_000;
const MAX_ICE_RESTARTS = 3;
/** 'disconnected' costuma se resolver sozinho; só reinicia o ICE se persistir. */
const RECOVER_DELAY_MS = 4000;

/**
 * Liga FEC e DTX do Opus e fixa o teto de bitrate da voz. É a diferença entre
 * voz robótica e voz limpa quando a rede perde pacote.
 */
function tuneOpus(sdp, kbps) {
  return sdp.replace(/a=fmtp:(\d+) ([^\r\n]*minptime[^\r\n]*)/g, (linha, pt, params) => {
    const campos = new Map(
      params
        .split(';')
        .map((item) => item.trim().split('='))
        .filter(([chave]) => chave),
    );
    campos.set('useinbandfec', '1');
    campos.set('maxaveragebitrate', String(kbps * 1000));
    campos.set('stereo', '0');
    return `a=fmtp:${pt} ${[...campos].map(([k, v]) => (v === undefined ? k : `${k}=${v}`)).join(';')}`;
  });
}

/**
 * Ordem de preferência de codec: RED na frente do Opus (recupera perda de pacote
 * sem retransmitir) e, no vídeo, o que tem aceleração de hardware em mais
 * máquinas.
 */
function preferCodecs(transceiver, kind) {
  if (!RTCRtpSender.getCapabilities || !transceiver.setCodecPreferences) return;
  try {
    const { codecs } = RTCRtpSender.getCapabilities(kind) ?? {};
    if (!codecs?.length) return;

    const nota = (codec) => {
      const nome = codec.mimeType.toLowerCase();
      if (kind === 'audio') return nome.endsWith('/red') ? 0 : nome.endsWith('/opus') ? 1 : 2;
      return nome.endsWith('/h264') ? 0 : nome.endsWith('/vp8') ? 1 : nome.endsWith('/vp9') ? 2 : 3;
    };
    transceiver.setCodecPreferences([...codecs].sort((a, b) => nota(a) - nota(b)));
  } catch {
    /* navegador sem suporte: segue com a ordem padrão */
  }
}

/** Buffer de recepção: voz curta pra não atrasar, tela um pouco maior pra não picotar. */
function tuneReceiver(receiver, role) {
  if (!receiver || !('playoutDelayHint' in receiver)) return;
  receiver.playoutDelayHint = role === 'mic' ? 0.02 : 0.15;
}

export class Mesh {
  #peers = new Map();
  #local = { mic: null, 'screen-audio': null, 'screen-video': null, camera: null };

  /**
   * @param {object} options
   * @param {(to: string, data: object) => void} options.send
   * @param {(id: string, role: string, track: MediaStreamTrack) => void} options.onTrack
   * @param {(id: string, state: RTCPeerConnectionState) => void} [options.onStateChange]
   */
  constructor({ send, onTrack, onStateChange }) {
    this.send = send;
    this.onTrack = onTrack;
    this.onStateChange = onStateChange ?? (() => {});
    this.iceServers = [];
  }

  configure(iceServers) {
    this.iceServers = Array.isArray(iceServers) ? iceServers : [];
  }

  get ids() {
    return [...this.#peers.keys()];
  }

  /** @returns {Array<[string, RTCPeerConnection]>} */
  connections() {
    return [...this.#peers.entries()].map(([id, peer]) => /** @type {[string, RTCPeerConnection]} */ ([id, peer.pc]));
  }

  /**
   * @param {boolean} initiator quem já estava na toca chama quem chegou.
   * @param {boolean} [relayOnly] segunda tentativa, forçando o caminho pelo TURN.
   */
  connect(id, initiator, relayOnly = false) {
    if (this.#peers.has(id)) return;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle',
      // Modo privacidade: tudo pelo TURN, ninguém descobre seu IP.
      iceTransportPolicy: prefs.privacy || relayOnly ? 'relay' : 'all',
    });

    const peer = {
      id,
      pc,
      polite: !initiator,
      makingOffer: false,
      ignoreOffer: false,
      senders: new Map(),
      chain: Promise.resolve(),
      restarts: 0,
      recoverTimer: null,
      initiator,
      relayOnly,
    };
    this.#peers.set(id, peer);

    pc.onicecandidate = ({ candidate }) => {
      // Sinalizar o fim dos candidatos evita espera à toa em rede lenta.
      this.send(id, candidate ? { candidate: candidate.toJSON() } : { endOfCandidates: true });
    };

    pc.ontrack = (event) => {
      const role = ROLES[pc.getTransceivers().indexOf(event.transceiver)];
      if (role) this.onTrack(id, role, event.track);
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        const offer = await pc.createOffer();
        offer.sdp = tuneOpus(offer.sdp, prefs.voiceKbps);
        await pc.setLocalDescription(offer);
        this.send(id, { description: pc.localDescription });
      } catch (error) {
        console.warn('[mesh] falha ao criar offer', error);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      this.onStateChange(id, pc.connectionState);
      if (pc.connectionState === 'connected') {
        peer.restarts = 0;
        clearTimeout(peer.recoverTimer);
        return;
      }
      // Só um dos lados reinicia o ICE, senão os dois brigam por renegociação.
      if (!initiator) return;
      if (pc.connectionState === 'failed') this.#recover(peer, 0);
      if (pc.connectionState === 'disconnected') this.#recover(peer, RECOVER_DELAY_MS);
    };

    if (initiator) {
      for (const role of ROLES) {
        const transceiver = pc.addTransceiver(KIND_BY_ROLE[role], { direction: 'sendrecv' });
        preferCodecs(transceiver, KIND_BY_ROLE[role]);
      }
      this.#bindSenders(peer);
    }
  }

  disconnect(id) {
    const peer = this.#peers.get(id);
    if (!peer) return;

    clearTimeout(peer.recoverTimer);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    this.#peers.delete(id);
  }

  disconnectAll() {
    for (const id of this.ids) this.disconnect(id);
  }

  /** Troca uma trilha local em todas as conexões, sem renegociar. */
  setLocalTrack(role, track) {
    this.#local[role] = track ?? null;
    for (const peer of this.#peers.values()) {
      const sender = peer.senders.get(role);
      if (!sender) continue;
      sender.replaceTrack(this.#local[role]).catch((error) => console.warn('[mesh] replaceTrack', error));
      this.#tune(sender, role);
    }
  }

  /** Reaplica limites de banda — usado quando a rede muda ou o ajuste é alterado. */
  retune() {
    for (const peer of this.#peers.values()) {
      for (const [role, sender] of peer.senders) this.#tune(sender, role);
    }
  }

  /** Sinais do mesmo par são processados em ordem — offer antes dos candidates. */
  handleSignal(id, data) {
    const peer = this.#peers.get(id);
    if (!peer) return;
    peer.chain = peer.chain.then(() => this.#applySignal(peer, data)).catch((error) => {
      console.warn('[mesh] sinal ignorado', error);
    });
  }

  async #applySignal(peer, { description, candidate, endOfCandidates }) {
    const { pc } = peer;

    if (description) {
      const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;

      await pc.setRemoteDescription(description);
      if (description.type !== 'offer') return;

      this.#bindSenders(peer);
      const answer = await pc.createAnswer();
      answer.sdp = tuneOpus(answer.sdp, prefs.voiceKbps);
      await pc.setLocalDescription(answer);
      this.send(peer.id, { description: pc.localDescription });
      return;
    }

    if (endOfCandidates) {
      await pc.addIceCandidate({ candidate: '', sdpMid: '0' }).catch(() => {});
      return;
    }

    if (candidate) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        if (!peer.ignoreOffer) throw error;
      }
    }
  }

  /** Associa os transceivers (ordem fixa) aos papéis e pendura as trilhas locais. */
  #bindSenders(peer) {
    const transceivers = peer.pc.getTransceivers();

    ROLES.forEach((role, index) => {
      const transceiver = transceivers[index];
      if (!transceiver) return;

      peer.senders.set(role, transceiver.sender);
      tuneReceiver(transceiver.receiver, role);
      if (transceiver.direction !== 'sendrecv') transceiver.direction = 'sendrecv';

      const track = this.#local[role];
      if (transceiver.sender.track !== track) transceiver.sender.replaceTrack(track).catch(() => {});
      this.#tune(transceiver.sender, role);
    });
  }

  /**
   * Mesh multiplica o upload por participante: cada papel tem seu teto, e a voz
   * tem prioridade de rede sobre vídeo pra travar a tela em vez da conversa.
   */
  async #tune(sender, role) {
    if (!sender.track) return;
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      const encoding = params.encodings[0];

      if (role === 'mic') {
        encoding.maxBitrate = prefs.voiceKbps * 1000;
        encoding.networkPriority = 'high';
        encoding.priority = 'high';
      } else if (role === 'screen-video') {
        encoding.maxBitrate = Math.min(this.screenCeiling ?? SCREEN_MAX_BITRATE, this.roomCeiling ?? SCREEN_MAX_BITRATE);
        encoding.maxFramerate = prefs.quality === '1080p60' ? 60 : 30;
        encoding.scaleResolutionDownBy = this.downscale ?? 1;
        encoding.networkPriority = 'low';
        params.degradationPreference = prefs.motion ? 'maintain-framerate' : 'maintain-resolution';
      } else if (role === 'camera') {
        encoding.maxBitrate = CAMERA_MAX_BITRATE;
        encoding.networkPriority = 'low';
        params.degradationPreference = 'balanced';
      }

      await sender.setParameters(params);
    } catch {
      /* navegador sem suporte a esses parâmetros: segue com o padrão */
    }
  }

  /**
   * Ajusta o teto do vídeo à banda que o navegador mediu, em vez de deixar um
   * número fixo torcendo pra dar certo.
   */
  /** Teto que a toca inteira respeita, definido por quem administra o servidor. */
  setRoomCeiling(bps) {
    this.roomCeiling = bps || undefined;
    this.retune();
  }

  /**
   * Máquina no limite: em vez de travar, manda menos pixels. Volta sozinho
   * quando a CPU folga.
   */
  setDownscale(factor) {
    const novo = Math.max(1, Math.min(4, factor));
    if (this.downscale === novo) return;
    this.downscale = novo;
    this.retune();
  }

  setScreenCeiling(bps) {
    const novo = Math.max(300_000, Math.min(SCREEN_MAX_BITRATE, Math.round(bps)));
    if (this.screenCeiling && Math.abs(novo - this.screenCeiling) < 150_000) return;
    this.screenCeiling = novo;
    this.retune();
  }

  /** Nova rodada de ICE quando a conexão cai — cobre troca de rede e NAT teimoso. */
  #recover(peer, delay) {
    clearTimeout(peer.recoverTimer);

    // Esgotadas as tentativas diretas, refaz tudo só pelo TURN: em rede que
    // bloqueia UDP direto, esse é o caminho que sobra.
    if (peer.restarts >= MAX_ICE_RESTARTS) {
      if (peer.relayOnly) return;
      const { id, initiator } = peer;
      this.disconnect(id);
      this.connect(id, initiator, true);
      return;
    }

    peer.recoverTimer = setTimeout(() => {
      const state = peer.pc.connectionState;
      if (state === 'connected' || state === 'closed') return;
      peer.restarts += 1;
      peer.pc.restartIce();
    }, delay);
  }
}
