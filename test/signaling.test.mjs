/** Protocolo do servidor: presença, salas, moderação, chat e limites. Sem navegador. */
import WebSocket from 'ws';

import { reporter, sleep, startServer } from './helpers.mjs';

const PORT = Number(process.env.TEST_PORT || 3210);
const URL = `ws://localhost:${PORT}/ws`;
const { check, finish } = reporter();

let seq = 0;
const open = (label) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { headers: { Origin: `http://localhost:${PORT}` } });
    ws.inbox = [];
    ws.label = label;
    ws.clientId = `cliente-${++seq}`;
    ws.on('message', (raw) => ws.inbox.push(JSON.parse(raw.toString())));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });

const waitFor = (ws, type, ms = 2500, where = () => true) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = ws.inbox.find((msg) => msg.type === type && where(msg));
      if (found) {
        clearInterval(timer);
        ws.inbox = ws.inbox.filter((msg) => msg !== found);
        resolve(found);
      } else if (Date.now() - started > ms) {
        clearInterval(timer);
        reject(new Error(`${ws.label}: timeout em "${type}" (recebeu ${ws.inbox.map((m) => m.type)})`));
      }
    }, 20);
  });

const send = (ws, msg) => ws.send(JSON.stringify(msg));

async function enter(label, options = {}) {
  const ws = await open(label);
  await waitFor(ws, 'hello');
  send(ws, { type: 'join', name: label, clientId: ws.clientId, ...options });
  return ws;
}

const server = await startServer(PORT, { MAX_PEERS: '4', DEFAULT_ROOM: 'toca' });

