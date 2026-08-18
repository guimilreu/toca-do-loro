/**
 * Orquestração: liga sinalização, malha P2P, áudio e interface.
 *
 * Cada módulo cuida de uma coisa só — aqui é onde eles se encontram, e o estado
 * da toca vive em `state`.
 */

import { AudioHub } from './audio.js';
import { cameraSupported, getCamera, getMic, getScreen, listDevices, mediaSupported, outputPickSupported, screenShareSupported, stopStream } from './media.js';
import { Mesh } from './mesh.js';
import { Quality, grade } from './stats.js';
import { Signaling } from './signaling.js';
import { blocklist, clientId, peerVolume, prefs } from './storage.js';
import * as cards from './ui/cards.js';
import * as chat from './ui/chat.js';
import * as dialogs from './ui/dialogs.js';
import { els, show, toast } from './ui/dom.js';
import * as shell from './ui/shell.js';
import * as stage from './ui/stage.js';

const MAX_SHARES = 2;

const state = {
  self: null,
  room: null,
  inCall: false,
  peers: new Map(),
  micStream: null,
  micTrack: null,
  hasMic: false,
  muted: false,
  forcedMute: false,
  screenStream: null,
  sharing: false,
  cameraStream: null,
  camera: false,
  hand: false,
  activeShare: null,
  slug: '',
  password: '',
  token: '',
  invite: '',
  version: null,
  audioBlocked: false,
  wakeLock: null,
  quality: new Map(),
};

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const signaling = new Signaling(wsUrl);

const audio = new AudioHub((id, speaking, level) => {
  if (id === 'self') {
    dialogs.setMicMeter(level);
    if (state.self) {
      cards.setSpeaking(state.self.id, speaking && !state.muted);
      if (speaking && !state.muted) cards.bump(state.self.id);
      warnIfMuted(speaking);
    }
    return;
  }
  cards.setSpeaking(id, speaking);
  if (speaking) cards.bump(id);
});

const mesh = new Mesh({
  send: (to, data) => signaling.send({ type: 'signal', to, data }),
  onTrack: handleTrack,
  onStateChange: (id, connection) => {
    const peer = state.peers.get(id);
    if (!peer) return;
    peer.connection = connection;
    cards.upsert(peer);
  },
});

const quality = new Quality(
  () => mesh.connections(),
  (id, data) => {
    const peer = state.peers.get(id);
    if (!peer) return;
    peer.quality = data;
    state.quality.set(id, data);
    cards.upsert(peer);
  },
  ({ outgoing, limitation }) => {
    // O teto do vídeo segue a banda que o navegador mediu, não um número fixo.
    if (outgoing) mesh.setScreenCeiling(outgoing * 0.7);
    if (limitation === 'cpu' && state.sharing) warnCpu();
  },
);

let cpuWarnAt = 0;
function warnCpu() {
  if (Date.now() - cpuWarnAt < 60_000) return;
  cpuWarnAt = Date.now();
  toast('Seu computador está no limite: baixei a qualidade da tela.', 6000);
}

/* ============================ rota ============================ */

function readRoute() {
  const match = location.pathname.match(/^\/r\/([^/]+)/);
  const params = new URLSearchParams(location.search);
  return { slug: match ? decodeURIComponent(match[1]) : '', token: params.get('t') ?? '' };
}

function writeRoute(slug) {
  const url = slug ? `/r/${encodeURIComponent(slug)}` : '/';
  if (location.pathname !== url) history.replaceState(null, '', url);
}

const inviteUrl = (token) => `${location.origin}/r/${encodeURIComponent(state.slug)}${token ? `?t=${token}` : ''}`;

/* ============================ sinalização ============================ */

