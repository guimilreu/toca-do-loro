/** Testes de unidade das partes puras: sem rede, sem navegador. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IpLimiter } from '../server/limits.js';
import { clean, Room } from '../server/room.js';
import { toSlug } from '../server/rooms.js';
import { checkPassword, createInvite, hashPassword, readInvite } from '../server/tokens.js';
import { grade, mos } from '../public/js/stats.js';
import { qr } from '../public/js/qr.js';

test('slug tira acento, espaço e sobra', () => {
  assert.equal(toSlug('Toca do Loro'), 'toca-do-loro');
  assert.equal(toSlug('  Ação & Reação!! '), 'acao-reacao');
  assert.equal(toSlug('---x---'), 'x');
  assert.equal(toSlug('a'.repeat(50)).length, 32);
  assert.equal(toSlug(''), '');
});

test('nome perde caracteres de controle e respeita o teto', () => {
  assert.equal(clean('  Fred  '), 'Fred');
  assert.equal(clean('a'.repeat(40)).length, 24);
  assert.equal(clean(String.fromCharCode(7) + 'oi'), 'oi');
  assert.equal(clean(undefined), '');
});

test('convite só vale assinado e dentro do prazo', () => {
  const token = createInvite('geral', Date.now() + 60_000);
  assert.equal(readInvite(token).slug, 'geral');
  assert.equal(readInvite(`${token}x`), null);
  assert.equal(readInvite(createInvite('geral', Date.now() - 1)), null);
  assert.equal(readInvite('qualquer coisa'), null);
});

test('senha é comparada por hash', () => {
  const hash = hashPassword('abacaxi');
  assert.ok(checkPassword(hash, 'abacaxi'));
  assert.ok(!checkPassword(hash, 'abacax'));
  assert.ok(!checkPassword(null, 'abacaxi'));
});

test('limite por IP conta conexões e entradas', () => {
  const limiter = new IpLimiter({ maxConnections: 2, maxJoins: 2 });
  assert.deepEqual([limiter.connect('a'), limiter.connect('a'), limiter.connect('a')], [true, true, false]);
  limiter.disconnect('a');
  assert.ok(limiter.connect('a'));
  assert.deepEqual([limiter.join('b'), limiter.join('b'), limiter.join('b')], [true, true, false]);
});

test('sala recusa por lotação, tranca, senha e bloqueio', () => {
  const room = new Room({ slug: 'x', name: 'X', maxPeers: 1 });
  assert.equal(room.denyReason({ ownerKey: 'dono' }), null);

  room.add({ readyState: 1, OPEN: 1 }, { name: 'Dono', ownerKey: 'dono' });
  assert.equal(room.denyReason({ ownerKey: 'outro' }).code, 'room-full');

  room.maxPeers = 5;
  room.locked = true;
  assert.equal(room.denyReason({ ownerKey: 'outro' }).code, 'locked');
  assert.equal(room.denyReason({ ownerKey: 'dono' }), null, 'dono entra mesmo trancada');

  room.locked = false;
  room.setPassword('123');
  assert.equal(room.denyReason({ ownerKey: 'outro' }).code, 'bad-password');
  assert.equal(room.denyReason({ ownerKey: 'outro', password: '123' }), null);
  assert.equal(room.denyReason({ ownerKey: 'outro', invited: true }), null, 'convite dispensa senha');

  room.blocked.add('banido');
  assert.equal(room.denyReason({ ownerKey: 'banido', password: '123' }).code, 'blocked');
});

test('nome repetido ganha sufixo', () => {
  const ws = { readyState: 1, OPEN: 1 };
  const room = new Room({ slug: 'x', name: 'X', maxPeers: 9 });
  assert.equal(room.add(ws, { name: 'Fred', ownerKey: 'a' }).name, 'Fred');
  assert.equal(room.add(ws, { name: 'Fred', ownerKey: 'b' }).name, 'Fred (2)');
  assert.equal(room.add(ws, { name: 'Fred', ownerKey: 'c' }).name, 'Fred (3)');
});

test('dono sai e o bastão passa pra próxima pessoa', () => {
  const ws = { readyState: 1, OPEN: 1, send() {} };
  const room = new Room({ slug: 'x', name: 'X', maxPeers: 9 });
  const dono = room.add(ws, { name: 'Dono', ownerKey: 'a' });
  const outro = room.add(ws, { name: 'Outro', ownerKey: 'b' });
  assert.equal(outro.role, 'guest');
  room.remove(dono.id);
  assert.equal(outro.role, 'owner');
});

test('nota da chamada acompanha a degradação', () => {
  const boa = mos({ rtt: 20, jitter: 0.002, loss: 0 });
  const media = mos({ rtt: 120, jitter: 0.02, loss: 0.02 });
  const ruim = mos({ rtt: 400, jitter: 0.08, loss: 0.12 });

  assert.ok(boa > media && media > ruim, `${boa} > ${media} > ${ruim}`);
  assert.equal(grade(boa), 'boa');
  assert.equal(grade(ruim), 'ruim');
  assert.ok(mos({ rtt: 0, jitter: 0, loss: 1 }) >= 1, 'nota nunca sai da escala');
  assert.ok(mos({ rtt: 0, jitter: 0, loss: 0 }) <= 5);
});

test('QR cresce de versão conforme o texto e mantém a matriz quadrada', () => {
  const curto = qr('oi');
  const longo = qr(`https://tocadoloro.gmdev.pro/r/sala?t=${'x'.repeat(60)}`);

  assert.equal(curto.size, 21, 'versão 1');
  assert.ok(longo.size > curto.size);
  assert.equal(longo.modules.length, longo.size);
  assert.ok(longo.modules.every((linha) => linha.length === longo.size));
  assert.ok(longo.modules.flat().every((valor) => valor === 0 || valor === 1));
  assert.throws(() => qr('x'.repeat(400)), /longo demais/);
});

test('QR marca os três olhos de posicionamento', () => {
  const { modules, size } = qr('oi');
  const olho = (ox, oy) => modules[oy + 3][ox + 3] === 1 && modules[oy][ox + 1] === 1 && modules[oy + 1][ox + 1] === 0;
  assert.ok(olho(0, 0) && olho(size - 7, 0) && olho(0, size - 7));
});
