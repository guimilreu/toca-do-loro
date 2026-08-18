import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { WebSocketServer } from 'ws';

import { clientIp, IpLimiter } from './limits.js';
import { Rooms, toSlug } from './rooms.js';
import { securityHeaders, serveStatic } from './static.js';
import { Session } from './session.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PEERS = Number(process.env.MAX_PEERS || 12);
const ROOM_NAME = process.env.ROOM_NAME || 'Toca do Loro';
const HEARTBEAT_MS = 30_000;
const TURN_TTL_SECONDS = 12 * 3600;

const list = (value, fallback = '') =>
  (value ?? fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** Versão exibida na interface: o commit, quando o git está por perto. */
function readVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

/**
 * ICE montado a cada entrada. Com TURN_SECRET usa o TURN REST API: a credencial
 * é um HMAC com validade, então o segredo do coturn nunca chega ao navegador.
 */
function buildIceServers() {
  const stun = list(process.env.STUN_URLS, 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302');
  const turn = list(process.env.TURN_URLS);
  const servers = stun.length ? [{ urls: stun }] : [];
  if (!turn.length) return servers;

  const secret = process.env.TURN_SECRET;
  if (secret) {
    const username = String(Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS);
    servers.push({ urls: turn, username, credential: createHmac('sha1', secret).update(username).digest('base64') });
  } else {
    servers.push({
      urls: turn,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_PASSWORD || '',
    });
  }
  return servers;
}

const VERSION = readVersion();
const rooms = new Rooms({
  defaultSlug: toSlug(process.env.DEFAULT_ROOM || 'toca'),
  defaultName: ROOM_NAME,
  maxPeers: MAX_PEERS,
});
const limiter = new IpLimiter({
  maxConnections: Number(process.env.MAX_CONNECTIONS_PER_IP || 8),
  maxJoins: Number(process.env.MAX_JOINS_PER_IP || 20),
});

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    const body = JSON.stringify({ ok: true, version: VERSION, peers: rooms.totalPeers, rooms: rooms.active().length });
    res.writeHead(200, {
      ...securityHeaders(req),
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  serveStatic(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

/**
 * Só aceita WebSocket vindo da própria origem. Sem isso, qualquer site aberto
 * no navegador de alguém consegue abrir conexão contra este servidor.
 */
const ALLOWED_ORIGINS = list(process.env.ALLOWED_ORIGINS);
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // clientes que não são navegador (os testes, por exemplo)
  if (ALLOWED_ORIGINS.length) return ALLOWED_ORIGINS.includes(origin);
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = (req.url || '').split('?')[0];
  if (url !== '/ws') return socket.destroy();

  if (!originAllowed(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }

  const ip = clientIp(req);
  if (!limiter.connect(ip)) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    return socket.destroy();
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.once('close', () => limiter.disconnect(ip));
    wss.emit('connection', ws, req, ip);
  });
});

/** Avisa o saguão quando a lista de tocas ativas muda. */
const sessions = new Set();
const broadcastLobby = () => {
  const msg = JSON.stringify({ type: 'rooms', rooms: rooms.active() });
  for (const session of sessions) {
    if (!session.room && session.ws.readyState === session.ws.OPEN) session.ws.send(msg);
  }
};

wss.on('connection', (ws, req, ip) => {
  const session = new Session(ws, {
    rooms,
    iceServers: buildIceServers,
    version: VERSION,
    onLobbyChange: broadcastLobby,
    canJoin: () => limiter.join(ip),
  });
  sessions.add(session);
  ws.on('close', () => sessions.delete(session));
});

const heartbeat = setInterval(() => rooms.sweep(), HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  const turn = list(process.env.TURN_URLS);
  console.log(`Toca do Loro ${VERSION} em http://localhost:${PORT}  (toca "${ROOM_NAME}", max ${MAX_PEERS})`);
  console.log(
    turn.length
      ? `TURN: ${turn.join(', ')} (${process.env.TURN_SECRET ? 'credencial temporária' : 'credencial fixa'})`
      : 'aviso: sem TURN configurado — redes com NAT simétrico podem não conectar.',
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(heartbeat);
    // Avisa antes de derrubar: o cliente mostra "reconectando" em vez de sumir.
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(JSON.stringify({ type: 'bye' }));
      client.close(1001, 'server shutdown');
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
