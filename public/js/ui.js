/** Camada de DOM. Nomes vêm de outras pessoas: sempre textContent, nunca innerHTML. */

export const els = {
  joinView: document.getElementById('view-join'),
  callView: document.getElementById('view-call'),
  joinForm: document.getElementById('join-form'),
  nameInput: document.getElementById('name-input'),
  joinBtn: document.getElementById('join-btn'),
  joinError: document.getElementById('join-error'),
  lobbyStatus: document.getElementById('lobby-status'),
  lobbyText: document.getElementById('lobby-text'),
  roomName: document.getElementById('room-name'),
  connPill: document.getElementById('conn-pill'),
  connText: document.getElementById('conn-text'),
  countPill: document.getElementById('count-pill'),
  stage: document.getElementById('stage'),
  grid: document.getElementById('grid'),
  shareArea: document.getElementById('share-area'),
  shareTabs: document.getElementById('share-tabs'),
  shareVideo: document.getElementById('share-video'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  micBtn: document.getElementById('mic-btn'),
  micIcon: document.getElementById('mic-icon'),
  micLabel: document.getElementById('mic-label'),
  shareBtn: document.getElementById('share-btn'),
  shareIcon: document.getElementById('share-icon'),
  shareLabel: document.getElementById('share-label'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsPanel: document.getElementById('settings-panel'),
  micSelect: document.getElementById('mic-select'),
  micMeter: document.getElementById('mic-meter'),
  leaveBtn: document.getElementById('leave-btn'),
  audioSink: document.getElementById('audio-sink'),
  toastEl: document.getElementById('toast'),
};

const cards = new Map();
let toastTimer = null;

/* ---------- helpers ---------- */

function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const chars = words.slice(0, 2).map((word) => Array.from(word)[0] ?? '');
  return chars.join('').toUpperCase() || '?';
}

/** Paleta tropical: arara, verde, louro, laranja, rosa de bloco, turquesa e roxo. */
const CORES_AVATAR = [
  ['#2e7bff', '#1b4fd8'],
  ['#12d18e', '#0a8f63'],
  ['#ffc61e', '#f0930c'],
  ['#ff6a3d', '#dd4218'],
  ['#ff3e8e', '#cf1f66'],
  ['#00c9cf', '#00808c'],
  ['#a06bff', '#6a35d6'],
];

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 9973;
  const [claro, escuro] = CORES_AVATAR[hash % CORES_AVATAR.length];
  return `linear-gradient(150deg, ${claro}, ${escuro})`;
}

const icon = (href, className) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (className) svg.setAttribute('class', className);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', href);
  svg.append(use);
  return svg;
};

/* ---------- views ---------- */

export function showCall(roomName) {
  els.roomName.textContent = roomName;
  els.joinView.hidden = true;
  els.callView.hidden = false;
}

export function showJoin() {
  els.callView.hidden = true;
  els.joinView.hidden = false;
  els.joinBtn.disabled = false;
  els.joinBtn.textContent = 'Entrar na toca';
}

export function setJoinError(message) {
  els.joinError.textContent = message ?? '';
  els.joinError.hidden = !message;
}

export function setLobby(text, state) {
  els.lobbyText.textContent = text;
  els.lobbyStatus.querySelector('.dot').className = `dot dot-${state}`;
}

export function setConnection(text, state) {
  els.connText.textContent = text;
  els.connPill.querySelector('.dot').className = `dot dot-${state}`;
}

export function setCount(count) {
  els.countPill.textContent = count === 1 ? '1 na toca' : `${count} na toca`;
}

/* ---------- participantes ---------- */

