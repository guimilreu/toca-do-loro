import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Cabeçalhos de segurança. A política é fechada de propósito: a página não
 * carrega nada de fora, não é embutível e só fala com a própria origem.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
].join('; ');

export function securityHeaders(req) {
  const headers = {
    'content-security-policy': CSP,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'permissions-policy': 'microphone=(self), camera=(self), display-capture=(self), geolocation=(), payment=()',
    'cross-origin-opener-policy': 'same-origin',
  };
  if ((req.headers['x-forwarded-proto'] || '').includes('https')) {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

/** Resolve a URL para um arquivo dentro de ROOT, ou null se tentar escapar. */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const target = path.join(ROOT, relative === '/' || relative === '.' ? 'index.html' : relative);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

/** /r/<slug> é rota da aplicação, não arquivo: devolve o index. */
const isRoomRoute = (url) => /^\/r\/[^/]*\/?$/.test(url.split('?')[0]);

export async function serveStatic(req, res) {
  const base = securityHeaders(req);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...base, allow: 'GET, HEAD' }).end();
    return;
  }

  const url = req.url || '/';
  let file = isRoomRoute(url) ? path.join(ROOT, 'index.html') : resolveFile(url);
  if (!file) {
    res.writeHead(403, base).end();
    return;
  }

  let info;
  try {
    info = await stat(file);
    if (info.isDirectory()) info = await stat((file += path.sep + 'index.html'));
  } catch {
    res.writeHead(404, { ...base, 'content-type': 'text/plain; charset=utf-8' }).end('404');
    return;
  }

  const etag = `W/"${info.size.toString(36)}-${info.mtimeMs.toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...base, etag, 'cache-control': 'no-cache' }).end();
    return;
  }

  res.writeHead(200, {
    ...base,
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-cache',
    etag,
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}
