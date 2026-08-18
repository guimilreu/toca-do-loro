/** O palco: a tela que está sendo compartilhada, com zoom, foto e janela flutuante. */

import { element, els, show, toast } from './dom.js';

const ZOOM_STEP = 0.25;
const ZOOM_MAX = 4;
let zoom = 1;
let pan = { x: 0, y: 0 };
let dragging = null;

function applyTransform() {
  els.shareVideo.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  els.shareVideo.classList.toggle('is-zoomed', zoom > 1);
  els.zoomOut.disabled = zoom <= 1;
  els.zoomIn.disabled = zoom >= ZOOM_MAX;
}

export function setZoom(value) {
  zoom = Math.max(1, Math.min(ZOOM_MAX, value));
  if (zoom === 1) pan = { x: 0, y: 0 };
  applyTransform();
}

export const zoomBy = (delta) => setZoom(zoom + delta * ZOOM_STEP);

export function initStage() {
  els.zoomIn.addEventListener('click', () => zoomBy(1));
  els.zoomOut.addEventListener('click', () => zoomBy(-1));

  els.shareVideo.addEventListener('pointerdown', (event) => {
    if (zoom <= 1) return;
    dragging = { x: event.clientX - pan.x, y: event.clientY - pan.y };
    els.shareVideo.setPointerCapture(event.pointerId);
  });
  els.shareVideo.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    pan = { x: event.clientX - dragging.x, y: event.clientY - dragging.y };
    applyTransform();
  });
  els.shareVideo.addEventListener('pointerup', () => (dragging = null));
  els.shareVideo.addEventListener('dblclick', () => toggleFullscreen());

  els.fullscreenBtn.addEventListener('click', toggleFullscreen);
  els.pipBtn.addEventListener('click', togglePip);
  els.shotBtn.addEventListener('click', snapshot);
  applyTransform();
}

export function toggleFullscreen() {
  const frame = els.shareVideo.parentElement;
  if (document.fullscreenElement) document.exitFullscreen();
  else frame.requestFullscreen?.().catch(() => toast('Este navegador não deixou abrir em tela cheia.'));
}

async function togglePip() {
  if (!document.pictureInPictureEnabled) return toast('Este navegador não tem janela flutuante.');
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await els.shareVideo.requestPictureInPicture();
  } catch {
    toast('Não consegui abrir a janela flutuante.');
  }
}

/** Salva o quadro atual como PNG — útil pra guardar o que estava na tela. */
function snapshot() {
  const video = els.shareVideo;
  if (!video.videoWidth) return toast('Ainda não tem imagem pra salvar.');

  const canvas = element('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = element('a');
    link.href = url;
    link.download = `toca-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Quadro salvo.');
  }, 'image/png');
}

export function setShare(stream) {
  const active = Boolean(stream);
  show(els.shareArea, active);
  els.stage.classList.toggle('has-share', active);

  if (els.shareVideo.srcObject !== (stream ?? null)) {
    els.shareVideo.srcObject = stream ?? null;
    setZoom(1);
    if (active) els.shareVideo.play().catch(() => {});
  }
}

export function renderTabs(sharers, activeId, onSelect) {
  els.shareTabs.replaceChildren();
  if (sharers.length < 2) return;

  for (const peer of sharers) {
    const tab = element('button', 'tab', peer.isLocal ? 'Sua tela' : `Tela de ${peer.name}`);
    tab.type = 'button';
    tab.setAttribute('aria-selected', String(peer.id === activeId));
    tab.addEventListener('click', () => onSelect(peer.id));
    els.shareTabs.append(tab);
  }
}

/** Quem compartilha vê quantas pessoas estão de fato olhando. */
export function setWatchers(count) {
  els.watchers.textContent = count === 1 ? '1 pessoa vendo' : `${count} pessoas vendo`;
  show(els.watchers, count > 0);
}