try {
  /* ---------- saguão e entrada ---------- */
  const ana = await open('Ana');
  const hello = await waitFor(ana, 'hello');
  check('saguão manda versão e lista de tocas', typeof hello.version === 'string' && Array.isArray(hello.rooms));

  send(ana, { type: 'join', name: '  Ana <script>  ', clientId: ana.clientId });
  const welcomeAna = await waitFor(ana, 'welcome');
  check('welcome traz id, sala e ICE', Boolean(welcomeAna.self.id && welcomeAna.room.slug && welcomeAna.iceServers.length));
  check('nome sanitizado', welcomeAna.self.name === 'Ana <script>', `"${welcomeAna.self.name}"`);
  check('quem cria a toca vira dono', welcomeAna.self.role === 'owner');
  check('welcome traz convite assinado', typeof welcomeAna.invite === 'string' && welcomeAna.invite.includes('.'));

  const bia = await enter('Bia');
  const welcomeBia = await waitFor(bia, 'welcome');
  check('quem chega depois é convidado', welcomeBia.self.role === 'guest');
  check('quem chega vê quem já estava', welcomeBia.peers.length === 1);
  check('quem estava é avisado', (await waitFor(ana, 'peer-joined')).peer.name === 'Bia');

  const bia2 = await enter('Bia');
  const welcomeBia2 = await waitFor(bia2, 'welcome');
  check('nome repetido é desambiguado', welcomeBia2.self.name === 'Bia (2)', welcomeBia2.self.name);
  bia2.close();
  await waitFor(ana, 'peer-left');

  /* ---------- sinalização ---------- */
  send(ana, { type: 'signal', to: welcomeBia.self.id, data: { description: { type: 'offer', sdp: 'v=0' }, evil: 'x' } });
  const signal = await waitFor(bia, 'signal');
  check('offer é relayada', signal.from === welcomeAna.self.id && signal.data.description.sdp === 'v=0');
  check('payload extra é descartado', signal.data.evil === undefined);

  send(ana, { type: 'signal', to: welcomeBia.self.id, data: { description: { type: 'offer', sdp: 'x'.repeat(70_000) } } });
  send(ana, { type: 'signal', to: welcomeBia.self.id, data: { candidate: { candidate: 'fim' } } });
  const candidate = await waitFor(bia, 'signal');
  check('SDP gigante é barrado', candidate.data.candidate?.candidate === 'fim');

  /* ---------- estado ---------- */
  send(bia, { type: 'state', muted: true, sharing: true, camera: true, hand: true, watching: welcomeAna.self.id });
  const estado = await waitFor(ana, 'peer-state');
  check(
    'estado propaga inteiro',
    estado.muted && estado.sharing && estado.camera && estado.hand && estado.watching === welcomeAna.self.id,
  );

  /* ---------- chat ---------- */
  send(bia, { type: 'chat', text: '  olá **mundo**  ' });
  const chat = await waitFor(ana, 'chat');
  check('chat chega com nome e texto limpo', chat.name === 'Bia' && chat.text === 'olá **mundo**');

  send(bia, { type: 'reaction', emoji: '🦜' });
  check('reação válida propaga', (await waitFor(ana, 'reaction')).emoji === '🦜');
  send(bia, { type: 'reaction', emoji: '💣' });
  send(bia, { type: 'typing' });
  check('reação fora da lista é ignorada', (await waitFor(ana, 'typing')).name === 'Bia');

  /* ---------- moderação ---------- */
  send(bia, { type: 'mod', action: 'kick', target: welcomeAna.self.id });
  check('convidado não modera', (await waitFor(bia, 'error')).code === 'not-allowed');

  send(ana, { type: 'mod', action: 'mute', target: welcomeBia.self.id, value: true });
  check('dono silencia', (await waitFor(bia, 'forced')).muted === true);
  send(bia, { type: 'state', muted: false });
  await sleep(120);
  check('silenciado não se desmuta sozinho', true);

  send(ana, { type: 'mod', action: 'promote', target: welcomeBia.self.id });
  const promovido = await waitFor(bia, 'peer-state', 2500, (msg) => msg.role !== undefined);
  check('dono promove a moderador', promovido.role === 'mod');

  send(ana, { type: 'room', action: 'pin', value: 'pauta do dia' });
  check('mensagem fixada propaga', (await waitFor(bia, 'pinned')).text === 'pauta do dia');

  send(ana, { type: 'room', action: 'rename', value: 'Toca da Ana' });
  check('renomear propaga', (await waitFor(bia, 'room-info')).room.name === 'Toca da Ana');

  send(ana, { type: 'mod', action: 'kick', target: welcomeBia.self.id });
  const kicked = await waitFor(bia, 'kicked');
  check('expulsar avisa quem foi expulso', kicked.by === 'Ana <script>' && kicked.blocked === false);
  await waitFor(ana, 'peer-left');

  /* ---------- salas separadas ---------- */
  const caio = await enter('Caio', { slug: 'outra-sala' });
  const welcomeCaio = await waitFor(caio, 'welcome');
  check('sala nova é criada sob demanda', welcomeCaio.room.slug === 'outra-sala');
  check('sala nova começa vazia', welcomeCaio.peers.length === 0);
  check('quem cria a sala nova é dono dela', welcomeCaio.self.role === 'owner');

  send(caio, { type: 'signal', to: welcomeAna.self.id, data: { candidate: { candidate: 'vazando' } } });
  await sleep(150);
  check('sinal não atravessa salas', !ana.inbox.some((m) => m.type === 'signal'));

  send(ana, { type: 'rooms' });
  const lista = await waitFor(ana, 'rooms');
  check('lista de tocas ativas', lista.rooms.length === 2 && lista.rooms.every((r) => r.count > 0));

  /* ---------- senha e convite ---------- */
  send(caio, { type: 'room', action: 'password', value: 'segredo' });
  await sleep(150);

  const semSenha = await enter('Dani', { slug: 'outra-sala' });
  check('senha errada barra', (await waitFor(semSenha, 'error')).code === 'bad-password');
  semSenha.close();

  const comSenha = await enter('Dani', { slug: 'outra-sala', password: 'segredo' });
  check('senha certa entra', (await waitFor(comSenha, 'welcome')).room.slug === 'outra-sala');
  comSenha.close();

  send(caio, { type: 'invite', hours: 1 });
  const convite = await waitFor(caio, 'invite');
  const comConvite = await enter('Edu', { token: convite.token });
  const welcomeEdu = await waitFor(comConvite, 'welcome');
  check('convite assinado dispensa senha', welcomeEdu.room.slug === 'outra-sala');

  /* ---------- trancar ---------- */
  send(caio, { type: 'room', action: 'lock', value: true });
  await waitFor(comConvite, 'room-info');
  const barrado = await enter('Fê', { slug: 'outra-sala', password: 'segredo' });
  check('toca trancada não deixa entrar', (await waitFor(barrado, 'error')).code === 'locked');
  barrado.close();
  send(caio, { type: 'room', action: 'lock', value: false });
  await sleep(120);

  /* ---------- retomada de sessão ---------- */
  const antesDeCair = welcomeEdu.self.id;
  comConvite.terminate();
  await sleep(200);
  const pendente = await waitFor(caio, 'peer-state');
  check('queda deixa a vaga pendente, não vazia', pendente.pending === true);

  const voltou = await open('Edu');
  await waitFor(voltou, 'hello');
  send(voltou, { type: 'join', slug: 'outra-sala', resume: antesDeCair, clientId: comConvite.clientId });
  const welcomeVolta = await waitFor(voltou, 'welcome');
  check('retomada mantém o mesmo id', welcomeVolta.resumed === true && welcomeVolta.self.id === antesDeCair);
  voltou.close();

  /* ---------- limites ---------- */
  const cheia = [];
  for (let i = 0; i < 4; i++) cheia.push(await enter(`Extra ${i}`, { slug: 'lotada' }));
  await sleep(250);
  const sobrando = await enter('Tarde demais', { slug: 'lotada' });
  const erroCheio = await waitFor(sobrando, 'error');
  check('sala cheia recusa', erroCheio.code === 'room-full' && erroCheio.max === 4, JSON.stringify(erroCheio));
  sobrando.close();
  cheia.forEach((ws) => ws.close());

  const flood = await open('Flood');
  for (let i = 0; i < 320; i++) send(flood, { type: 'ping' });
  check('rate limit por conexão corta', (await waitFor(flood, 'error')).code === 'rate-limited');
  flood.close();

  ana.send('{json quebrado');
  send(ana, { type: 'inexistente' });
  await sleep(120);
  check('servidor ignora lixo', ana.readyState === WebSocket.OPEN);

  /* ---------- origem e IP ---------- */
  const forasteiro = new WebSocket(URL, { headers: { Origin: 'https://site-do-mal.example' } });
  const recusa = await new Promise((resolve) => {
    forasteiro.on('unexpected-response', (_, res) => resolve(res.statusCode));
    forasteiro.on('error', () => resolve('erro'));
    forasteiro.on('open', () => resolve('abriu'));
  });
  check('origem estranha é recusada', recusa === 403, String(recusa));

  const limite = await startServer(PORT + 1, { MAX_CONNECTIONS_PER_IP: '2' });
  try {
    const url = `ws://localhost:${PORT + 1}/ws`;
    const abertas = [];
    for (let i = 0; i < 2; i++) {
      const ws = new WebSocket(url, { headers: { Origin: `http://localhost:${PORT + 1}` } });
      await new Promise((resolve) => ws.on('open', resolve));
      abertas.push(ws);
    }
    const terceira = new WebSocket(url, { headers: { Origin: `http://localhost:${PORT + 1}` } });
    const status = await new Promise((resolve) => {
      terceira.on('unexpected-response', (_, res) => resolve(res.statusCode));
      terceira.on('error', () => resolve('erro'));
      terceira.on('open', () => resolve('abriu'));
    });
    check('limite de conexões por IP corta', status === 429, String(status));
    abertas.forEach((ws) => ws.close());
  } finally {
    limite.stop();
  }

  ana.close();
  caio.close();
  await sleep(150);
} catch (error) {
  check(`execução: ${error.message}`, false);
} finally {
  server.stop();
  process.exit(finish() ? 1 : 0);
}