signaling
  .on('open', () => {
    shell.setConnection('conectado', 'on');
    shell.setLobby('conectado', 'on');
    if (state.inCall) sendJoin({ resume: state.self?.id });
  })
  .on('hello', (msg) => {
    state.version ??= msg.version;
    if (state.version !== msg.version) shell.askReload(msg.version);
    shell.renderRooms(msg.rooms, pickRoom);
    shell.setLobby(lobbyText(msg.rooms), 'on');
  })
  .on('rooms', (msg) => {
    shell.renderRooms(msg.rooms, pickRoom);
    if (!state.inCall) shell.setLobby(lobbyText(msg.rooms), 'on');
  })
  .on('welcome', (msg) => {
    const resumed = Boolean(msg.resumed);
    state.self = msg.self;
    state.room = msg.room;
    state.slug = msg.room.slug;
    state.inCall = true;
    state.forcedMute = Boolean(msg.self.forcedMute);
    state.invite = msg.invite;
    mesh.configure(msg.iceServers);
    writeRoute(msg.room.slug);
    dialogs.setInvite(inviteUrl(msg.invite));

    if (!resumed) {
      resetPeers();
      addParticipant({ ...msg.self, isLocal: true });
      // Quem já estava na toca é que chama quem chegou.
      for (const peer of msg.peers) {
        addParticipant(peer);
        mesh.connect(peer.id, false);
      }
    } else {
      for (const peer of msg.peers) if (!state.peers.has(peer.id)) addParticipant(peer);
    }

    shell.showCall(msg.room.name);
    shell.setConnection('conectado', 'on');
    shell.setOwnerTools(canModerate());
    shell.setPinned(msg.room.pinned, canModerate(), () => signaling.send({ type: 'room', action: 'pin', value: '' }));
    refreshCall();
    audio.resume();
    if (state.micStream) {
      state.micTrack = audio.setMicStream(state.micStream);
      mesh.setLocalTrack('mic', state.micTrack);
      applyMute(state.muted);
    }
    quality.start();
    keepAwake();
    refreshDevices();
    if (!resumed) dialogs.maybeOnboarding();
  })
  .on('peer-joined', (msg) => {
    addParticipant(msg.peer);
    mesh.connect(msg.peer.id, true);
    refreshCall();
    audio.blip('join');
    toast(`${msg.peer.name} entrou`);
  })
  .on('peer-left', (msg) => {
    const peer = state.peers.get(msg.id);
    if (!peer) return;
    dropPeer(msg.id);
    refreshCall();
    audio.blip('leave');
    toast(`${peer.name} saiu`);
  })
  .on('peer-state', (msg) => {
    const peer = state.peers.get(msg.id);
    if (!peer) return;
    Object.assign(peer, msg);
    cards.upsert(peer);
    refreshCall();
  })
  .on('room-info', (msg) => {
    state.room = msg.room;
    shell.setRoomName(msg.room.name);
    shell.setPinned(msg.room.pinned, canModerate(), () => signaling.send({ type: 'room', action: 'pin', value: '' }));
  })
  .on('pinned', (msg) => {
    if (state.room) state.room.pinned = msg.text;
    shell.setPinned(msg.text, canModerate(), () => signaling.send({ type: 'room', action: 'pin', value: '' }));
  })
  .on('signal', (msg) => mesh.handleSignal(msg.from, msg.data))
  .on('chat', (msg) => {
    const peer = state.peers.get(msg.from);
    if (peer && blocklist.has(peer.name)) return;
    chat.addMessage({ name: msg.name, text: msg.text, mine: msg.from === state.self?.id });
    if (msg.from !== state.self?.id) audio.blip('chat');
  })
  .on('reaction', (msg) => chat.flyReaction(msg.emoji))
  .on('typing', (msg) => chat.showTyping(msg.id, msg.name))
  .on('invite', (msg) => dialogs.setInvite(inviteUrl(msg.token)))
  .on('forced', (msg) => {
    if (typeof msg.muted === 'boolean') {
      state.forcedMute = msg.muted;
      if (msg.muted) applyMute(true);
      toast(msg.muted ? `${msg.by} silenciou você.` : `${msg.by} liberou seu microfone.`);
    }
    if (msg.sharing === false && state.sharing) {
      stopShare();
      toast(`${msg.by} encerrou seu compartilhamento.`);
    }
    shell.setMicButton(state);
  })
  .on('kicked', (msg) => {
    leave({ silent: true });
    shell.setJoinError(msg.blocked ? `${msg.by} tirou você da toca e barrou a entrada.` : `${msg.by} tirou você da toca.`);
  })
  .on('move', (msg) => {
    toast(`${msg.by} te mandou pra outra toca.`);
    leave({ silent: true, keepName: true });
    state.slug = msg.slug;
    sendJoin();
  })
  .on('error', (msg) => handleServerError(msg))
  .on('bye', () => shell.setConnection('servidor reiniciando…', 'idle'))
  .on('close', () => {
    shell.setConnection('reconectando…', 'idle');
    shell.setLobby('reconectando…', 'idle');
  })
  .on('reconnecting', (msg) => {
    const segundos = Math.ceil(msg.delay / 1000);
    shell.setConnection(`reconectando em ${segundos}s`, 'idle');
  });

