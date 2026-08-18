/**
 * Malha P2P (mesh): uma RTCPeerConnection por participante.
 *
 * Cada conexão nasce com três transceivers em ordem fixa — mic, áudio da tela,
 * vídeo da tela — criados só por quem inicia. Como os m-lines existem desde o
 * primeiro offer, ligar/desligar microfone ou compartilhamento é apenas um
 * `replaceTrack`: nenhuma renegociação depois do handshake inicial.
 */

const ROLES = ['mic', 'screen-audio', 'screen-video'];
const KIND_BY_ROLE = { mic: 'audio', 'screen-audio': 'audio', 'screen-video': 'video' };
const SCREEN_MAX_BITRATE = 2_500_000;
const MAX_ICE_RESTARTS = 3;
/** 'disconnected' costuma se resolver sozinho; só reinicia o ICE se persistir. */
const RECOVER_DELAY_MS = 4000;

export class Mesh {
  #peers = new Map();
  #local = { mic: null, 'screen-audio': null, 'screen-video': null };

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

  /** @param {boolean} initiator quem já estava na sala chama quem chegou. */
  connect(id, initiator) {
    if (this.#peers.has(id)) return;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
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
    };
    this.#peers.set(id, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send(id, { candidate: candidate.toJSON() });
    };

    pc.ontrack = (event) => {
      const role = ROLES[pc.getTransceivers().indexOf(event.transceiver)];
      if (role) this.onTrack(id, role, event.track);
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
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
      for (const role of ROLES) pc.addTransceiver(KIND_BY_ROLE[role], { direction: 'sendrecv' });
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

  /** Nova rodada de ICE quando a conexão cai — cobre troca de rede e NAT teimoso. */
  #recover(peer, delay) {
    clearTimeout(peer.recoverTimer);
    if (peer.restarts >= MAX_ICE_RESTARTS) return;

    peer.recoverTimer = setTimeout(() => {
      const state = peer.pc.connectionState;
      if (state === 'connected' || state === 'closed') return;
      peer.restarts += 1;
      peer.pc.restartIce();
    }, delay);
  }

  /** Troca uma trilha local em todas as conexões, sem renegociar. */
  setLocalTrack(role, track) {
    this.#local[role] = track ?? null;
    for (const peer of this.#peers.values()) {
      const sender = peer.senders.get(role);
      if (!sender) continue;
      sender.replaceTrack(this.#local[role]).catch((error) => console.warn('[mesh] replaceTrack', error));
      if (role === 'screen-video' && track) this.#tuneScreenSender(sender);
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

  async #applySignal(peer, { description, candidate }) {
    const { pc } = peer;

    if (description) {
      const collision =
        description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;

      await pc.setRemoteDescription(description);
      if (description.type !== 'offer') return;

      this.#bindSenders(peer);
      await pc.setLocalDescription();
      this.send(peer.id, { description: pc.localDescription });
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
      if (transceiver.direction !== 'sendrecv') transceiver.direction = 'sendrecv';

      const track = this.#local[role];
      if (transceiver.sender.track === track) return;

      transceiver.sender.replaceTrack(track).catch(() => {});
      if (role === 'screen-video' && track) this.#tuneScreenSender(transceiver.sender);
    });
  }

  /** Mesh multiplica o upload por participante — segura o teto do vídeo de tela. */
  async #tuneScreenSender(sender) {
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      params.encodings[0].maxBitrate = SCREEN_MAX_BITRATE;
      params.encodings[0].maxFramerate = 30;
      params.degradationPreference = 'maintain-resolution';
      await sender.setParameters(params);
    } catch {
      /* navegador sem suporte a esses parâmetros: segue com o padrão */
    }
  }
}
