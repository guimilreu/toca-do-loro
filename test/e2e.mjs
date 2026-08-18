/**
 * E2E no Chrome de verdade, com microfone e tela fake (--use-fake-device-for-media-stream).
 * Percorre o caminho do usuário: entrar, falar, mutar, compartilhar tela, sair,
 * e sobreviver a uma queda do servidor no meio da call.
 *
 * Requer Google Chrome instalado (CHROME_PATH sobrescreve o caminho).
 * Rode a partir da raiz do projeto: npm run test:e2e
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

import { reporter, sleep, startServer } from './helpers.mjs';

const PORT = Number(process.env.TEST_PORT || 3211);
/** APP_URL aponta o teste para um deploy existente (smoke test de produção). */
const REMOTE = process.env.APP_URL;
const APP = REMOTE || `http://localhost:${PORT}/`;
const DEBUG_PORT = 9333;
const HEADLESS = process.env.HEADFUL ? [] : ['--headless=new'];
/** FORCE_RELAY=1 simula participantes que não se enxergam direto (CGNAT): só TURN. */
const FORCE_RELAY = Boolean(process.env.FORCE_RELAY);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!CHROME) {
  console.error('Chrome não encontrado. Defina CHROME_PATH.');
  process.exit(2);
}

const { check, finish } = reporter();

/* ---------- cliente CDP mínimo ---------- */
class CDP {
  #id = 0;
  #pending = new Map();

  static async attach(wsUrl) {
    const cdp = new CDP();
    cdp.ws = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 });
    cdp.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const entry = cdp.#pending.get(msg.id);
      if (!entry) return;
      cdp.#pending.delete(msg.id);
      msg.error ? entry.reject(new Error(msg.error.message)) : entry.resolve(msg.result);
    });
    await new Promise((resolve, reject) => {
      cdp.ws.on('open', resolve);
      cdp.ws.on('error', reject);
    });
    return cdp;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(`timeout em ${method}`));
      }, 45_000);
    });
  }
}

/** Guarda as RTCPeerConnection criadas pela página para o teste inspecionar. */
const INSTRUMENT = `
  window.__pcs = [];
  window.__forceRelay = ${FORCE_RELAY};
  const Native = window.RTCPeerConnection;
  const Wrapped = function (config, ...rest) {
    if (window.__forceRelay) config = { ...config, iceTransportPolicy: 'relay' };
    const pc = new Native(config, ...rest);
    window.__pcs.push(pc);
    return pc;
  };
  Wrapped.prototype = Native.prototype;
  Object.setPrototypeOf(Wrapped, Native);
  window.RTCPeerConnection = Wrapped;
`;

const STATS = `
  const out = [];
  for (const pc of window.__pcs) {
    const stats = await pc.getStats();
    stats.forEach((r) => {
      if (r.type === 'inbound-rtp') out.push({ kind: r.kind, packets: r.packetsReceived || 0, bytes: r.bytesReceived || 0, frames: r.framesDecoded || 0 });
      if (r.type === 'outbound-rtp') out.push({ dir: 'out', kind: r.kind, packets: r.packetsSent || 0, bytes: r.bytesSent || 0 });
    });
  }
  return out;
`;

class Page {
  constructor(cdp, sessionId, name) {
    Object.assign(this, { cdp, sessionId, name });
  }

  static async open(cdp, name) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(cdp, sessionId, name);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT }, sessionId);
    await cdp.send('Page.navigate', { url: APP }, sessionId);
    await sleep(900);
    return page;
  }

  async eval(expression, { userGesture = false } = {}) {
    const { result, exceptionDetails } = await this.cdp.send(
      'Runtime.evaluate',
      { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true, userGesture },
      this.sessionId,
    );
    if (exceptionDetails) throw new Error(`${this.name}: ${exceptionDetails.exception?.description ?? 'erro'}`);
    return result.value;
  }

  async until(condition, { timeout = 15_000, label = condition } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await this.eval(`return Boolean(${condition});`)) return true;
      await sleep(200);
    }
    throw new Error(`${this.name}: timeout esperando ${label}`);
  }

  click(id) {
    return this.eval(`document.getElementById('${id}').click(); return true;`, { userGesture: true });
  }

  /** requestAnimationFrame congela em aba de fundo — foca antes de checar indicador visual. */
  focus() {
    return this.cdp.send('Page.bringToFront', {}, this.sessionId);
  }

  join(name) {
    return this.eval(
      `document.getElementById('name-input').value = ${JSON.stringify(name)};
       document.getElementById('join-form').requestSubmit();
       return true;`,
      { userGesture: true },
    );
  }

  stats(filter) {
    return this.eval(STATS).then((rows) => rows.filter(filter));
  }
}

