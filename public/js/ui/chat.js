/** Conversa da toca: efêmera, sem histórico, com markdown curto e reações. */

import { element, els, show } from './dom.js';

const REACTIONS = ['👏', '😂', '❤️', '🔥', '👍', '🎉', '🦜', '😮'];
const TYPING_TTL = 3500;
const typing = new Map();
let unread = 0;

/** Markdown mínimo: negrito, itálico, código, link e menção. Nunca como HTML. */
function renderText(target, text) {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|https?:\/\/\S+|@[\p{L}\d._-]+)/gu;
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > last) target.append(text.slice(last, match.index));
    const token = match[0];

    if (token.startsWith('@')) target.append(element('span', 'mention', token));
    else if (token.startsWith('**')) target.append(element('strong', null, token.slice(2, -2)));
    else if (token.startsWith('`')) target.append(element('code', null, token.slice(1, -1)));
    else if (token.startsWith('*')) target.append(element('em', null, token.slice(1, -1)));
    else {
      const link = element('a', null, token);
      link.href = token;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      target.append(link);
    }
    last = match.index + token.length;
  }
  if (last < text.length) target.append(text.slice(last));
}

const EMOJIS = ['😀','😂','🥲','😅','😉','😍','🤔','😴','🙃','😎','🤝','👋','👍','👎','👏','🙏','💪','🔥','✨','🎉','❤️','💔','☕','🍺','🍕','⚽','🎸','🎮','🐢','🦜','🌴','☀️','🌧️','🚀','💡','⚠️'];

export function initEmoji(input) {
  els.emojiBtn.addEventListener('click', (event) => {
    event.preventDefault();
    const open = els.emojiPop.hidden;
    show(els.emojiPop, open);
    if (!open) return;

    els.emojiPop.replaceChildren();
    const rect = els.emojiBtn.getBoundingClientRect();
    els.emojiPop.style.left = `${Math.max(12, rect.left - 120)}px`;
    els.emojiPop.style.top = `${Math.max(12, rect.top - 190)}px`;

    for (const emoji of EMOJIS) {
      const option = element('button', 'emoji-option', emoji);
      option.type = 'button';
      option.addEventListener('click', () => {
        input.value += emoji;
        show(els.emojiPop, false);
        input.focus();
      });
      els.emojiPop.append(option);
    }
  });
}

/**
 * @param {{ name?: string, text: string, mine?: boolean, system?: boolean, mentioned?: boolean }} msg
 */
export function addMessage({ name, text, mine, system, mentioned }) {
  const item = element('li', system ? 'msg msg-system' : mine ? 'msg msg-mine' : 'msg');
  if (mentioned) item.classList.add('msg-mention');
  if (!system) item.append(element('span', 'msg-name', name));
  const body = element('span', 'msg-text');
  renderText(body, text);
  item.append(body);

  els.chatLog.append(item);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
  while (els.chatLog.children.length > 200) els.chatLog.firstElementChild.remove();

  if (!mine && els.chatPanel.hidden) setUnread(unread + 1);
}

export function setUnread(count) {
  unread = count;
  els.chatBadge.textContent = String(count);
  show(els.chatBadge, count > 0);
}

export function toggle(open) {
  const visible = open ?? els.chatPanel.hidden;
  show(els.chatPanel, visible);
  els.chatBtn.setAttribute('aria-pressed', String(visible));
  if (visible) {
    setUnread(0);
    els.chatInput.focus();
  }
  return visible;
}

export function showTyping(id, name) {
  typing.set(id, { name, at: Date.now() });
  paintTyping();
  setTimeout(paintTyping, TYPING_TTL + 100);
}

function paintTyping() {
  const now = Date.now();
  for (const [id, info] of typing) if (now - info.at > TYPING_TTL) typing.delete(id);

  const names = [...typing.values()].map((info) => info.name);
  els.typingLine.textContent =
    names.length === 1 ? `${names[0]} está escrevendo…` : names.length ? `${names.length} pessoas escrevendo…` : '';
  show(els.typingLine, names.length > 0);
}

const SOUNDS = [
  ['palmas', '👏', 'Palmas'],
  ['buzina', '📯', 'Buzina'],
  ['tambor', '🥁', 'Tambor'],
  ['triste', '😢', 'Que pena'],
  ['grilo', '🦗', 'Silêncio'],
  ['loro', '🦜', 'Loro'],
];

export function initSounds(onPick) {
  els.soundRow.replaceChildren();
  for (const [nome, emoji, titulo] of SOUNDS) {
    const button = element('button', 'reaction', emoji);
    button.type = 'button';
    button.title = titulo;
    button.addEventListener('click', () => onPick(nome));
    els.soundRow.append(button);
  }
}

export function initReactions(onPick) {
  els.reactionRow.replaceChildren();
  for (const emoji of REACTIONS) {
    const button = element('button', 'reaction', emoji);
    button.type = 'button';
    button.title = `Reagir com ${emoji}`;
    button.addEventListener('click', () => onPick(emoji));
    els.reactionRow.append(button);
  }
}

/** A reação sobe na tela e some — não vira mensagem nem histórico. */
export function flyReaction(emoji) {
  const node = element('span', 'fly', emoji);
  node.style.left = `${15 + Math.random() * 70}%`;
  els.reactionsLayer.append(node);
  node.addEventListener('animationend', () => node.remove());
}

export const clear = () => {
  els.chatLog.replaceChildren();
  typing.clear();
  paintTyping();
  setUnread(0);
};
