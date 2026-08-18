/**
 * Prova de que a toca funciona fora do Chrome — e entre navegadores diferentes.
 *
 * Sobe o servidor, abre Firefox e Chromium com microfone falso e coloca os dois
 * na mesma toca: se o áudio atravessar, o handshake vale pros dois motores.
 *
 * npm run test:browsers
 */
import { chromium, firefox, webkit } from 'playwright';

import { reporter, sleep, startServer } from './helpers.mjs';

const PORT = Number(process.env.TEST_PORT || 3212);
const APP = `http://localhost:${PORT}`;
const { check, finish } = reporter();

const LAUNCH = {
  firefox: {
    tipo: firefox,
    opcoes: {
      firefoxUserPrefs: {
        'media.navigator.streams.fake': true,
        'media.navigator.permission.disabled': true,
        'permissions.default.microphone': 1,
      },
    },
  },
  chromium: {
    tipo: chromium,
    opcoes: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
};

async function abrir(nome, slug, apelido) {
  const { tipo, opcoes } = LAUNCH[nome];
  const navegador = await tipo.launch({ headless: !process.env.HEADFUL, ...opcoes });
  // O Firefox libera o microfone pela preferência acima; só o Chromium usa a API de permissões.
  const contexto = await navegador.newContext(nome === 'chromium' ? { permissions: ['microphone'] } : {});
  await contexto.addInitScript(() => {
    try {
      localStorage.setItem('toca:onboarded', 'true');
    } catch {
      /* armazenamento bloqueado */
    }
    // @ts-ignore — instrumentação só do teste
    window.__pcs = [];
    const Native = window.RTCPeerConnection;
    const Wrapped = function (...args) {
      const pc = new Native(...args);
      window.__pcs.push(pc);
      return pc;
    };
    Wrapped.prototype = Native.prototype;
    Object.setPrototypeOf(Wrapped, Native);
    window.RTCPeerConnection = Wrapped;
  });

  const pagina = await contexto.newPage();
  await pagina.goto(`${APP}/r/${slug}`);
  await pagina.fill('#name-input', apelido);
  await pagina.click('#join-btn');
  return { navegador, pagina, nome };
}

const pacotesDeAudio = (pagina) =>
  pagina.evaluate(async () => {
    let total = 0;
    for (const pc of window.__pcs) {
      if (pc.connectionState !== 'connected') continue;
      const stats = await pc.getStats();
      stats.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') total += r.packetsReceived ?? 0;
      });
    }
    return total;
  });

const server = await startServer(PORT);
const abertos = [];

/**
 * O WebKit do Playwright é o motor do Safari, mas sem dispositivo de captura
 * falso: dá pra provar que a interface carrega e conversa com o servidor, não
 * que a mídia flui. O teste diz exatamente isso.
 */
async function smokeWebkit() {
  const navegador = await webkit.launch({ headless: !process.env.HEADFUL });
  try {
    const pagina = await navegador.newPage();
    const erros = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    await pagina.goto(APP);

    await pagina.waitForFunction(() => document.getElementById('lobby-text')?.textContent !== 'conectando…', null, {
      timeout: 15_000,
    });
    check('webkit (motor do Safari): página carrega e fala com o servidor', true);
    check('webkit: sem erro de JavaScript no carregamento', erros.length === 0, erros.join(' | '));
    const diagnostico = await pagina.evaluate(() => ({
      marcas: document.querySelectorAll('.brand-mark').length,
      botao: !document.getElementById('join-btn').disabled,
      temMediaDevices: Boolean(navigator.mediaDevices),
      temGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      temRTC: Boolean(window.RTCPeerConnection),
      aviso: document.getElementById('join-error').textContent,
    }));
    check('webkit: marca e formulário renderizam', diagnostico.marcas === 2 && diagnostico.botao, JSON.stringify(diagnostico));
  } finally {
    await navegador.close();
  }
}

try {
  for (const nome of ['firefox', 'chromium']) {
    const sessao = await abrir(nome, 'sozinho', nome);
    abertos.push(sessao);
    await sessao.pagina.waitForSelector('#view-call:not([hidden])', { timeout: 20_000 });
    const rotulo = await sessao.pagina.textContent('#mic-label');
    check(`${nome}: entra na toca e pega o microfone`, rotulo === 'Falando', String(rotulo));
    check(`${nome}: card aparece na grade`, (await sessao.pagina.locator('#grid .card').count()) === 1);
    await sessao.navegador.close();
    abertos.pop();
  }

  // Agora os dois na mesma toca, cada um num motor diferente.
  const raposa = await abrir('firefox', 'mista', 'Fê');
  abertos.push(raposa);
  await raposa.pagina.waitForSelector('#view-call:not([hidden])', { timeout: 20_000 });

  const cromo = await abrir('chromium', 'mista', 'Chris');
  abertos.push(cromo);
  await cromo.pagina.waitForSelector('#view-call:not([hidden])', { timeout: 20_000 });

  await cromo.pagina.waitForFunction(() => document.querySelectorAll('#grid .card').length === 2, null, { timeout: 20_000 });
  check('Firefox e Chromium se veem na mesma toca', true);

  await cromo.pagina.waitForFunction(
    () => window.__pcs.some((pc) => pc.connectionState === 'connected'),
    null,
    { timeout: 30_000 },
  );
  check('handshake fecha entre motores diferentes', true);

  await sleep(4000);
  const doFirefox = await pacotesDeAudio(cromo.pagina);
  const doChromium = await pacotesDeAudio(raposa.pagina);
  check('Chromium recebe o áudio do Firefox', doFirefox > 0, `${doFirefox} pacotes`);
  check('Firefox recebe o áudio do Chromium', doChromium > 0, `${doChromium} pacotes`);

  await smokeWebkit();

  // Compartilhar tela no Firefox exige interação humana com o seletor: fica de fora
  // de propósito, e está anotado no README.
  await raposa.pagina.click('#mic-btn');
  await cromo.pagina.waitForFunction(
    () => {
      const card = document.querySelector('#grid .card:not(.is-local)');
      const icone = card?.querySelector('.mic-off');
      return icone && getComputedStyle(icone).display !== 'none';
    },
    null,
    { timeout: 10_000 },
  );
  check('mudo do Firefox aparece no Chromium', true);
} catch (error) {
  check(`execução: ${error.message}`, false);
} finally {
  for (const sessao of abertos) await sessao.navegador.close().catch(() => {});
  server.stop();
  process.exit(finish() ? 1 : 0);
}
