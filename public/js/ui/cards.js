/** A grade de participantes: card por pessoa, com estado, qualidade e menu. */

import { element, els, gradientFor, icon, initials, show } from './dom.js';

const cards = new Map();
let order = [];

const BADGES = [
  { key: 'hand', href: '#i-hand', title: 'mão levantada', className: 'badge-hand' },
  { key: 'sharing', href: '#i-screen', title: 'compartilhando a tela', className: 'badge-share' },
  { key: 'camera', href: '#i-cam', title: 'com câmera', className: 'badge-cam' },
];

function build(peer) {
  const el = element('div', 'card');
  el.dataset.id = peer.id;
  el.setAttribute('role', 'listitem');
  el.tabIndex = 0;

  const top = element('div', 'card-top');
  const badges = element('div', 'card-badges');
  for (const badge of BADGES) {
    const svg = icon(badge.href, badge.className);
    svg.setAttribute('aria-label', badge.title);
    svg.toggleAttribute('hidden', true);
    badges.append(svg);
  }
  const role = element('span', 'card-role');
  role.toggleAttribute('hidden', true);
  top.append(badges, role);

  const avatar = element('div', 'avatar');
  const nameRow = element('div', 'card-name');
  const nameText = element('span');
  const micOff = icon('#i-mic-off', 'mic-off');
  micOff.setAttribute('aria-label', 'microfone desligado');
  micOff.toggleAttribute('hidden', true);
  nameRow.append(nameText, micOff);

  const pronouns = element('div', 'card-pronouns');
  const status = element('div', 'card-status');
  const quality = element('div', 'card-quality');
  quality.toggleAttribute('hidden', true);

  el.append(top, avatar, nameRow, pronouns, status, quality);
  els.grid.append(el);

  const card = { el, badges, role, avatar, nameText, micOff, pronouns, status, quality, video: null };
  cards.set(peer.id, card);
  return card;
}

export function upsert(peer) {
  const card = cards.get(peer.id) ?? build(peer);

  card.el.classList.toggle('is-local', Boolean(peer.isLocal));
  card.nameText.textContent = peer.name;
  card.avatar.textContent = peer.avatar || initials(peer.name);
  card.avatar.classList.toggle('avatar-emoji', Boolean(peer.avatar));
  card.avatar.style.setProperty('--av-bg', gradientFor(peer));
  card.pronouns.textContent = peer.pronouns || '';
  show(card.pronouns, Boolean(peer.pronouns));

  BADGES.forEach((badge, index) => show(card.badges.children[index], Boolean(peer[badge.key])));
  const roleLabel = peer.role === 'owner' ? 'dono' : peer.role === 'mod' ? 'moderação' : '';
  card.role.textContent = roleLabel;
  show(card.role, Boolean(roleLabel));

  card.micOff.toggleAttribute('hidden', !(peer.muted || !peer.hasMic));
  card.status.textContent = statusText(peer);
  card.el.classList.toggle('broken', isBroken(peer));
  card.el.classList.toggle('is-pending', Boolean(peer.pending));

  if (peer.quality && !peer.isLocal) {
    card.quality.textContent = `${peer.quality.rtt} ms · ${(peer.quality.loss * 100).toFixed(0)}% perda`;
    card.quality.dataset.grade = peer.quality.grade;
    show(card.quality, true);
  } else {
    show(card.quality, false);
  }

  attachVideo(card, peer);
  return card;
}

/** A câmera entra dentro do próprio card, no lugar do avatar. */
function attachVideo(card, peer) {
  if (peer.camera && peer.cameraStream) {
    if (!card.video) {
      card.video = element('video', 'card-video');
      card.video.autoplay = true;
      card.video.playsInline = true;
      card.video.muted = true;
      card.el.prepend(card.video);
    }
    if (card.video.srcObject !== peer.cameraStream) card.video.srcObject = peer.cameraStream;
    card.el.classList.add('has-video');
  } else if (card.video) {
    card.video.srcObject = null;
    card.video.remove();
    card.video = null;
    card.el.classList.remove('has-video');
  }
}

const isBroken = (peer) =>
  !peer.isLocal && (peer.connection === 'failed' || peer.connection === 'disconnected');

function statusText(peer) {
  if (peer.pending) return 'reconectando…';
  if (peer.isLocal) return peer.hasMic ? (peer.muted ? 'seu microfone está mudo' : '') : 'só ouvindo';
  if (isBroken(peer)) return 'sem conexão com você';
  if (peer.connection === 'new' || peer.connection === 'connecting') return 'conectando…';
  if (peer.locallyMuted) return 'silenciado por você';
  if (!peer.hasMic) return 'só ouvindo';
  return peer.muted ? 'mudo' : '';
}

export function remove(id) {
  const card = cards.get(id);
  if (!card) return;
  if (card.video) card.video.srcObject = null;
  card.el.remove();
  cards.delete(id);
}

export function clear() {
  for (const id of [...cards.keys()]) remove(id);
  order = [];
}

export function setSpeaking(id, speaking) {
  cards.get(id)?.el.classList.toggle('speaking', speaking);
  if (speaking) spotlight(id);
}

/** No layout "foco", quem está falando ocupa o card grande. */
function spotlight(id) {
  for (const [other, card] of cards) card.el.classList.toggle('is-spotlight', other === id);
}

/** Quem falou por último sobe: em toca cheia é o que importa ver. */
export function bump(id) {
  order = [id, ...order.filter((other) => other !== id)];
  order.forEach((other, index) => {
    const card = cards.get(other);
    if (card) card.el.style.order = String(index);
  });
}

export const cardElement = (id) => cards.get(id)?.el ?? null;
export const ids = () => [...cards.keys()];