export function upsertParticipant(peer) {
  let card = cards.get(peer.id);

  if (!card) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = peer.id;
    el.setAttribute('role', 'listitem');

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'compartilhando';
    tag.hidden = true;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';

    const nameRow = document.createElement('div');
    nameRow.className = 'card-name';
    const nameText = document.createElement('span');
    const micOff = icon('#i-mic-off');
    micOff.setAttribute('aria-label', 'microfone desligado');
    // SVGElement não tem a propriedade `hidden` do HTML: só o atributo esconde.
    micOff.toggleAttribute('hidden', true);
    nameRow.append(nameText, micOff);

    const status = document.createElement('div');
    status.className = 'card-status';

    el.append(tag, avatar, nameRow, status);

    if (peer.isLocal) {
      const you = document.createElement('span');
      you.className = 'tag tag-you';
      you.textContent = 'você';
      el.append(you);
      el.classList.add('is-local');
    }

    els.grid.append(el);
    card = { el, tag, avatar, nameText, micOff, status };
    cards.set(peer.id, card);
  }

  card.nameText.textContent = peer.name;
  card.avatar.textContent = initials(peer.name);
  card.avatar.style.setProperty('--av-bg', avatarColor(peer.name));
  card.tag.hidden = !peer.sharing;
  card.micOff.toggleAttribute('hidden', !(peer.muted || !peer.hasMic));
  card.status.textContent = statusText(peer);
  card.el.classList.toggle('broken', !peer.isLocal && (peer.connection === 'failed' || peer.connection === 'disconnected'));
}

function statusText(peer) {
  if (peer.isLocal) return peer.hasMic ? (peer.muted ? 'seu microfone está mudo' : '') : 'só ouvindo';
  if (peer.connection === 'failed' || peer.connection === 'disconnected') return 'sem conexão com você';
  if (peer.connection === 'new' || peer.connection === 'connecting') return 'conectando…';
  if (!peer.hasMic) return 'só ouvindo';
  return peer.muted ? 'mudo' : '';
}

export function removeParticipant(id) {
  cards.get(id)?.el.remove();
  cards.delete(id);
}

export function setSpeaking(id, speaking) {
  cards.get(id)?.el.classList.toggle('speaking', speaking);
}

export function clearParticipants() {
  for (const id of [...cards.keys()]) removeParticipant(id);
}

/* ---------- tela compartilhada ---------- */

export function renderShareTabs(sharers, activeId, onSelect) {
  els.shareTabs.replaceChildren();
  if (sharers.length < 2) return;

  for (const peer of sharers) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.textContent = peer.isLocal ? 'Sua tela' : `Tela de ${peer.name}`;
    tab.setAttribute('aria-selected', String(peer.id === activeId));
    tab.addEventListener('click', () => onSelect(peer.id));
    els.shareTabs.append(tab);
  }
}

export function setStageShare(stream) {
  const active = Boolean(stream);
  els.shareArea.hidden = !active;
  els.stage.classList.toggle('has-share', active);

  if (els.shareVideo.srcObject !== (stream ?? null)) {
    els.shareVideo.srcObject = stream ?? null;
    if (active) els.shareVideo.play().catch(() => {});
  }
}

/* ---------- controles ---------- */

export function setMicButton({ muted, hasMic }) {
  els.micBtn.disabled = !hasMic;
  els.micBtn.classList.toggle('is-off', muted || !hasMic);
  els.micBtn.setAttribute('aria-pressed', String(!muted && hasMic));
  els.micIcon.setAttribute('href', muted || !hasMic ? '#i-mic-off' : '#i-mic');
  els.micLabel.textContent = !hasMic ? 'Sem mic' : muted ? 'Mudo' : 'Falando';
}

export function setShareButton({ sharing, supported }) {
  els.shareBtn.disabled = !supported;
  els.shareBtn.setAttribute('aria-pressed', String(sharing));
  els.shareIcon.setAttribute('href', sharing ? '#i-screen-off' : '#i-screen');
  els.shareLabel.textContent = sharing ? 'Parar' : 'Compartilhar';
}

export function setMicMeter(level) {
  els.micMeter.style.width = `${Math.min(100, Math.round(level * 320))}%`;
}

export function renderMicOptions(devices, currentId) {
  els.micSelect.replaceChildren();
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label;
    option.selected = device.deviceId === currentId;
    els.micSelect.append(option);
  }
  els.micSelect.disabled = devices.length === 0;
}

export function toast(message, ms = 3200) {
  els.toastEl.textContent = message;
  els.toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toastEl.hidden = true;
  }, ms);
}