function handleServerError(msg) {
  const mensagens = {
    'room-full': `A toca está cheia (máximo ${msg.max}). Tente daqui a pouco.`,
    'bad-password': 'Senha errada.',
    locked: 'A toca está trancada no momento.',
    blocked: 'Você foi barrado nesta toca.',
    'not-open': `Essa toca abre ${new Date(msg.opensAt).toLocaleString('pt-BR')}.`,
    'too-many-rooms': 'Tem tocas demais abertas no servidor.',
    'too-many-joins': 'Muitas tentativas seguidas. Espere um minuto.',
    'rate-limited': 'Você mandou mensagens demais. Espere um pouco.',
    'not-allowed': 'Só quem é dono da toca pode fazer isso.',
  };

  if (msg.code === 'bad-password') shell.setPasswordVisible(true);
  if (msg.code === 'not-allowed') return toast(mensagens[msg.code]);

  state.inCall = false;
  shell.setJoining(false);
  shell.setJoinError(mensagens[msg.code] ?? 'Não deu pra entrar agora.');
}

const lobbyText = (rooms) => {
  const total = rooms.reduce((soma, room) => soma + room.count, 0);
  if (!total) return 'ninguém na toca agora';
  return total === 1 ? '1 pessoa na toca agora' : `${total} pessoas nas tocas agora`;
};

/* ============================ participantes ============================ */

function addParticipant(peer) {
  const participant = {
    ...peer,
    isLocal: Boolean(peer.isLocal),
    connection: peer.isLocal ? 'connected' : 'new',
    screenStream: null,
    cameraStream: null,
    volume: peerVolume.get(peer.name),
    locallyMuted: blocklist.has(peer.name),
  };
  state.peers.set(peer.id, participant);
  cards.upsert(participant);
  return participant;
}

function dropPeer(id) {
  mesh.disconnect(id);
  audio.removePeer(id);
  state.peers.delete(id);
  state.quality.delete(id);
  cards.remove(id);

  for (const role of ['mic', 'screen-audio']) {
    const el = document.getElementById(`audio-${id}-${role}`);
    if (el) {
      el.srcObject = null;
      el.remove();
    }
  }
}

function resetPeers() {
  for (const id of [...state.peers.keys()]) dropPeer(id);
  cards.clear();
}

/* ============================ mídia remota ============================ */

function handleTrack(id, role, track) {
  const peer = state.peers.get(id);
  if (!peer) return;

  if (role === 'screen-video' || role === 'camera') {
    const stream = new MediaStream([track]);
    if (role === 'camera') peer.cameraStream = stream;
    else peer.screenStream = stream;
    track.addEventListener('unmute', refreshCall);
    track.addEventListener('mute', refreshCall);
    cards.upsert(peer);
    refreshCall();
    return;
  }

  const stream = new MediaStream([track]);
  const el = audioElement(id, role);
  el.srcObject = stream;
  // O <audio> fica mudo: quem toca de verdade é o grafo do Web Audio.
  el.muted = true;
  play(el);

  if (role === 'mic') {
    audio.addPeer(id, stream);
    audio.setVolume(id, peer.volume ?? 1);
    audio.setMuted(id, Boolean(peer.locallyMuted));
    audio.layout([...state.peers.keys()].filter((other) => other !== state.self?.id));
  } else {
    el.muted = state.activeShare !== id;
  }
}

