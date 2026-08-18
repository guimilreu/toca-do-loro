/** Diálogos: ajustes, convite, toca, boas-vindas e nota final. */

import { drawQr } from '../qr.js';
import { prefs } from '../storage.js';
import { $, element, els, show, toast } from './dom.js';

const dlg = {
  settings: $('dlg-settings'),
  invite: $('dlg-invite'),
  room: $('dlg-room'),
  onboarding: $('dlg-onboarding'),
  feedback: $('dlg-feedback'),
};

const field = {
  micSelect: $('mic-select'),
  outSelect: $('out-select'),
  camSelect: $('cam-select'),
  micMeter: $('mic-meter'),
  gainRange: $('gain-range'),
  gainValue: $('gain-value'),
  vadRange: $('vad-range'),
  vadValue: $('vad-value'),
  gate: $('gate-check'),
  aec: $('aec-check'),
  ns: $('ns-check'),
  agc: $('agc-check'),
  spatial: $('spatial-check'),
  sounds: $('sounds-check'),
  quality: $('quality-select'),
  motion: $('motion-check'),
  voiceRange: $('voice-range'),
  voiceValue: $('voice-value'),
  theme: $('theme-select'),
  compact: $('compact-check'),
  privacy: $('privacy-check'),
  version: $('version-tag'),

  inviteInput: $('invite-input'),
  inviteCopy: $('invite-copy'),
  inviteHours: $('invite-hours'),
  inviteQr: $('invite-qr'),

  roomRename: $('room-rename'),
  roomPassword: $('room-password'),
  roomLimit: $('room-limit'),
  limitValue: $('limit-value'),
  roomPin: $('room-pin'),
  roomLock: $('room-lock'),
  roomSave: $('room-save'),
  muteAll: $('mute-all-btn'),

  onboardingOk: $('onboarding-ok'),
  feedbackStars: $('feedback-stars'),
  feedbackTech: $('feedback-tech'),
  feedbackClose: $('feedback-close'),
};

const VAD_WORDS = ['muito sensível', 'sensível', 'sensível', 'média', 'média', 'média', 'firme', 'firme', 'só voz alta', 'só voz alta'];

export function openSettings() {
  dlg.settings.showModal();
}

export function setMicMeter(level) {
  const width = `${Math.min(100, Math.round(level * 320))}%`;
  field.micMeter.style.width = width;
  els.joinMeter.style.width = width;
}

