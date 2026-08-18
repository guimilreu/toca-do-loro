/** Captura local: microfone, tela e câmera. Nada aqui conhece a rede. */

import { prefs } from './storage.js';

const QUALITY = {
  '720p30': { width: 1280, height: 720, frameRate: 30 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30 },
  '1080p60': { width: 1920, height: 1080, frameRate: 60 },
};

export async function getMic(deviceId = prefs.micId) {
  const audio = {
    echoCancellation: prefs.aec,
    noiseSuppression: prefs.ns,
    autoGainControl: prefs.agc,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

export async function getCamera(deviceId = prefs.camId) {
  const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  if (deviceId) video.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}

export async function getScreen() {
  const alvo = QUALITY[prefs.quality] ?? QUALITY['1080p30'];
  const base = {
    video: {
      width: { ideal: alvo.width },
      height: { ideal: alvo.height },
      frameRate: { ideal: alvo.frameRate, max: alvo.frameRate },
    },
    surfaceSwitching: 'include',
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
  };
  // Áudio da aba/sistema quando o navegador oferece; sem processamento de voz.
  const withAudio = {
    ...base,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(withAudio);
  } catch (error) {
    // Cancelar é decisão de quem clicou; já Firefox e Safari podem recusar a
    // captura quando pedimos áudio junto — aí vale tentar só o vídeo.
    if (error?.name === 'NotAllowedError') throw error;
    stream = await navigator.mediaDevices.getDisplayMedia(base);
  }

  const video = stream.getVideoTracks()[0];
  if (video) video.contentHint = prefs.motion ? 'motion' : 'detail';
  return stream;
}

export async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const pick = (kind, rotulo) =>
    devices
      .filter((device) => device.kind === kind)
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `${rotulo} ${index + 1}` }));

  return {
    mics: pick('audioinput', 'Microfone'),
    outputs: pick('audiooutput', 'Saída'),
    cams: pick('videoinput', 'Câmera'),
  };
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

export const mediaSupported = () => Boolean(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);
export const screenShareSupported = () => Boolean(navigator.mediaDevices?.getDisplayMedia);
export const cameraSupported = () => Boolean(navigator.mediaDevices?.getUserMedia);
export const outputPickSupported = () => 'setSinkId' in HTMLMediaElement.prototype;