function audioElement(id, role) {
  const key = `audio-${id}-${role}`;
  let el = document.getElementById(key);
  if (el) return el;

  el = document.createElement('audio');
  el.id = key;
  el.autoplay = true;
  el.playsInline = true;
  els.audioSink.append(el);
  applySink(el);
  return el;
}

function applySink(el) {
  if (prefs.outId && el.setSinkId) el.setSinkId(prefs.outId).catch(() => {});
}

function play(el) {
  el.play().catch(() => {
    if (state.audioBlocked) return;
    state.audioBlocked = true;
    toast('Clique na página para liberar o áudio.', 6000);
    document.addEventListener(
      'click',
      () => {
        state.audioBlocked = false;
        audio.resume();
        for (const media of els.audioSink.querySelectorAll('audio')) media.play().catch(() => {});
      },
      { once: true },
    );
  });
}

/* ============================ estado da call ============================ */

function refreshCall() {
  const sharers = [...state.peers.values()].filter((peer) => peer.sharing && peer.screenStream);

  if (!sharers.some((peer) => peer.id === state.activeShare)) {
    state.activeShare = sharers.at(-1)?.id ?? null;
  }

  const active = sharers.find((peer) => peer.id === state.activeShare) ?? null;
  stage.setShare(active?.screenStream ?? null);
  stage.renderTabs(sharers, state.activeShare, selectShare);
  shell.setCount(state.peers.size);

  for (const peer of state.peers.values()) {
    const el = document.getElementById(`audio-${peer.id}-screen-audio`);
    if (el) el.muted = peer.id !== state.activeShare;
  }

  const watchers = [...state.peers.values()].filter((peer) => peer.watching === state.self?.id).length;
  stage.setWatchers(state.sharing ? watchers : 0);

  show(els.aloneHint, state.peers.size <= 1);
  audio.layout([...state.peers.keys()].filter((id) => id !== state.self?.id));
}

function selectShare(id) {
  state.activeShare = id;
  signaling.send({ type: 'state', watching: id });
  refreshCall();
}

function publishState() {
  signaling.send({
    type: 'state',
    muted: state.muted,
    sharing: state.sharing,
    camera: state.camera,
    hasMic: state.hasMic,
    hand: state.hand,
    watching: state.activeShare,
  });

  const self = state.peers.get(state.self?.id);
  if (self) {
    Object.assign(self, {
      muted: state.muted,
      sharing: state.sharing,
      camera: state.camera,
      hasMic: state.hasMic,
      hand: state.hand,
    });
    cards.upsert(self);
  }
  shell.setMicButton(state);
  shell.setShareButton({ sharing: state.sharing, supported: screenShareSupported() });
  shell.setCameraButton({ on: state.camera, supported: cameraSupported() });
  shell.setHandButton(state.hand);
}

const canModerate = () => ['owner', 'mod'].includes(state.peers.get(state.self?.id)?.role ?? state.self?.role);
const isOwner = () => (state.peers.get(state.self?.id)?.role ?? state.self?.role) === 'owner';

/* ============================ entrada ============================ */

els.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!mediaSupported()) {
    return shell.setJoinError('Este navegador não suporta WebRTC. Use Chrome, Edge, Firefox ou Safari atualizados.');
  }

  const name = els.nameInput.value.trim();
  if (!name) return shell.setJoinError('Escolha um nome para entrar.');

  shell.setJoinError('');
  shell.setJoining(true);
  prefs.name = name;
  prefs.pronouns = els.pronounsInput.value.trim();
  state.password = els.passwordInput.value;

  await acquireMic();
  if (!signaling.connected) return shell.setJoinError('Sem conexão com o servidor. Tentando de novo…');
  sendJoin();
});

async function acquireMic() {
  try {
    stopStream(state.micStream);
    state.micStream = await getMic();
    state.hasMic = true;
    state.muted = false;
    state.micTrack = audio.setMicStream(state.micStream);
    mesh.setLocalTrack('mic', state.micTrack);
  } catch (error) {
    state.hasMic = false;
    state.muted = true;
    console.warn('[mic]', error);
    toast(micErrorMessage(error), 5000);
  }
  shell.setMicButton(state);
}

