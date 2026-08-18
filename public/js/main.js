import { LevelMonitor } from './audio-level.js';
import { getMic, getScreen, listMics, mediaSupported, screenShareSupported, stopStream } from './media.js';
import { Mesh } from './mesh.js';
import * as ui from './ui.js';
import { Signaling } from './signaling.js';

const NAME_KEY = 'toca:name';
const MIC_KEY = 'toca:mic';

const state = {
  self: null,
  inCall: false,
  peers: new Map(),
  micStream: null,
  hasMic: false,
  muted: false,
  micDeviceId: localStorage.getItem(MIC_KEY) || '',
  screenStream: null,
  sharing: false,
  activeShare: null,
  audioBlocked: false,
};

const audioEls = new Map();

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const signaling = new Signaling(wsUrl);

const mesh = new Mesh({
  send: (to, data) => signaling.send({ type: 'signal', to, data }),
  onTrack: handleTrack,
  onStateChange: (id, connection) => {
    const peer = state.peers.get(id);
    if (!peer) return;
    peer.connection = connection;
    ui.upsertParticipant(peer);
  },
});

const levels = new LevelMonitor((id, speaking, level) => {
  ui.setSpeaking(id, speaking);
  if (id === state.self?.id) ui.setMicMeter(level);
});

/* ============ sinalização ============ */

signaling
  .on('open', () => {
    ui.setConnection('conectado', 'on');
    if (state.inCall) sendJoin();
  })
  .on('hello', (msg) => ui.setLobby(lobbyText(msg.count), 'on'))
  .on('lobby', (msg) => ui.setLobby(lobbyText(msg.count), 'on'))
  .on('welcome', (msg) => {
    state.self = { id: msg.self.id, name: msg.self.name };
    state.inCall = true;
    mesh.configure(msg.iceServers);

    resetPeers();
    addParticipant({ ...msg.self, isLocal: true, muted: state.muted, hasMic: state.hasMic, sharing: state.sharing });
    // Quem já estava na sala inicia a conexão com quem acabou de chegar.
    for (const peer of msg.peers) {
      addParticipant(peer);
      mesh.connect(peer.id, false);
    }

    ui.showCall(msg.room);
    ui.setConnection('conectado', 'on');
    refreshCall();
    attachLocalLevel();
    levels.resume();
    refreshMicList();
  })
  .on('peer-joined', (msg) => {
    addParticipant(msg.peer);
    mesh.connect(msg.peer.id, true);
    refreshCall();
    ui.toast(`${msg.peer.name} entrou`);
  })
  .on('peer-left', (msg) => {
    const peer = state.peers.get(msg.id);
    if (!peer) return;
    dropPeer(msg.id);
    refreshCall();
    ui.toast(`${peer.name} saiu`);
  })
  .on('peer-state', (msg) => {
    const peer = state.peers.get(msg.id);
    if (!peer) return;
    Object.assign(peer, { muted: msg.muted, sharing: msg.sharing, hasMic: msg.hasMic });
    ui.upsertParticipant(peer);
    refreshCall();
  })
  .on('signal', (msg) => mesh.handleSignal(msg.from, msg.data))
  .on('error', (msg) => {
    if (msg.code === 'room-full') {
      failJoin(`A sala está cheia (máximo ${msg.max}). Tente daqui a pouco.`);
    }
  })
  .on('close', () => {
    ui.setConnection('reconectando…', 'idle');
    ui.setLobby('reconectando…', 'idle');
    if (state.inCall) tearDownMesh();
  })
  .on('reconnecting', () => ui.setConnection('reconectando…', 'idle'));

const lobbyText = (count) =>
  count === 0 ? 'ninguém na toca agora' : count === 1 ? '1 pessoa na toca agora' : `${count} pessoas na toca agora`;

/* ============ participantes ============ */

function addParticipant(peer) {
  const participant = {
    id: peer.id,
    name: peer.name,
    muted: Boolean(peer.muted),
    sharing: Boolean(peer.sharing),
    hasMic: peer.hasMic !== false,
    isLocal: Boolean(peer.isLocal),
    connection: peer.isLocal ? 'connected' : 'new',
    screenStream: null,
  };
  state.peers.set(peer.id, participant);
  ui.upsertParticipant(participant);
  return participant;
}

function dropPeer(id) {
  mesh.disconnect(id);
  levels.detach(id);
  state.peers.delete(id);
  ui.removeParticipant(id);

  for (const role of ['mic', 'screen-audio']) {
    const el = audioEls.get(`${id}:${role}`);
    if (!el) continue;
    el.srcObject = null;
    el.remove();
    audioEls.delete(`${id}:${role}`);
  }
}

function resetPeers() {
  for (const id of [...state.peers.keys()]) dropPeer(id);
  ui.clearParticipants();
}

