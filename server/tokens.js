import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Convites e senhas. Tudo assinado, nada guardado em disco: o segredo vive na
 * memória do processo (ou em TOCA_SECRET) e o convite carrega a própria validade.
 */
const SECRET = process.env.TOCA_SECRET || randomBytes(32).toString('hex');

const sign = (data) => createHmac('sha256', SECRET).update(data).digest('base64url');

const equal = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

/**
 * @param {string} slug sala a que o convite dá acesso
 * @param {number} expiresAt timestamp em ms; 0 significa convite sem validade
 */
export function createInvite(slug, expiresAt = 0) {
  const body = `${slug}.${expiresAt}`;
  return `${Buffer.from(body).toString('base64url')}.${sign(body)}`;
}

export function readInvite(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;

  const cut = token.lastIndexOf('.');
  const body = Buffer.from(token.slice(0, cut), 'base64url').toString();
  if (!equal(sign(body), token.slice(cut + 1))) return null;

  const [slug, expiresAt] = body.split('.');
  const deadline = Number(expiresAt);
  if (deadline && Date.now() > deadline) return null;
  return { slug, expiresAt: deadline };
}

/** A senha nunca trafega de volta nem fica em claro na memória da sala. */
export const hashPassword = (password) => sign(`password:${password}`);
export const checkPassword = (hash, password) => Boolean(hash) && equal(hash, hashPassword(password));
