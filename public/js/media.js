/** Captura local: microfone e tela. Nada aqui conhece a rede. */

const MIC_TUNING = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export async function getMic(deviceId) {
  const audio = { ...MIC_TUNING };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

export async function getScreen() {
  const base = {
    video: { frameRate: { ideal: 30, max: 60 } },
    surfaceSwitching: 'include',
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
  };
  // Áudio da aba/sistema quando o navegador oferece; sem processamento de voz.
  const withAudio = { ...base, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(withAudio);
  } catch (error) {
    // Cancelar é decisão do usuário; já Firefox/Safari podem recusar a captura
    // de tela quando pedimos áudio junto — nesse caso vale tentar só o vídeo.
    if (error?.name === 'NotAllowedError') throw error;
    stream = await navigator.mediaDevices.getDisplayMedia(base);
  }

  const video = stream.getVideoTracks()[0];
  if (video) video.contentHint = 'detail';
  return stream;
}

export async function listMics() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Microfone ${index + 1}`,
    }));
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

export const mediaSupported = () =>
  Boolean(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);

export const screenShareSupported = () => Boolean(navigator.mediaDevices?.getDisplayMedia);
