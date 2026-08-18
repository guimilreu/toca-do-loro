/**
 * Qualidade da conexão, lida direto do WebRTC.
 *
 * Serve pra três coisas: mostrar no card de cada pessoa, ajustar o teto de vídeo
 * à banda real e dar uma nota no fim da call em vez de "conectado" verde e ponto.
 */

const POLL_MS = 2000;

/** E-model simplificado (ITU-T G.107) — vira nota de 1 a 5. */
export function mos({ rtt = 0, jitter = 0, loss = 0 }) {
  const atraso = rtt / 2 + jitter * 1000 + 20;
  const atrasoPenal = atraso < 160 ? 0.024 * atraso : 0.024 * atraso + 0.11 * (atraso - 177.3);
  const perdaPenal = 11 + 40 * Math.log(1 + 15 * Math.max(0, Math.min(1, loss)));
  const r = Math.max(0, Math.min(100, 93.2 - atrasoPenal - perdaPenal));
  const nota = 1 + 0.035 * r + r * (r - 60) * (100 - r) * 7e-6;
  return Math.max(1, Math.min(5, Number(nota.toFixed(2))));
}

export const grade = (nota) => (nota >= 4 ? 'boa' : nota >= 3 ? 'ok' : 'ruim');

export class Quality {
  #timer = null;
  #previous = new Map();

  /**
   * @param {() => Array<[string, RTCPeerConnection]>} connections
   * @param {(id: string, dados: object) => void} onUpdate
   */
  constructor(connections, onUpdate, onCycle) {
    this.connections = connections;
    this.onUpdate = onUpdate;
    this.onCycle = onCycle ?? (() => {});
    this.outgoing = 0;
    this.limitation = 'none';
  }

  start() {
    this.#timer ??= setInterval(() => this.#poll(), POLL_MS);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#previous.clear();
  }

  async #poll() {
    let banda = 0;
    let limite = 'none';

    for (const [id, pc] of this.connections()) {
      if (pc.connectionState !== 'connected') continue;

      let report;
      try {
        report = await pc.getStats();
      } catch {
        continue;
      }

      const dados = { rtt: 0, jitter: 0, loss: 0, bytes: 0, relay: false };
      let recebidos = 0;
      let perdidos = 0;

      report.forEach((stat) => {
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated !== false) {
          dados.rtt = Math.round((stat.currentRoundTripTime ?? 0) * 1000);
          banda = Math.max(banda, stat.availableOutgoingBitrate ?? 0);
        }
        if (stat.type === 'local-candidate' && stat.candidateType === 'relay') dados.relay = true;
        if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
          dados.jitter = stat.jitter ?? 0;
          recebidos += stat.packetsReceived ?? 0;
          perdidos += stat.packetsLost ?? 0;
          dados.bytes += stat.bytesReceived ?? 0;
        }
        if (stat.type === 'outbound-rtp' && stat.kind === 'video' && stat.qualityLimitationReason) {
          if (stat.qualityLimitationReason !== 'none') limite = stat.qualityLimitationReason;
        }
      });

      // Perda só faz sentido no intervalo: acumulado desde o início esconde melhora.
      const anterior = this.#previous.get(id) ?? { recebidos: 0, perdidos: 0 };
      const deltaRecebidos = Math.max(0, recebidos - anterior.recebidos);
      const deltaPerdidos = Math.max(0, perdidos - anterior.perdidos);
      this.#previous.set(id, { recebidos, perdidos });
      dados.loss = deltaRecebidos + deltaPerdidos ? deltaPerdidos / (deltaRecebidos + deltaPerdidos) : 0;
      dados.mos = mos(dados);
      dados.grade = grade(dados.mos);

      this.onUpdate(id, dados);
    }

    this.outgoing = banda;
    this.limitation = limite;
    this.onCycle({ outgoing: banda, limitation: limite });
  }
}