/** Erro de microfone precisa dizer o que fazer, não só que deu errado. */
function micErrorMessage(error) {
  const nome = error?.name;
  if (nome === 'NotAllowedError') return 'Você bloqueou o microfone. Libere no cadeado da barra de endereço e recarregue.';
  if (nome === 'NotFoundError') return 'Nenhum microfone encontrado. Você entra só ouvindo.';
  if (nome === 'NotReadableError') return 'O microfone está ocupado por outro programa. Feche-o e tente de novo.';
  return 'Sem acesso ao microfone: você entra só ouvindo.';
}

function sendJoin(extra = {}) {
  signaling.send({
    type: 'join',
    slug: state.slug,
    token: state.token,
    password: state.password,
    name: els.nameInput.value.trim() || prefs.name || 'Anônimo',
    avatar: prefs.avatar,
    color: prefs.color,
    pronouns: prefs.pronouns,
    clientId: clientId(),
    muted: state.muted,
    hasMic: state.hasMic,
    ...extra,
  });
}

function pickRoom(slug) {
  state.slug = slug;
  state.token = '';
  shell.setJoinRoom(slug, slug);
  els.nameInput.focus();
}

/* ============================ controles ============================ */

els.micBtn.addEventListener('click', () => {
  if (!state.hasMic || state.forcedMute) return;
  applyMute(!state.muted);
  publishState();
});

function applyMute(muted) {
  state.muted = muted;
  for (const track of state.micStream?.getAudioTracks() ?? []) track.enabled = !muted;
  if (state.micTrack) state.micTrack.enabled = !muted;
  shell.setMicButton(state);
}

let mutedWarnAt = 0;
/** Falar no mudo é o erro mais comum de toda call: avisa, sem encher o saco. */
function warnIfMuted(speaking) {
  if (!speaking || !state.muted || !state.hasMic) return;
  if (Date.now() - mutedWarnAt < 12_000) return;
  mutedWarnAt = Date.now();
  toast('Você está falando no mudo.');
}

els.deafenBtn.addEventListener('click', () => {
  const deafened = !audio.deafened;
  audio.setDeafened(deafened);
  shell.setDeafenButton(deafened);
  if (deafened && !state.muted) {
    applyMute(true);
    publishState();
  }
});

els.shareBtn.addEventListener('click', () => (state.sharing ? stopShare() : startShare()));

