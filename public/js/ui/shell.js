/** Casca da aplicação: telas, barra de cima, controles e menus. */

import { PALETTE, element, els, show, toast } from './dom.js';
import { prefs } from '../storage.js';

const AVATARS = ['🦜', '🐢', '🦊', '🐙', '🐝', '🦑', '🐳', '🦩', '🌴', '🍍', '⚡', '🎸', '☕', '🛼', '🌵', '🪁'];

export function showCall(roomName) {
  els.roomName.textContent = roomName;
  setFavicon(true);
  show(els.joinView, false);
  show(els.callView, true);
  document.body.classList.add('in-call');
}

export function showJoin() {
  setFavicon(false);
  show(els.callView, false);
  show(els.joinView, true);
  document.body.classList.remove('in-call');
  els.joinBtn.disabled = false;
  els.joinBtn.textContent = 'Entrar na toca';
}

export function setJoinError(message) {
  els.joinError.textContent = message ?? '';
  show(els.joinError, Boolean(message));
}

export function setJoining(active) {
  els.joinBtn.disabled = active;
  els.joinBtn.textContent = active ? 'Entrando…' : 'Entrar na toca';
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
  document.title = count > 1 ? `(${count}) Toca do Loro` : 'Toca do Loro — call aberta';
}

export function setRoomName(name) {
  els.roomName.textContent = name;
}

export function setPinned(text, canEdit, onClear) {
  els.pinnedText.textContent = text ?? '';
  show(els.pinnedBar, Boolean(text));
  show(els.pinnedClear, Boolean(text) && canEdit);
  els.pinnedClear.onclick = onClear;
}

export function setOwnerTools(visible) {
  show(els.roomBtn, visible);
}

/** Fila de espera: só quem modera vê, e decide ali mesmo. */
export function renderWaiting(people, onDecide) {
  show(els.waitingBar, people.length > 0);
  els.waitingText.textContent = people.length === 1 ? '1 pessoa quer entrar:' : `${people.length} pessoas querem entrar:`;
  els.waitingPeople.replaceChildren();

  for (const person of people) {
    const linha = element('div', 'waiting-line');
    linha.append(element('span', 'waiting-name', person.name));

    const aceitar = element('button', 'btn btn-primary btn-mini', 'Deixar entrar');
    aceitar.type = 'button';
    aceitar.addEventListener('click', () => onDecide(person.id, true));

    const recusar = element('button', 'btn btn-quiet btn-mini', 'Agora não');
    recusar.type = 'button';
    recusar.addEventListener('click', () => onDecide(person.id, false));

    linha.append(aceitar, recusar);
    els.waitingPeople.append(linha);
  }
}

/* ---------------- controles ---------------- */

export function setMicButton({ muted, hasMic, forcedMute }) {
  els.micBtn.disabled = !hasMic || forcedMute;
  els.micBtn.classList.toggle('is-off', muted || !hasMic);
  els.micBtn.setAttribute('aria-pressed', String(!muted && hasMic));
  els.micIcon.setAttribute('href', muted || !hasMic ? '#i-mic-off' : '#i-mic');
  els.micLabel.textContent = forcedMute ? 'Mudo (moderação)' : !hasMic ? 'Sem mic' : muted ? 'Mudo' : 'Falando';
}

export function setDeafenButton(deafened) {
  els.deafenBtn.classList.toggle('is-off', deafened);
  els.deafenBtn.setAttribute('aria-pressed', String(deafened));
  els.deafenIcon.setAttribute('href', deafened ? '#i-sound-off' : '#i-sound');
  els.deafenBtn.querySelector('.ctrl-label').textContent = deafened ? 'Surdo' : 'Ouvindo';
}

export function setShareButton({ sharing, supported }) {
  els.shareBtn.disabled = !supported;
  els.shareBtn.setAttribute('aria-pressed', String(sharing));
  els.shareIcon.setAttribute('href', sharing ? '#i-screen-off' : '#i-screen');
  els.shareLabel.textContent = sharing ? 'Parar' : 'Tela';
}