/* ---------- execução ---------- */
const profile = mkdtempSync(path.join(tmpdir(), 'toca-e2e-'));
let chrome;
let server = REMOTE ? null : await startServer(PORT);

const cleanup = () => {
  chrome?.kill('SIGKILL');
  server?.stop();
  rmSync(profile, { recursive: true, force: true });
};
process.on('exit', cleanup);

try {
  chrome = spawn(
    CHROME,
    [
      ...HEADLESS,
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,MediaRouter',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp;
  for (let i = 0; i < 40 && !cdp; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://localhost:${DEBUG_PORT}/json/version`);
      cdp = await CDP.attach((await res.json()).webSocketDebuggerUrl);
    } catch {
      /* ainda subindo */
    }
  }
  if (!cdp) throw new Error('Chrome não abriu a porta de debug');

  const ana = await Page.open(cdp, 'Ana');
  const bia = await Page.open(cdp, 'Bia');

  /* entrada com microfone real */
  await ana.join('Ana');
  await ana.until(`!document.getElementById('view-call').hidden`, { label: 'tela da call' });
  const mic = await ana.eval(`return {
    label: document.getElementById('mic-label').textContent,
    disabled: document.getElementById('mic-btn').disabled,
  };`);
  check('getUserMedia real concedido', mic.label === 'Falando' && !mic.disabled, JSON.stringify(mic));

  // Sozinha na sala: sem áudio remoto, o cancelamento de eco não tem o que cancelar.
  await ana.focus();
  const soloSpeaking = await ana.eval(`
    for (let i = 0; i < 30; i++) {
      if (document.querySelector('#grid .card.speaking')) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;`);
  check('indicador de fala acende no próprio mic', soloSpeaking === true);

  await bia.join('Bia');
  await bia.until(`!document.getElementById('view-call').hidden`, { label: 'tela da call' });
  await bia.until(`document.querySelectorAll('#grid .card').length === 2`, { label: '2 cards' });
  check('duas pessoas na sala', true);

  /* conexão e voz */
  await bia.until(`window.__pcs.length === 1 && window.__pcs[0].connectionState === 'connected'`, {
    label: 'pc conectada',
  });
  check('conexão P2P estabelecida', true);

  await sleep(3500);
  const inAudio = await bia.stats((s) => !s.dir && s.kind === 'audio');
  const outAudio = await ana.stats((s) => s.dir === 'out' && s.kind === 'audio');
  check('áudio chega em Bia', inAudio.some((s) => s.packets > 0 && s.bytes > 0), JSON.stringify(inAudio));
  check('Ana está enviando áudio', outAudio.some((s) => s.packets > 0), JSON.stringify(outAudio));

  const iconWhileOpen = await bia.eval(
    `const svg = document.querySelector('#grid .card:not(.is-local) .card-name svg');
     return getComputedStyle(svg).display;`,
  );
  check('sem mudo, o ícone de mic desligado fica escondido', iconWhileOpen === 'none', iconWhileOpen);

  await bia.focus();
  const remoteSpeaking = await bia.eval(`
    for (let i = 0; i < 30; i++) {
      if (document.querySelector('#grid .card:not(.is-local).speaking')) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;`);
  check('Bia vê Ana falando', remoteSpeaking === true);

  /* mudo */
  await ana.click('mic-btn');
  await sleep(600);
  const muted = await ana.eval(`return {
    label: document.getElementById('mic-label').textContent,
    trackEnabled: window.__pcs[0].getSenders().find((s) => s.track && s.track.kind === 'audio')?.track.enabled,
  };`);
  const biaSeesMuted = await bia.eval(
    `const svg = document.querySelector('#grid .card:not(.is-local) .card-name svg');
     return getComputedStyle(svg).display !== 'none';`,
  );
  check(
    'mudo desliga a trilha e propaga',
    muted.label === 'Mudo' && muted.trackEnabled === false && biaSeesMuted,
    JSON.stringify(muted),
  );

  await ana.click('mic-btn');
  await sleep(400);
  check('desmutar volta a enviar', (await ana.eval(`return document.getElementById('mic-label').textContent;`)) === 'Falando');

  /* compartilhamento de tela pelo botão real */
  const shared = await ana.eval(
    `document.getElementById('share-btn').click();
     for (let i = 0; i < 50; i++) {
       if (document.getElementById('share-label').textContent === 'Parar') return 'ok';
       await new Promise((r) => setTimeout(r, 200));
     }
     return document.getElementById('toast').hidden ? 'sem-reacao' : document.getElementById('toast').textContent;`,
    { userGesture: true },
  );
  check('getDisplayMedia real aceito', shared === 'ok', String(shared));

  if (shared === 'ok') {
    await bia.until(`!document.getElementById('share-area').hidden`, { label: 'palco visível' });
    await bia.until(`document.getElementById('share-video').videoWidth > 0`, { label: 'vídeo com frames' });
    const geo = await bia.eval(`const v = document.getElementById('share-video');
      return { w: v.videoWidth, h: v.videoHeight, paused: v.paused };`);
    check('tela de Ana renderiza em Bia', geo.w > 0 && !geo.paused, JSON.stringify(geo));

    await sleep(2500);
    const inVideo = await bia.stats((s) => !s.dir && s.kind === 'video');
    check('vídeo da tela trafega P2P', inVideo.some((s) => s.frames > 0 && s.bytes > 0), JSON.stringify(inVideo));

    await ana.click('share-btn');
    await bia.until(`document.getElementById('share-area').hidden`, { label: 'palco escondido' });
    check('parar de compartilhar limpa o palco', true);
  }

  /* mesh de três */
  const caio = await Page.open(cdp, 'Caio');
  await caio.join('Caio');
  await caio.until(`document.querySelectorAll('#grid .card').length === 3`, { label: '3 cards' });
  await caio.until(`window.__pcs.length === 2 && window.__pcs.every((pc) => pc.connectionState === 'connected')`, {
    label: 'mesh de 3',
    timeout: 20_000,
  });
  await ana.until(`window.__pcs.filter((pc) => pc.connectionState === 'connected').length === 2`, {
    label: 'Ana com 2 conexões',
    timeout: 20_000,
  });
  check('mesh com 3 participantes conectado', true);

  await sleep(2500);
  const caioAudio = await caio.stats((s) => !s.dir && s.kind === 'audio' && s.packets > 0);
  check('Caio recebe áudio dos dois', caioAudio.length === 2, JSON.stringify(caioAudio.map((s) => s.packets)));

  /* saída */
  await caio.click('leave-btn');
  await ana.until(`document.querySelectorAll('#grid .card').length === 2`, { label: 'card removido' });
  await ana.until(`document.querySelectorAll('#audio-sink audio').length === 2`, { label: 'áudio limpo' });
  check('saída limpa cards e elementos de áudio', true);

  /* queda e volta do servidor no meio da call (só faz sentido no servidor local) */
  if (REMOTE) {
    console.log('SKIP  queda do servidor (rodando contra deploy remoto)');
  } else {
  server.stop();
  server = null;
  await ana.until(`document.getElementById('conn-text').textContent !== 'conectado'`, { label: 'aviso de queda' });
  await ana.until(`document.querySelectorAll('#grid .card').length === 1`, { label: 'pares removidos' });
  check('queda do servidor é sinalizada na interface', true);

  server = await startServer(PORT);
  await ana.until(`document.getElementById('conn-text').textContent === 'conectado'`, {
    label: 'reconexão',
    timeout: 25_000,
  });
  await ana.until(`document.querySelectorAll('#grid .card').length === 2`, { label: 'sala remontada', timeout: 25_000 });
  await ana.until(`window.__pcs.filter((pc) => pc.connectionState === 'connected').length >= 1`, {
    label: 'mesh remontada',
    timeout: 25_000,
  });
  await sleep(2500);
  const afterReconnect = await ana.stats((s) => !s.dir && s.kind === 'audio' && s.packets > 0);
  check('call volta sozinha depois da queda', afterReconnect.length >= 1, JSON.stringify(afterReconnect.map((s) => s.packets)));
  }
} catch (error) {
  check(`execução: ${error.message}`, false);
} finally {
  const failed = finish();
  cleanup();
  process.exit(failed ? 1 : 0);
}