async function startShare() {
  const outros = [...state.peers.values()].filter((peer) => peer.sharing && !peer.isLocal).length;
  if (outros >= MAX_SHARES) return toast(`Já tem ${outros} telas ligadas. Peça pra alguém parar antes.`);

  try {
    const stream = await getScreen();
    state.screenStream = stream;
    state.sharing = true;

    const video = stream.getVideoTracks()[0];
    mesh.setLocalTrack('screen-video', video);
    mesh.setLocalTrack('screen-audio', stream.getAudioTracks()[0] ?? null);
    video.addEventListener('ended', stopShare, { once: true });

    const self = state.peers.get(state.self.id);
    if (self) self.screenStream = stream;
    state.activeShare = state.self.id;

    publishState();
    refreshCall();
  } catch (error) {
    if (error?.name !== 'NotAllowedError') {
      console.warn('[share]', error);
      toast('Não foi possível compartilhar a tela. Verifique a permissão de gravação de tela do navegador.');
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

els.camBtn.addEventListener('click', () => (state.camera ? stopCamera() : startCamera()));

async function startCamera() {
  try {
    state.cameraStream = await getCamera();
    state.camera = true;
    mesh.setLocalTrack('camera', state.cameraStream.getVideoTracks()[0]);
    const self = state.peers.get(state.self.id);
    if (self) self.cameraStream = state.cameraStream;
    publishState();
    cards.upsert(self);
  } catch (error) {
    console.warn('[camera]', error);
    toast(error?.name === 'NotAllowedError' ? 'Você bloqueou a câmera no navegador.' : 'Não consegui abrir a câmera.');
  }
}

function stopCamera() {
  mesh.setLocalTrack('camera', null);
  stopStream(state.cameraStream);
  state.cameraStream = null;
  state.camera = false;
  const self = state.peers.get(state.self?.id);
  if (self) self.cameraStream = null;
  publishState();
  if (self) cards.upsert(self);
}

els.handBtn.addEventListener('click', () => {
  state.hand = !state.hand;
  if (state.hand) audio.blip('hand');
  publishState();
});

els.chatBtn.addEventListener('click', () => chat.toggle());
els.chatClose.addEventListener('click', () => chat.toggle(false));
els.chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  signaling.send({ type: 'chat', text });
  els.chatInput.value = '';
});

let typingSentAt = 0;
els.chatInput.addEventListener('input', () => {
  if (Date.now() - typingSentAt < 2000) return;
  typingSentAt = Date.now();
  signaling.send({ type: 'typing' });
});

chat.initReactions((emoji) => signaling.send({ type: 'reaction', emoji }));

els.settingsBtn.addEventListener('click', () => dialogs.openSettings());

els.inviteBtn.addEventListener('click', () => {
  dialogs.openInvite(inviteUrl(state.invite), (hours) => signaling.send({ type: 'invite', hours }));
});

els.roomBtn.addEventListener('click', () => {
  dialogs.openRoom(state.room, {
    onLock: (value) => signaling.send({ type: 'room', action: 'lock', value }),
    onMuteAll: () => signaling.send({ type: 'mod', action: 'mute-all' }),
    onSave: ({ name, password, limit, pinned }) => {
      signaling.send({ type: 'room', action: 'rename', value: name });
      signaling.send({ type: 'room', action: 'limit', value: limit });
      signaling.send({ type: 'room', action: 'pin', value: pinned });
      if (password !== '') signaling.send({ type: 'room', action: 'password', value: password });
      toast('Toca atualizada.');
    },
  });
});

els.grid.addEventListener('click', (event) => {
  const card = event.target.closest('.card');
  if (!card) return;
  const peer = state.peers.get(card.dataset.id);
  if (!peer) return;

  shell.openPeerMenu(card, peer, {
    canModerate: canModerate(),
    isOwner: isOwner(),
    onVolume: (value) => {
      peer.volume = value;
      peerVolume.set(peer.name, value);
      audio.setVolume(peer.id, value);
    },
    onLocalMute: () => {
      peer.locallyMuted = blocklist.toggle(peer.name);
      audio.setMuted(peer.id, peer.locallyMuted);
      cards.upsert(peer);
    },
    onForceMute: () => signaling.send({ type: 'mod', action: 'mute', target: peer.id, value: !peer.muted }),
    onStopScreen: () => signaling.send({ type: 'mod', action: 'stop-screen', target: peer.id }),
    onPromote: () => signaling.send({ type: 'mod', action: 'promote', target: peer.id }),
    onKick: () => signaling.send({ type: 'mod', action: 'kick', target: peer.id }),
    onBlock: () => signaling.send({ type: 'mod', action: 'block', target: peer.id }),
  });
});

els.leaveBtn.addEventListener('click', () => {
  if (state.sharing && !confirm('Você está compartilhando a tela. Sair mesmo assim?')) return;
  leave();
});

function leave({ silent = false } = {}) {
  const nota = notaDaCall();
  stopShare();
  stopCamera();
  signaling.send({ type: 'leave' });

  state.inCall = false;
  mesh.disconnectAll();
  resetPeers();
  quality.stop();
  audio.destroy();
  stopStream(state.micStream);
  releaseWake();

  state.micStream = null;
  state.micTrack = null;
  state.hasMic = false;
  state.self = null;
  state.activeShare = null;
  state.token = '';
  chat.clear();
  stage.setShare(null);
  writeRoute('');

  shell.showJoin();
  shell.setLobby('conectando…', 'idle');
  signaling.close();
  signaling.connect();

  if (!silent && nota) dialogs.openFeedback(nota);
}

function notaDaCall() {
  const notas = [...state.quality.values()].map((item) => item.mos).filter(Boolean);
  if (!notas.length) return '';
  const media = notas.reduce((soma, nota) => soma + nota, 0) / notas.length;
  return `Nota técnica da chamada: ${media.toFixed(1)} de 5 (${grade(media)}).`;
}

window.addEventListener('pagehide', () => {
  // Avisa antes de sumir: sem isso a vaga fica pendente por 15s pra todo mundo.
  if (state.inCall) signaling.send({ type: 'leave' });
  signaling.close();
});
window.addEventListener('beforeunload', (event) => {
  if (!state.sharing) return;
  event.preventDefault();
  event.returnValue = '';
});

/* ============================ dispositivos ============================ */

async function refreshDevices() {
  try {
    const devices = await listDevices();
    dialogs.fillDevices(devices, { outputSupported: outputPickSupported() });
  } catch (error) {
    console.warn('[devices]', error);
  }
}

navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
  await refreshDevices();
  if (state.inCall) toast('A lista de dispositivos de áudio mudou. Confira em Ajustes.');
});

