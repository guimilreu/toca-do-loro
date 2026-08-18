/**
 * E2E no Chrome de verdade, com microfone, câmera e tela fake.
 *
 * Percorre o caminho do usuário: entrar, falar, mutar, compartilhar, conversar,
 * moderar, trocar de toca e sobreviver a uma queda do servidor.
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
const REMOTE = process.env.APP_URL?.replace(/\/$/, '');
const APP = REMOTE || `http://localhost:${PORT}`;
const DEBUG_PORT = 9333;
const HEADLESS = process.env.HEADFUL ? [] : ['--headless=new'];
/** FORCE_RELAY=1 simula participantes que não se enxergam direto (CGNAT): só TURN. */
const FORCE_RELAY = Boolean(process.env.FORCE_RELAY);

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate));

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

/** Guarda as conexões criadas e pula o tutorial de primeira vez. */
const INSTRUMENT = `
  try { localStorage.setItem('toca:onboarded', 'true'); } catch {}
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
    if (pc.connectionState !== 'connected') continue;
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

  static async open(cdp, name, url = APP) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(cdp, sessionId, name);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT }, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
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

  text(selector) {
    return this.eval(`return document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null;`);
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

  peers() {
    return this.eval(`return [...document.querySelectorAll('#grid .card')].map((card) => ({
      nome: card.querySelector('.card-name span').textContent,
      status: card.querySelector('.card-status').textContent,
      local: card.classList.contains('is-local'),
      mudo: getComputedStyle(card.querySelector('.mic-off')).display !== 'none',
      falando: card.classList.contains('speaking'),
    }));`);
  }
}

/* ---------- execução ---------- */
const profile = mkdtempSync(path.join(tmpdir(), 'toca-e2e-'));
let chrome;
let server = REMOTE ? null : await startServer(PORT, { MAX_PEERS: '6' });

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

  /* ---------- entrada ---------- */
  await ana.join('Ana');
  await ana.until(`!document.getElementById('view-call').hidden`, { label: 'tela da call' });
  const mic = await ana.eval(`return {
    label: document.getElementById('mic-label').textContent,
    disabled: document.getElementById('mic-btn').disabled,
    dono: document.querySelector('#grid .card .card-role')?.textContent,
  };`);
  check('getUserMedia real concedido', mic.label === 'Falando' && !mic.disabled, JSON.stringify(mic));
  check('quem abre a toca aparece como dono', mic.dono === 'dono');
  check('ferramentas de dono aparecem', await ana.eval(`return !document.getElementById('room-btn').hidden;`));

  await ana.focus();
  const soloSpeaking = await ana.eval(`
    for (let i = 0; i < 30; i++) {
      if (document.querySelector('#grid .card.speaking')) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;`);
  check('indicador de fala acende no próprio mic', soloSpeaking === true);
  check('estado vazio convida a chamar alguém', await ana.eval(`return !document.getElementById('alone-hint').hidden;`));

  await bia.join('Bia');
  await bia.until(`document.querySelectorAll('#grid .card').length === 2`, { label: '2 cards' });
  check('duas pessoas na toca', true);
  check('contador do topo atualiza', (await ana.text('#count-pill')) === '2 na toca');

  /* ---------- conexão e voz ---------- */
  await bia.until(`window.__pcs.length === 1 && window.__pcs[0].connectionState === 'connected'`, {
    label: 'pc conectada',
  });
  check('conexão P2P estabelecida', true);

  await sleep(3500);
  const inAudio = await bia.stats((s) => !s.dir && s.kind === 'audio');
  check('áudio chega em Bia', inAudio.some((s) => s.packets > 0 && s.bytes > 0), JSON.stringify(inAudio));

  const semMudo = await bia.peers();
  check('sem mudo, o ícone de microfone desligado fica escondido', semMudo.every((p) => !p.mudo), JSON.stringify(semMudo));

  await bia.focus();
  const remoteSpeaking = await bia.eval(`
    for (let i = 0; i < 30; i++) {
      if (document.querySelector('#grid .card:not(.is-local).speaking')) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;`);
  check('Bia vê Ana falando', remoteSpeaking === true);

  await bia.until(`document.querySelector('#grid .card:not(.is-local) .card-quality')?.hidden === false`, {
    label: 'qualidade medida',
    timeout: 12_000,
  });
  const quali = await bia.text('#grid .card:not(.is-local) .card-quality');
  check('qualidade da conexão aparece no card', /ms/.test(quali ?? ''), quali);

  /* ---------- mudo e surdo ---------- */
  await ana.click('mic-btn');
  await sleep(700);
  const mudoLocal = await ana.eval(`return document.getElementById('mic-label').textContent;`);
  const mudoRemoto = (await bia.peers()).find((p) => !p.local);
  check('mudo propaga e aparece no card do outro', mudoLocal === 'Mudo' && mudoRemoto.mudo, JSON.stringify(mudoRemoto));

  await ana.click('mic-btn');
  await sleep(400);
  check('desmutar volta a enviar', (await ana.eval(`return document.getElementById('mic-label').textContent;`)) === 'Falando');

  await bia.click('deafen-btn');
  await sleep(300);
  const surdo = await bia.eval(`return {
    rotulo: document.querySelector('#deafen-btn .ctrl-label').textContent,
    mudo: document.getElementById('mic-label').textContent,
  };`);
  check('silenciar tudo também fecha seu microfone', surdo.rotulo === 'Surdo' && surdo.mudo === 'Mudo', JSON.stringify(surdo));
  await bia.click('deafen-btn');
  await sleep(200);

  /* ---------- conversa ---------- */
  await bia.click('chat-btn');
  await bia.eval(
    `document.getElementById('chat-input').value = 'olha o **link**: https://exemplo.com';
     document.getElementById('chat-form').requestSubmit();
     return true;`,
    { userGesture: true },
  );
  await ana.until(`document.querySelectorAll('#chat-log .msg').length > 0`, { label: 'mensagem chega' });
  const msg = await ana.eval(`const m = document.querySelector('#chat-log .msg');
    return { nome: m.querySelector('.msg-name').textContent, negrito: m.querySelector('strong')?.textContent, link: m.querySelector('a')?.href };`);
  check('chat entrega com markdown e link', msg.nome === 'Bia' && msg.negrito === 'link' && msg.link.startsWith('https://exemplo.com'), JSON.stringify(msg));
  check('badge de não lida aparece', Number(await ana.text('#chat-badge')) > 0);

  await bia.eval(`document.querySelector('.reaction').click(); return true;`, { userGesture: true });
  await ana.until(`document.querySelectorAll('#reactions-layer .fly').length > 0`, { label: 'reação voa' });
  check('reação aparece na tela de quem recebe', true);

  /* ---------- tela ---------- */
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

    await ana.until(`!document.getElementById('watchers').hidden`, { label: 'contador de quem vê', timeout: 8000 });
    check('quem compartilha vê quantos estão olhando', /vendo/.test(await ana.text('#watchers')));

    await ana.click('share-btn');
    await bia.until(`document.getElementById('share-area').hidden`, { label: 'palco escondido' });
    check('parar de compartilhar limpa o palco', true);
  }

  /* ---------- câmera ---------- */
  await ana.click('cam-btn');
  await ana.until(`document.getElementById('cam-label').textContent === 'Ligada'`, { label: 'câmera ligada' });
  await bia.until(`document.querySelector('#grid .card:not(.is-local) video')?.videoWidth > 0`, {
    label: 'câmera renderiza no card',
    timeout: 15_000,
  });
  check('câmera aparece dentro do card', true);
  await ana.click('cam-btn');
  await bia.until(`!document.querySelector('#grid .card:not(.is-local) video')`, { label: 'card volta ao avatar' });
  check('desligar a câmera volta o avatar', true);

  /* ---------- moderação ---------- */
  const caio = await Page.open(cdp, 'Caio');
  await caio.join('Caio');
  await caio.until(`document.querySelectorAll('#grid .card').length === 3`, { label: '3 cards' });
  await caio.until(`window.__pcs.length === 2 && window.__pcs.every((pc) => pc.connectionState === 'connected')`, {
    label: 'mesh de 3',
    timeout: 20_000,
  });
  check('mesh com 3 participantes conectado', true);

  await sleep(2500);
  const caioAudio = await caio.stats((s) => !s.dir && s.kind === 'audio' && s.packets > 0);
  check('Caio recebe áudio dos dois', caioAudio.length === 2, JSON.stringify(caioAudio.map((s) => s.packets)));

  const alvo = await ana.eval(`return [...document.querySelectorAll('#grid .card')].find((c) => c.querySelector('.card-name span').textContent === 'Caio')?.dataset.id;`);
  await ana.eval(
    `const card = document.querySelector('[data-id="${alvo}"]');
     card.click();
     const botao = [...document.querySelectorAll('#peer-menu .menu-item')].find((b) => b.textContent === 'Tirar da toca');
     botao.click();
     return true;`,
    { userGesture: true },
  );
  await caio.until(`!document.getElementById('view-join').hidden`, { label: 'expulso volta pra entrada' });
  check('dono expulsa e a pessoa volta pra tela de entrada', /tirou você/.test(await caio.text('#join-error')));
  await ana.until(`document.querySelectorAll('#grid .card').length === 2`, { label: 'card do expulso some' });

  /* ---------- tocas separadas ---------- */
  const dani = await Page.open(cdp, 'Dani', `${APP}/r/outra-toca`);
  await dani.join('Dani');
  await dani.until(`!document.getElementById('view-call').hidden`, { label: 'entra na outra toca' });
  check('URL /r/<toca> entra na toca certa', (await dani.text('#room-name')) === 'outra-toca');
  check('toca separada não mistura gente', (await dani.eval(`return document.querySelectorAll('#grid .card').length;`)) === 1);
  check('as duas tocas aparecem no saguão', (await caio.eval(`return document.querySelectorAll('#rooms-list li').length;`)) === 2);

  /* ---------- convite com QR ---------- */
  const convite = await ana.eval(
    `document.getElementById('invite-btn').click();
     await new Promise((r) => setTimeout(r, 300));
     const canvas = document.getElementById('invite-qr');
     const url = document.getElementById('invite-input').value;
     const det = new BarcodeDetector({ formats: ['qr_code'] });
     const lido = (await det.detect(await createImageBitmap(canvas)))[0]?.rawValue;
     document.getElementById('dlg-invite').close();
     return { url, lido };`,
    { userGesture: true },
  );
  check('QR do convite é legível e bate com o link', convite.lido === convite.url, convite.url);

  /* ---------- saída ---------- */
  await bia.eval(`document.getElementById('leave-btn').click(); return true;`, { userGesture: true });
  await ana.until(`document.querySelectorAll('#grid .card').length === 1`, { label: 'card removido' });
  await ana.until(`document.querySelectorAll('#audio-sink audio').length === 0`, { label: 'áudio limpo' });
  check('saída limpa cards e elementos de áudio', true);

  /* ---------- queda e volta do servidor ---------- */
  if (REMOTE) {
    console.log('SKIP  queda do servidor (rodando contra deploy remoto)');
  } else {
    const antes = await ana.eval(`return document.querySelectorAll('#grid .card').length;`);
    server.stop();
    server = null;
    await ana.until(`document.getElementById('conn-text').textContent !== 'conectado'`, { label: 'aviso de queda' });
    check('queda do servidor é sinalizada na interface', true);

    server = await startServer(PORT, { MAX_PEERS: '6' });
    await ana.until(`document.getElementById('conn-text').textContent === 'conectado'`, {
      label: 'reconexão',
      timeout: 25_000,
    });
    await ana.until(`document.querySelectorAll('#grid .card').length === ${antes}`, {
      label: 'toca remontada',
      timeout: 25_000,
    });
    check('call volta sozinha depois da queda', true);
  }

  const erros = await ana.eval(`return window.__erros ?? 0;`);
  check('sem erro fatal na página', !erros);
} catch (error) {
  check(`execução: ${error.message}`, false);
} finally {
  const failed = finish();
  cleanup();
  process.exit(failed ? 1 : 0);
}
