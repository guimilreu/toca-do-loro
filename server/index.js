import { createHmac } from 'node:crypto';
import http from 'node:http';
import { WebSocketServer } from 'ws';

import { Room } from './room.js';
import { serveStatic } from './static.js';

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

/**
 * Monta a lista de ICE servers na hora de cada entrada.
 * Com TURN_SECRET usa o TURN REST API: a credencial é um HMAC com validade,
 * então o segredo do coturn nunca chega ao navegador e ninguém reaproveita o
 * relay depois que expira.
 */
function buildIceServers() {
  const stun = list(process.env.STUN_URLS, 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302');
  const turn = list(process.env.TURN_URLS);
  const servers = stun.length ? [{ urls: stun }] : [];
  if (!turn.length) return servers;

  const secret = process.env.TURN_SECRET;
  if (secret) {
    const username = String(Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS);
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    servers.push({ urls: turn, username, credential });
  } else {
    servers.push({
      urls: turn,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_PASSWORD || '',
    });
  }
  return servers;
}

const room = new Room({ name: ROOM_NAME, maxPeers: MAX_PEERS, iceServers: buildIceServers });

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    const body = JSON.stringify({ ok: true, peers: room.size, maxPeers: MAX_PEERS });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  serveStatic(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });
wss.on('connection', (ws) => room.attach(ws));

const heartbeat = setInterval(() => room.sweep(), HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  const turn = list(process.env.TURN_URLS);
  console.log(`Toca do Loro em http://localhost:${PORT}  (toca "${ROOM_NAME}", max ${MAX_PEERS})`);
  console.log(
    turn.length
      ? `TURN: ${turn.join(', ')} (${process.env.TURN_SECRET ? 'credencial temporária' : 'credencial fixa'})`
      : 'aviso: sem TURN configurado — redes com NAT simétrico podem não conectar.',
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(heartbeat);
    for (const client of wss.clients) client.close(1001, 'server shutdown');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