export function fillDevices({ mics, outputs, cams }, { outputSupported }) {
  const fill = (select, items, current, vazio) => {
    if (!select) return;
    select.replaceChildren();
    if (!items.length) {
      const option = element('option', null, vazio);
      option.value = '';
      select.append(option);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    for (const item of items) {
      const option = element('option', null, item.label);
      option.value = item.deviceId;
      option.selected = item.deviceId === current;
      select.append(option);
    }
  };

  fill(field.micSelect, mics, prefs.micId, 'nenhum microfone');
  fill(els.joinMicSelect, mics, prefs.micId, 'nenhum microfone');
  fill(field.camSelect, cams, prefs.camId, 'nenhuma câmera');
  fill(field.outSelect, outputs, prefs.outId, outputSupported ? 'padrão do sistema' : 'não dá pra escolher aqui');
  field.outSelect.disabled = !outputSupported || !outputs.length;
}

/**
 * Liga cada controle de ajuste ao seu efeito. Tudo grava em `prefs` e avisa quem
 * precisa reagir — nada aqui conhece rede nem mídia.
 */
export function initSettings(actions) {
  field.version.textContent = actions.version ?? 'dev';

  const bindSwitch = (input, key, onChange) => {
    input.checked = prefs[key];
    input.addEventListener('change', () => {
      prefs[key] = input.checked;
      onChange?.(input.checked);
    });
  };

  const bindRange = (input, key, format, onChange) => {
    input.value = String(prefs[key]);
    const paint = () => (format.el.textContent = format.text(Number(input.value)));
    paint();
    input.addEventListener('input', () => {
      prefs[key] = Number(input.value);
      paint();
      onChange?.(Number(input.value));
    });
  };

  bindRange(field.gainRange, 'gain', { el: field.gainValue, text: (v) => `${v}%` }, actions.onGain);
  bindRange(field.vadRange, 'vad', { el: field.vadValue, text: (v) => VAD_WORDS[v - 1] }, actions.onGate);
  bindRange(field.voiceRange, 'voiceKbps', { el: field.voiceValue, text: (v) => `${v} kbps` }, actions.onVoiceBitrate);

  bindSwitch(field.gate, 'gate', actions.onGate);
  bindSwitch(field.aec, 'aec', actions.onMicConstraints);
  bindSwitch(field.ns, 'ns', actions.onMicConstraints);
  bindSwitch(field.agc, 'agc', actions.onMicConstraints);
  bindSwitch(field.spatial, 'spatial', actions.onSpatial);
  bindSwitch(field.sounds, 'sounds');
  bindSwitch(field.motion, 'motion', actions.onScreenTuning);
  bindSwitch(field.compact, 'compact', actions.onCompact);
  bindSwitch(field.privacy, 'privacy', () => toast('Vale a partir da próxima conexão.'));

  field.quality.value = prefs.quality;
  field.quality.addEventListener('change', () => {
    prefs.quality = field.quality.value;
    actions.onScreenTuning?.();
  });

  field.theme.value = prefs.theme;
  field.theme.addEventListener('change', () => {
    prefs.theme = field.theme.value;
    applyTheme();
  });

  field.micSelect.addEventListener('change', () => actions.onMic?.(field.micSelect.value));
  els.joinMicSelect.addEventListener('change', () => actions.onMic?.(els.joinMicSelect.value));
  field.camSelect.addEventListener('change', () => actions.onCamera?.(field.camSelect.value));
  field.outSelect.addEventListener('change', () => actions.onOutput?.(field.outSelect.value));
}

export function applyTheme() {
  const theme = prefs.theme;
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

/* ---------------- convite ---------------- */

let inviteUrl = '';

export function openInvite(url, onHours) {
  setInvite(url);
  field.inviteHours.onchange = () => onHours(Number(field.inviteHours.value));
  dlg.invite.showModal();
}

export function setInvite(url) {
  inviteUrl = url;
  field.inviteInput.value = url;
  try {
    drawQr(field.inviteQr, url);
  } catch {
    show(field.inviteQr, false);
  }
}

export function initInvite() {
  field.inviteCopy.addEventListener('click', async () => {
    const ok = await copy(inviteUrl);
    field.inviteCopy.textContent = ok ? 'Copiado!' : 'Copie na mão';
    setTimeout(() => (field.inviteCopy.textContent = 'Copiar'), 1600);
  });
}

/** Área de transferência falha em contexto inseguro: cai no seletor manual. */
export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    field.inviteInput.select();
    return document.execCommand?.('copy') ?? false;
  }
}

/* ---------------- toca ---------------- */

export function openRoom(room, actions) {
  field.roomRename.value = room.name;
  field.roomPassword.value = '';
  field.roomPassword.placeholder = room.needsPassword ? 'senha definida — troque ou apague' : 'sem senha';
  field.roomLimit.value = String(room.maxPeers);
  field.limitValue.textContent = String(room.maxPeers);
  field.roomPin.value = room.pinned ?? '';
  field.roomLock.checked = room.locked;

  field.roomLimit.oninput = () => (field.limitValue.textContent = field.roomLimit.value);
  field.roomLock.onchange = () => actions.onLock(field.roomLock.checked);
  field.muteAll.onclick = () => actions.onMuteAll();
  field.roomSave.onclick = () => {
    actions.onSave({
      name: field.roomRename.value,
      password: field.roomPassword.value,
      limit: Number(field.roomLimit.value),
      pinned: field.roomPin.value,
    });
    dlg.room.close();
  };
  dlg.room.showModal();
}

/* ---------------- boas-vindas e nota ---------------- */

export function maybeOnboarding() {
  if (prefs.onboarded) return;
  dlg.onboarding.showModal();
  field.onboardingOk.onclick = () => {
    prefs.onboarded = true;
    dlg.onboarding.close();
  };
}

export function openFeedback(tecnica) {
  field.feedbackStars.replaceChildren();
  for (let i = 1; i <= 5; i++) {
    const star = element('button', 'star', '★');
    star.type = 'button';
    star.title = `${i} de 5`;
    star.addEventListener('click', () => {
      [...field.feedbackStars.children].forEach((other, index) => other.classList.toggle('on', index < i));
      toast('Valeu pela nota.');
    });
    field.feedbackStars.append(star);
  }
  field.feedbackTech.textContent = tecnica;
  field.feedbackClose.onclick = () => dlg.feedback.close();
  dlg.feedback.showModal();
}

export const dialogs = dlg;