dialogs.initSettings({
  version: null,
  onGain: () => audio.applyGain(),
  onGate: () => audio.syncGate(),
  onSpatial: () => audio.layout([...state.peers.keys()].filter((id) => id !== state.self?.id)),
  onCompact: (value) => shell.setCompact(value),
  onVoiceBitrate: () => mesh.retune(),
  onScreenTuning: () => {
    mesh.retune();
    const track = state.screenStream?.getVideoTracks()[0];
    if (track) track.contentHint = prefs.motion ? 'motion' : 'detail';
  },
  onMicConstraints: async () => {
    if (!state.hasMic) return;
    await acquireMic();
    publishState();
  },
  onMic: async (deviceId) => {
    prefs.micId = deviceId;
    await acquireMic();
    if (state.muted) applyMute(true);
    publishState();
    toast('Microfone trocado.');
  },
  onCamera: async (deviceId) => {
    prefs.camId = deviceId;
    if (state.camera) {
      stopCamera();
      await startCamera();
    }
  },
  onOutput: async (deviceId) => {
    prefs.outId = deviceId;
    for (const el of els.audioSink.querySelectorAll('audio')) applySink(el);
    toast('Saída de som trocada.');
  },
});
dialogs.initInvite();

/* ============================ tela ligada ============================ */

async function keepAwake() {
  try {
    state.wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    /* alguns navegadores só permitem com a aba visível */
  }
}

function releaseWake() {
  state.wakeLock?.release?.().catch(() => {});
  state.wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.inCall && !state.wakeLock) keepAwake();
});

/* ============================ medidor do lobby ============================ */

els.micTestBtn.addEventListener('click', async () => {
  try {
    const stream = await getMic();
    const meter = audio.meter(stream);
    audio.resume();
    els.micTestBtn.disabled = true;
    els.micTestBtn.textContent = 'Fale alguma coisa…';

    const started = Date.now();
    const loop = () => {
      dialogs.setMicMeter(meter.read());
      if (Date.now() - started < 6000) return requestAnimationFrame(loop);
      meter.stop();
      stopStream(stream);
      dialogs.setMicMeter(0);
      els.micTestBtn.disabled = false;
      els.micTestBtn.textContent = 'Testar microfone';
    };
    loop();
  } catch (error) {
    toast(micErrorMessage(error));
  }
});

/* ============================ partida ============================ */

const route = readRoute();
state.slug = route.slug;
state.token = route.token;

els.nameInput.value = prefs.name;
els.pronounsInput.value = prefs.pronouns;
shell.initIdentity();
shell.setCompact(prefs.compact);
shell.setJoinRoom(route.slug, route.slug);
shell.setMicButton(state);
shell.setShareButton({ sharing: false, supported: screenShareSupported() });
shell.setCameraButton({ on: false, supported: cameraSupported() });
shell.setDeafenButton(false);
shell.setLobby('conectando…', 'idle');
dialogs.applyTheme();
stage.initStage();
refreshDevices();

if (!mediaSupported()) {
  shell.setJoinError('Este navegador não suporta WebRTC (ou a página não está em HTTPS).');
  els.joinBtn.disabled = true;
}

signaling.connect();
