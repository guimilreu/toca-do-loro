/**
 * Gerador de QR code em modo byte, nível de correção L, versões 1 a 10.
 *
 * Escrito à mão porque a página não carrega nada de fora: o CSP proíbe CDN, e um
 * convite não justifica uma dependência. Cobre com folga uma URL de convite.
 */

const EC_PER_BLOCK = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
const BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4];
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const ALIGNMENT = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

/* ---------- GF(256) para Reed-Solomon ---------- */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Polinômio gerador em ordem decrescente: g[0] é sempre o coeficiente líder. */
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function ecCodewords(data, count) {
  const gen = generator(count);
  const result = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < count; i++) result[i] ^= mul(gen[i + 1], factor);
  }
  return result;
}

/* ---------- formato e versão ---------- */
function bch(value, generatorPoly, bits) {
  let result = value << bits;
  for (let i = 17; i >= bits; i--) {
    if (result & (1 << i)) result ^= generatorPoly << (i - bits);
  }
  return result;
}

/** Nível L é 01; o XOR final é exigido pela norma. */
const formatBits = (mask) => (((0b01 << 3) | mask) << 10 | bch((0b01 << 3) | mask, 0b10100110111, 10)) ^ 0b101010000010010;
const versionBits = (version) => (version << 12) | bch(version, 0b1111100100101, 12);

/* ---------- montagem ---------- */
function capacity(version) {
  return TOTAL_CODEWORDS[version - 1] - EC_PER_BLOCK[version - 1] * BLOCKS[version - 1];
}

function encodeData(text, version) {
  const bytes = new TextEncoder().encode(text);
  const lengthBits = version < 10 ? 8 : 16;
  const bits = [];
  const push = (value, count) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);
  push(bytes.length, lengthBits);
  for (const byte of bytes) push(byte, 8);

  const total = capacity(version) * 8;
  push(0, Math.min(4, total - bits.length));
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  const padding = [0xec, 0x11];
  while (codewords.length < capacity(version)) codewords.push(padding[codewords.length % 2]);
  return codewords;
}

/** Intercala blocos de dados e de correção, como manda a norma. */
function interleave(codewords, version) {
  const blocks = BLOCKS[version - 1];
  const ecCount = EC_PER_BLOCK[version - 1];
  const shortLen = Math.floor(codewords.length / blocks);
  const shortBlocks = blocks - (codewords.length % blocks);

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < blocks; i++) {
    const size = shortLen + (i < shortBlocks ? 0 : 1);
    const block = codewords.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(ecCodewords(block, ecCount));
  }

  const result = [];
  for (let i = 0; i < shortLen + 1; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < ecCount; i++) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return result;
}

function buildMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (x, y, value) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = value;
    reserved[y][x] = true;
  };

  const finder = (ox, oy) => {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const dentro = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const anel = x === 0 || x === 6 || y === 0 || y === 6;
        const centro = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        set(ox + x, oy + y, dentro && (anel || centro) ? 1 : 0);
      }
    }
  };

  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  for (let i = 8; i < size - 8; i++) {
    const value = i % 2 === 0 ? 1 : 0;
    set(i, 6, value);
    set(6, i, value);
  }

  for (const cy of ALIGNMENT[version - 1]) {
    for (const cx of ALIGNMENT[version - 1]) {
      const noFinder = (cx < 9 && cy < 9) || (cx > size - 10 && cy < 9) || (cx < 9 && cy > size - 10);
      if (noFinder) continue;
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          set(cx + x, cy + y, Math.max(Math.abs(x), Math.abs(y)) !== 1 ? 1 : 0);
        }
      }
    }
  }

  set(8, size - 8, 1); // módulo escuro fixo
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      set(i, 8, 0);
      set(8, i, 0);
    }
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, 0);
    set(8, size - 1 - i, 0);
  }

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      set(Math.floor(i / 3), size - 11 + (i % 3), bit);
      set(size - 11 + (i % 3), Math.floor(i / 3), bit);
    }
  }

  return { modules, reserved, size };
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function placeData(matrix, bytes, mask) {
  const { modules, reserved, size } = matrix;
  const bits = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }

  let index = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // a coluna do timing não conta
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (reserved[y][x]) continue;
        const bit = index < bits.length ? bits[index++] : 0;
        modules[y][x] = MASKS[mask](x, y) ? bit ^ 1 : bit;
      }
    }
    upward = !upward;
  }

  const format = formatBits(mask);
  const size1 = size;
  for (let i = 0; i < 15; i++) {
    const bit = (format >> i) & 1;
    if (i < 6) modules[i][8] = bit;
    else if (i < 8) modules[i + 1][8] = bit;
    else if (i === 8) modules[8][7] = bit;
    else modules[8][14 - i] = bit;

    if (i < 8) modules[8][size1 - 1 - i] = bit;
    else modules[size1 - 15 + i][8] = bit;
  }
  modules[size1 - 8][8] = 1;
}

/** Penalidades da norma: escolhem a máscara que deixa o código mais legível. */
function penalty(modules) {
  const size = modules.length;
  let score = 0;

  const runScore = (get) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        if (get(a, b) === get(a, b - 1)) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  };
  runScore((y, x) => modules[y][x]);
  runScore((x, y) => modules[y][x]);

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = modules[y][x];
      if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += 3;
    }
  }

  let dark = 0;
  for (const row of modules) for (const value of row) dark += value;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

/**
 * @param {string} text conteúdo do código
 * @returns {{size: number, modules: number[][]}} matriz de 0 e 1
 */
export function qr(text) {
  const bytes = new TextEncoder().encode(text).length;
  const version = TOTAL_CODEWORDS.findIndex((_, i) => capacity(i + 1) >= bytes + (i + 1 < 10 ? 2 : 3)) + 1;
  if (!version) throw new Error('texto longo demais para o QR');

  const codewords = interleave(encodeData(text, version), version);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const matrix = buildMatrix(version);
    placeData(matrix, codewords, mask);
    const score = penalty(matrix.modules);
    if (!best || score < best.score) best = { score, modules: matrix.modules };
  }
  return { size: best.modules.length, modules: best.modules };
}

/** Desenha num canvas com a margem silenciosa que os leitores exigem. */
export function drawQr(canvas, text, { dark = '#071429', light = '#ffffff', quiet = 4 } = {}) {
  const { size, modules } = qr(text);
  const total = size + quiet * 2;
  const scale = Math.max(1, Math.floor(canvas.width / total));
  const ctx = canvas.getContext('2d');

  canvas.width = canvas.height = total * scale;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }
  }
}
