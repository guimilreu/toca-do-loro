/** Sinalização: presença, relay de SDP/ICE, saída, limites. Não usa navegador. */
import WebSocket from 'ws';

import { reporter, sleep, startServer } from './helpers.mjs';

const PORT = Number(process.env.TEST_PORT || 3210);
const URL = `ws://localhost:${PORT}/ws`;
const { check, finish } = reporter();

const open = (label) =>
  new Promise((resolve) => {
    const ws = new WebSocket(URL);
    ws.inbox = [];
    ws.label = label;
    ws.on('message', (raw) => ws.inbox.push(JSON.parse(raw.toString())));
    ws.on('open', () => resolve(ws));
  });

const waitFor = (ws, type, ms = 2000) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = ws.inbox.find((msg) => msg.type === type);
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > ms) {
        clearInterval(timer);
        reject(new Error(`${ws.label}: timeout em "${type}" (recebeu ${ws.inbox.map((m) => m.type)})`));
      }
    }, 25);
  });

const send = (ws, msg) => ws.send(JSON.stringify(msg));

const server = await startServer(PORT);

try {
  const a = await open('A');
  check('lobby recebe hello', (await waitFor(a, 'hello')).room !== undefined);

  send(a, { type: 'join', name: '  Ana <script>  ' });
  const welcomeA = await waitFor(a, 'welcome');
  check('welcome traz id e ice', typeof welcomeA.self.id === 'string' && welcomeA.iceServers.length > 0);
  check('nome sanitizado', welcomeA.self.name === 'Ana <script>', `"${welcomeA.self.name}"`);
  check('sala começa vazia', welcomeA.peers.length === 0);

  const b = await open('B');
  check('lobby vê 1 pessoa', (await waitFor(b, 'hello')).count === 1);

  send(b, { type: 'join', name: 'Bia' });
  const welcomeB = await waitFor(b, 'welcome');
  check('quem chega vê quem já estava', welcomeB.peers.length === 1);
  check('quem estava é avisado', (await waitFor(a, 'peer-joined')).peer.id === welcomeB.self.id);

  send(a, { type: 'signal', to: welcomeB.self.id, data: { description: { type: 'offer', sdp: 'v=0' }, evil: 'x' } });
  const signal = await waitFor(b, 'signal');
  check('offer é relayada', signal.from === welcomeA.self.id && signal.data.description.sdp === 'v=0');
  check('payload extra é descartado', signal.data.evil === undefined);

  send(b, { type: 'signal', to: 'inexistente', data: { candidate: {} } });
  send(b, { type: 'state', muted: true, sharing: true });
  const state = await waitFor(a, 'peer-state');
  check('estado propaga', state.muted === true && state.sharing === true);

  b.close();
  check('saída propaga', (await waitFor(a, 'peer-left')).id === welcomeB.self.id);

  a.send('{json quebrado');
  send(a, { type: 'tipo-desconhecido' });
  await sleep(150);
  check('servidor ignora lixo', a.readyState === WebSocket.OPEN);

  a.close();
  await sleep(150);

  const full = await startServer(PORT + 1, { MAX_PEERS: '1' });
  try {
    const first = new WebSocket(`ws://localhost:${PORT + 1}/ws`);
    await new Promise((resolve) => first.on('open', resolve));
    first.send(JSON.stringify({ type: 'join', name: 'A' }));
    await sleep(200);

    const second = new WebSocket(`ws://localhost:${PORT + 1}/ws`);
    second.inbox = [];
    second.label = 'cheio';
    second.on('message', (raw) => second.inbox.push(JSON.parse(raw.toString())));
    await new Promise((resolve) => second.on('open', resolve));
    second.send(JSON.stringify({ type: 'join', name: 'B' }));

    const error = await waitFor(second, 'error');
    check('sala cheia recusa entrada', error.code === 'room-full' && error.max === 1);
    first.close();
    second.close();
  } finally {
    full.stop();
  }
} catch (error) {
  check(`execução: ${error.message}`, false);
} finally {
  server.stop();
  process.exit(finish() ? 1 : 0);
}