export function setCameraButton({ on, supported }) {
  els.camBtn.disabled = !supported;
  els.camBtn.setAttribute('aria-pressed', String(on));
  els.camIcon.setAttribute('href', on ? '#i-cam' : '#i-cam-off');
  els.camLabel.textContent = on ? 'Ligada' : 'Câmera';
}

export function setHandButton(raised) {
  els.handBtn.setAttribute('aria-pressed', String(raised));
  els.handBtn.classList.toggle('is-on', raised);
}

const STATUS = {
  ativo: { rotulo: 'Disponível', proximo: 'ausente' },
  ausente: { rotulo: 'Ausente', proximo: 'ocupado' },
  ocupado: { rotulo: 'Não perturbe', proximo: 'ativo' },
};

export function setLayout(layout) {
  els.grid.classList.toggle('compact', layout === 'lista');
  els.grid.classList.toggle('foco', layout === 'foco');
}

export function setStatus(status) {
  const info = STATUS[status] ?? STATUS.ativo;
  els.statusDot.dataset.status = status;
  els.statusLabel.textContent = info.rotulo;
  return info;
}

export const nextStatus = (status) => STATUS[status]?.proximo ?? 'ativo';

/** O ícone da aba muda quando você está em call: dá pra achar a aba no meio de vinte. */
export function setFavicon(inCall) {
  const link = /** @type {HTMLLinkElement|null} */ (document.querySelector('link[rel="icon"]'));
  if (!link) return;
  if (!inCall) {
    link.href = '/favicon.svg';
    return;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="15" fill="#071429"/>
    <circle cx="32" cy="32" r="17" fill="#12d18e"/>
    <path d="M23 26 L5 33 L23 40 Z" fill="#ffc61e"/>
  </svg>`;
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* ---------------- saguão ---------------- */

export function renderRooms(rooms, onPick) {
  els.roomsList.replaceChildren();
  show(els.roomsOpen, rooms.length > 0);

  for (const room of rooms) {
    const item = element('li');
    const button = element('button', 'room-line');
    button.type = 'button';
    button.append(element('span', 'room-name', room.name));
    button.append(element('span', 'room-count', room.count === 1 ? '1 pessoa' : `${room.count} pessoas`));
    if (room.needsPassword) button.append(element('span', 'room-lock', 'com senha'));
    button.addEventListener('click', () => onPick(room.slug));
    item.append(button);
    els.roomsList.append(item);
  }
}

export function setJoinRoom(slug, name) {
  els.joinRoom.textContent = slug ? `Entrando em “${name || slug}”` : '';
  show(els.joinRoom, Boolean(slug));
}

export const setPasswordVisible = (visible) => show(els.passwordField, visible);

/* ---------------- escolhas de identidade ---------------- */

export function initIdentity(onChange) {
  els.avatarBtn.textContent = prefs.avatar;
  els.avatarBtn.addEventListener('click', () => {
    const open = els.emojiPop.hidden;
    show(els.emojiPop, open);
    if (!open) return;

    els.emojiPop.replaceChildren();
    const rect = els.avatarBtn.getBoundingClientRect();
    els.emojiPop.style.left = `${Math.max(12, rect.left)}px`;
    els.emojiPop.style.top = `${rect.bottom + 8}px`;

    for (const emoji of AVATARS) {
      const option = element('button', 'emoji-option', emoji);
      option.type = 'button';
      option.addEventListener('click', () => {
        prefs.avatar = emoji;
        els.avatarBtn.textContent = emoji;
        show(els.emojiPop, false);
        onChange?.();
      });
      els.emojiPop.append(option);
    }
  });

  els.colorRow.replaceChildren();
  PALETTE.forEach(([claro, escuro], index) => {
    const swatch = element('button', 'swatch');
    swatch.type = 'button';
    swatch.style.background = `linear-gradient(150deg, ${claro}, ${escuro})`;
    swatch.title = `Cor ${index + 1}`;
    swatch.setAttribute('aria-pressed', String(String(index) === String(prefs.color)));
    swatch.addEventListener('click', () => {
      prefs.color = String(index);
      [...els.colorRow.children].forEach((other, i) => other.setAttribute('aria-pressed', String(i === index)));
      onChange?.();
    });
    els.colorRow.append(swatch);
  });

  document.addEventListener('click', (event) => {
    const alvo = /** @type {Element} */ (event.target);
    if (!els.emojiPop.hidden && !alvo.closest('#emoji-pop, #avatar-btn')) show(els.emojiPop, false);
  });
}

/* ---------------- menu de participante ---------------- */

export function openPeerMenu(anchor, peer, actions) {
  els.peerMenu.replaceChildren();

  if (actions.tempoDeFala > 0) {
    const minutos = Math.floor(actions.tempoDeFala / 60);
    const segundos = actions.tempoDeFala % 60;
    els.peerMenu.append(
      element('div', 'menu-info', `Falou ${minutos ? `${minutos} min ` : ''}${segundos}s nesta call`),
    );
  }

  if (!peer.isLocal) {
    const volume = element('label', 'menu-range');
    volume.append(element('span', null, 'Volume'));
    const range = element('input');
    range.type = 'range';
    range.min = '0';
    range.max = '200';
    range.step = '5';
    range.value = String(Math.round((peer.volume ?? 1) * 100));
    range.addEventListener('input', () => actions.onVolume(Number(range.value) / 100));
    volume.append(range);
    els.peerMenu.append(volume);

    els.peerMenu.append(
      menuButton(peer.locallyMuted ? 'Ouvir de novo' : 'Silenciar só pra mim', () => actions.onLocalMute()),
    );
  }

  if (actions.canModerate && !peer.isLocal) {
    els.peerMenu.append(element('div', 'menu-sep'));
    els.peerMenu.append(menuButton(peer.muted ? 'Liberar microfone' : 'Silenciar na toca', () => actions.onForceMute()));
    if (peer.sharing) els.peerMenu.append(menuButton('Encerrar a tela', () => actions.onStopScreen()));
    if (actions.isOwner) {
      els.peerMenu.append(menuButton(peer.role === 'mod' ? 'Tirar moderação' : 'Dar moderação', () => actions.onPromote()));
    }
    els.peerMenu.append(menuButton('Mover pra outra toca…', () => actions.onMove()));
    els.peerMenu.append(menuButton('Tirar da toca', () => actions.onKick(), 'danger'));
    els.peerMenu.append(menuButton('Tirar e barrar', () => actions.onBlock(), 'danger'));
  }

  const rect = anchor.getBoundingClientRect();
  show(els.peerMenu, true);
  const menuRect = els.peerMenu.getBoundingClientRect();
  els.peerMenu.style.left = `${Math.min(window.innerWidth - menuRect.width - 12, Math.max(12, rect.left))}px`;
  els.peerMenu.style.top = `${Math.min(window.innerHeight - menuRect.height - 12, rect.bottom + 8)}px`;
}

function menuButton(label, onClick, variant) {
  const button = element('button', variant ? `menu-item menu-${variant}` : 'menu-item', label);
  button.type = 'button';
  button.addEventListener('click', () => {
    closePeerMenu();
    onClick();
  });
  return button;
}

export const closePeerMenu = () => show(els.peerMenu, false);

document.addEventListener('click', (event) => {
  const alvo = /** @type {Element} */ (event.target);
  if (!els.peerMenu.hidden && !alvo.closest('#peer-menu, .card')) closePeerMenu();
});

/* ---------------- avisos ---------------- */

export function askReload(version) {
  toast(`Saiu versão nova (${version}). Recarregue quando puder.`, 8000);
}
