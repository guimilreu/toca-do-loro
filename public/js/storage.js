/** Preferências e identidade local. Tudo mora no navegador, nada vai pro servidor. */

const PREFIX = 'toca:';

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* navegação privada com armazenamento bloqueado: segue sem lembrar */
  }
};

/** Id estável do navegador: reconhece você entre sessões sem pedir cadastro. */
export function clientId() {
  let id = read('client-id', null);
  if (!id) {
    id = crypto.randomUUID();
    write('client-id', id);
  }
  return id;
}

/**
 * @typedef {object} Prefs
 * @property {string} name
 * @property {string} avatar
 * @property {string} color
 * @property {string} pronouns
 * @property {string} micId
 * @property {string} outId
 * @property {string} camId
 * @property {number} gain
 * @property {number} vad
 * @property {boolean} gate
 * @property {boolean} aec
 * @property {boolean} ns
 * @property {boolean} agc
 * @property {boolean} spatial
 * @property {'none'|'grave'|'agudo'|'robo'} effect
 * @property {boolean} sounds
 * @property {'grade'|'foco'|'lista'} layout
 * @property {boolean} privacy
 * @property {boolean} motion
 * @property {'720p30'|'1080p30'|'1080p60'} quality
 * @property {number} voiceKbps
 * @property {'auto'|'dark'|'light'} theme
 * @property {Record<string, number>} volumes
 * @property {string[]} blocked
 * @property {boolean} onboarded
 * @property {'ativo'|'ausente'|'ocupado'} status
 */

/** @type {Prefs} */
const DEFAULTS = {
  name: '',
  avatar: '🦜',
  color: '',
  pronouns: '',
  micId: '',
  outId: '',
  camId: '',
  gain: 100,
  vad: 5,
  gate: true,
  aec: true,
  ns: true,
  agc: true,
  spatial: true,
  effect: 'none',
  sounds: true,
  layout: 'grade',
  privacy: false,
  motion: false,
  quality: '1080p30',
  voiceKbps: 48,
  theme: 'auto',
  volumes: {},
  blocked: [],
  onboarded: false,
  status: 'ativo',
};

/** @type {Prefs} */
export const prefs = new Proxy(
  /** @type {any} */ ({}),
  {
    get: (_, key) => read(key, DEFAULTS[key]),
    set: (_, key, value) => (write(key, value), true),
  },
);

/** Volume e bloqueio são por pessoa e precisam sobreviver ao recarregar. */
export const peerVolume = {
  get: (name) => prefs.volumes[name] ?? 1,
  set(name, value) {
    prefs.volumes = { ...prefs.volumes, [name]: value };
  },
};

export const blocklist = {
  has: (name) => prefs.blocked.includes(name),
  toggle(name) {
    const list = prefs.blocked;
    prefs.blocked = list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
    return this.has(name);
  },
};