function tearDownMesh() {
  for (const id of [...state.peers.keys()]) {
    if (id !== state.self?.id) dropPeer(id);
  }
  mesh.disconnectAll();
  refreshCall();
}

/* ============ mídia remota ============ */

function handleTrack(id, role, track) {
  const peer = state.peers.get(id);
  if (!peer) return;

  if (role === 'screen-video') {
    peer.screenStream = new MediaStream([track]);
    track.addEventListener('unmute', refreshCall);
    track.addEventListener('mute', refreshCall);
    refreshCall();
    return;
  }

  const stream = new MediaStream([track]);
  const el = audioElement(id, role);
  el.srcObject = stream;
  el.muted = role === 'screen-audio' && state.activeShare !== id;
  play(el);

  if (role === 'mic') levels.attach(id, stream);
}

function audioElement(id, role) {
  const key = `${id}:${role}`;
  let el = audioEls.get(key);
  if (el) return el;

  el = document.createElement('audio');
  el.autoplay = true;
  el.playsInline = true;
  ui.els.audioSink.append(el);
  audioEls.set(key, el);
  return el;
}

function play(el) {
  el.play().catch(() => {
    if (state.audioBlocked) return;
    state.audioBlocked = true;
    ui.toast('Clique na página para liberar o áudio.', 6000);
    document.addEventListener(
      'click',
      () => {
        state.audioBlocked = false;
        levels.resume();
        for (const audio of audioEls.values()) audio.play().catch(() => {});
      },
      { once: true },
    );
  });
}

/* ============ estado da call ============ */

/** Recalcula quem está compartilhando, qual tela está no palco e o contador. */
function refreshCall() {
  const sharers = [...state.peers.values()].filter((peer) => peer.sharing && peer.screenStream);

  if (!sharers.some((peer) => peer.id === state.activeShare)) {
    state.activeShare = sharers.at(-1)?.id ?? null;
  }

  const active = sharers.find((peer) => peer.id === state.activeShare) ?? null;
  ui.setStageShare(active?.screenStream ?? null);
  ui.renderShareTabs(sharers, state.activeShare, selectShare);
  ui.setCount(state.peers.size);

  for (const peer of state.peers.values()) {
    const el = audioEls.get(`${peer.id}:screen-audio`);
    if (el) el.muted = peer.id !== state.activeShare;
  }
}

function selectShare(id) {
  state.activeShare = id;
  refreshCall();
}

function publishState() {
  signaling.send({ type: 'state', muted: state.muted, sharing: state.sharing, hasMic: state.hasMic });

  const self = state.peers.get(state.self?.id);
  if (!self) return;
  Object.assign(self, { muted: state.muted, sharing: state.sharing, hasMic: state.hasMic });
  ui.upsertParticipant(self);
  ui.setMicButton(state);
  ui.setShareButton({ sharing: state.sharing, supported: screenShareSupported() });
}

function attachLocalLevel() {
  if (state.self && state.micStream) levels.attach(state.self.id, state.micStream);
}

/* ============ entrada ============ */

ui.els.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!mediaSupported()) {
    return failJoin('Este navegador não suporta WebRTC. Use Chrome, Edge, Firefox ou Safari atualizados.');
  }

  const name = ui.els.nameInput.value.trim();
  if (!name) return failJoin('Escolha um nome para entrar.');

  ui.setJoinError('');
  ui.els.joinBtn.disabled = true;
  ui.els.joinBtn.textContent = 'Entrando…';
  localStorage.setItem(NAME_KEY, name);

  await acquireMic();

  if (!signaling.connected) return failJoin('Sem conexão com o servidor. Tentando de novo…');
  sendJoin();
});

async function acquireMic() {
  try {
    state.micStream = await getMic(state.micDeviceId);
    state.hasMic = true;
    state.muted = false;
    mesh.setLocalTrack('mic', state.micStream.getAudioTracks()[0]);
  } catch (error) {
    state.hasMic = false;
    state.muted = true;
    console.warn('[mic]', error);
    ui.toast('Sem acesso ao microfone: você entra só ouvindo.', 5000);
  }
  ui.setMicButton(state);
}

function sendJoin() {
  signaling.send({
    type: 'join',
    name: ui.els.nameInput.value.trim() || localStorage.getItem(NAME_KEY) || 'Anônimo',
    muted: state.muted,
    hasMic: state.hasMic,
  });
}

function failJoin(message) {
  state.inCall = false;
  ui.setJoinError(message);
  ui.els.joinBtn.disabled = false;
  ui.els.joinBtn.textContent = 'Entrar na toca';
}

/* ============ controles ============ */

