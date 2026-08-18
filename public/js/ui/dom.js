/** Referências e utilidades de DOM. Nomes vêm de outras pessoas: sempre textContent. */

export const $ = (id) => document.getElementById(id);

export const els = {
  joinView: $('view-join'),
  callView: $('view-call'),
  joinForm: $('join-form'),
  joinRoom: $('join-room'),
  nameInput: $('name-input'),
  avatarBtn: $('avatar-btn'),
  pronounsInput: $('pronouns-input'),
  colorRow: $('color-row'),
  joinMicSelect: $('join-mic-select'),
  joinMeter: $('join-meter'),
  micTestBtn: $('mic-test-btn'),
  passwordField: $('password-field'),
  passwordInput: $('password-input'),
  joinBtn: $('join-btn'),
  joinError: $('join-error'),
  lobbyStatus: $('lobby-status'),
  lobbyText: $('lobby-text'),
  roomsOpen: $('rooms-open'),
  roomsList: $('rooms-list'),

  roomName: $('room-name'),
  inviteBtn: $('invite-btn'),
  roomBtn: $('room-btn'),
  connPill: $('conn-pill'),
  connText: $('conn-text'),
  countPill: $('count-pill'),
  pinnedBar: $('pinned-bar'),
  pinnedText: $('pinned-text'),
  pinnedClear: $('pinned-clear'),

  stage: $('stage'),
  grid: $('grid'),
  aloneHint: $('alone-hint'),
  shareArea: $('share-area'),
  shareTabs: $('share-tabs'),
  shareVideo: $('share-video'),
  watchers: $('watchers'),
  zoomIn: $('zoom-in-btn'),
  zoomOut: $('zoom-out-btn'),
  shotBtn: $('shot-btn'),
  pipBtn: $('pip-btn'),
  fullscreenBtn: $('fullscreen-btn'),

  chatPanel: $('chat-panel'),
  chatLog: $('chat-log'),
  chatForm: $('chat-form'),
  chatInput: $('chat-input'),
  chatClose: $('chat-close'),
  chatBadge: $('chat-badge'),
  typingLine: $('typing-line'),
  reactionRow: $('reaction-row'),
  reactionsLayer: $('reactions-layer'),

  micBtn: $('mic-btn'),
  micIcon: $('mic-icon'),
  micLabel: $('mic-label'),
  deafenBtn: $('deafen-btn'),
  deafenIcon: $('deafen-icon'),
  shareBtn: $('share-btn'),
  shareIcon: $('share-icon'),
  shareLabel: $('share-label'),
  camBtn: $('cam-btn'),
  camIcon: $('cam-icon'),
  camLabel: $('cam-label'),
  handBtn: $('hand-btn'),
  chatBtn: $('chat-btn'),
  settingsBtn: $('settings-btn'),
  leaveBtn: $('leave-btn'),

  audioSink: $('audio-sink'),
  liveRegion: $('live-region'),
  toastEl: $('toast'),
  emojiPop: $('emoji-pop'),
  peerMenu: $('peer-menu'),
};

/** Cria um <svg><use> apontando pro sprite. */
export function icon(href, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (className) svg.setAttribute('class', className);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', href);
  svg.append(use);
  return svg;
}

/** SVGElement não tem a propriedade `hidden` do HTML: só o atributo esconde. */
export const show = (el, visible) => el?.toggleAttribute('hidden', !visible);

export function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Avisa quem usa leitor de tela sem poluir a interface. */
export function announce(text) {
  els.liveRegion.textContent = '';
  requestAnimationFrame(() => (els.liveRegion.textContent = text));
}

let toastTimer = null;
export function toast(message, ms = 3200) {
  els.toastEl.textContent = message;
  show(els.toastEl, true);
  announce(message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show(els.toastEl, false), ms);
}

export const initials = (name) => {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => Array.from(word)[0] ?? '').join('').toUpperCase() || '?';
};

/** Paleta tropical: arara, verde, louro, laranja, rosa de bloco, turquesa e roxo. */
export const PALETTE = [
  ['#2e7bff', '#1b4fd8'],
  ['#12d18e', '#0a8f63'],
  ['#ffc61e', '#f0930c'],
  ['#ff6a3d', '#dd4218'],
  ['#ff3e8e', '#cf1f66'],
  ['#00c9cf', '#00808c'],
  ['#a06bff', '#6a35d6'],
];

export function paletteIndex(name) {
  let hash = 0;
  const text = String(name ?? '');
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 9973;
  return hash % PALETTE.length;
}

export function gradientFor(peer) {
  const index = Number.isInteger(Number(peer.color)) && peer.color !== '' ? Number(peer.color) : paletteIndex(peer.name);
  const [claro, escuro] = PALETTE[index % PALETTE.length];
  return `linear-gradient(150deg, ${claro}, ${escuro})`;
}