ui.els.micBtn.addEventListener('click', () => {
  if (!state.hasMic) return;
  state.muted = !state.muted;
  for (const track of state.micStream.getAudioTracks()) track.enabled = !state.muted;
  publishState();
});

ui.els.shareBtn.addEventListener('click', () => (state.sharing ? stopShare() : startShare()));

async function startShare() {
  try {
    const stream = await getScreen();
    state.screenStream = stream;
    state.sharing = true;

    const video = stream.getVideoTracks()[0];
    const audio = stream.getAudioTracks()[0] ?? null;
    mesh.setLocalTrack('screen-video', video);
    mesh.setLocalTrack('screen-audio', audio);
    video.addEventListener('ended', stopShare, { once: true });

    const self = state.peers.get(state.self.id);
    if (self) self.screenStream = stream;

    state.activeShare = state.self.id;
    publishState();
    refreshCall();
  } catch (error) {
    if (error?.name !== 'NotAllowedError') {
      console.warn('[share]', error);
      ui.toast('Não foi possível compartilhar a tela.');
    }
  }
}

function stopShare() {
  if (!state.sharing) return;

  mesh.setLocalTrack('screen-video', null);
  mesh.setLocalTrack('screen-audio', null);
  stopStream(state.screenStream);
  state.screenStream = null;
  state.sharing = false;

  const self = state.peers.get(state.self?.id);
  if (self) self.screenStream = null;

  publishState();
  refreshCall();
}

ui.els.leaveBtn.addEventListener('click', leave);

function leave() {
  stopShare();
  state.inCall = false;
  levels.detach(state.self?.id);
  mesh.disconnectAll();
  resetPeers();
  stopStream(state.micStream);
  state.micStream = null;
  state.hasMic = false;
  state.self = null;
  state.activeShare = null;
  ui.setStageShare(null);

  signaling.close();
  ui.showJoin();
  ui.setLobby('conectando…', 'idle');
  signaling.connect();
}

window.addEventListener('pagehide', () => signaling.close());

/* ---- dispositivos ---- */

ui.els.settingsBtn.addEventListener('click', () => {
  const open = ui.els.settingsPanel.hidden;
  ui.els.settingsPanel.hidden = !open;
  ui.els.settingsBtn.setAttribute('aria-expanded', String(open));
  if (open) refreshMicList();
});

document.addEventListener('click', (event) => {
  if (ui.els.settingsPanel.hidden) return;
  if (event.target.closest('#settings-panel, #settings-btn')) return;
  ui.els.settingsPanel.hidden = true;
  ui.els.settingsBtn.setAttribute('aria-expanded', 'false');
});

async function refreshMicList() {
  try {
    const current = state.micStream?.getAudioTracks()[0]?.getSettings().deviceId || state.micDeviceId;
    ui.renderMicOptions(await listMics(), current);
  } catch (error) {
    console.warn('[devices]', error);
  }
}

ui.els.micSelect.addEventListener('change', async (event) => {
  const deviceId = event.target.value;
  try {
    const stream = await getMic(deviceId);
    stopStream(state.micStream);

    state.micStream = stream;
    state.micDeviceId = deviceId;
    state.hasMic = true;
    localStorage.setItem(MIC_KEY, deviceId);

    const track = stream.getAudioTracks()[0];
    track.enabled = !state.muted;
    mesh.setLocalTrack('mic', track);
    attachLocalLevel();
    publishState();
    ui.toast('Microfone trocado.');
  } catch (error) {
    console.warn('[mic-switch]', error);
    ui.toast('Não consegui usar esse microfone.');
  }
});

navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  if (state.inCall) refreshMicList();
});

/* ---- tela cheia e atalhos ---- */

ui.els.fullscreenBtn.addEventListener('click', () => {
  const frame = ui.els.shareVideo.parentElement;
  if (document.fullscreenElement) document.exitFullscreen();
  else frame.requestFullscreen?.().catch(() => {});
});

ui.els.shareVideo.addEventListener('dblclick', () => ui.els.fullscreenBtn.click());

document.addEventListener('keydown', (event) => {
  if (!state.inCall || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target instanceof Element && event.target.matches('input, select, textarea')) return;
  if (event.key.toLowerCase() === 'm') {
    event.preventDefault();
    ui.els.micBtn.click();
  }
});

/* ============ boot ============ */

ui.els.nameInput.value = localStorage.getItem(NAME_KEY) || '';
ui.setMicButton(state);
ui.setShareButton({ sharing: false, supported: screenShareSupported() });
ui.setLobby('conectando…', 'idle');

if (!mediaSupported()) {
  ui.setJoinError('Este navegador não suporta WebRTC (ou a página não está em HTTPS/localhost).');
  ui.els.joinBtn.disabled = true;
}

signaling.connect();

