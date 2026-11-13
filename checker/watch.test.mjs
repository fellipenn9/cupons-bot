// node --test checker/watch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffWatch, formatWatchMessage, watchKey } from './watch/run.mjs';

const prod = (key, available, price = 10) => ({ productKey: key, available, price, title: key, url: `https://loja/${key}/p` });

test('primeira leitura só guarda, sem avisar', () => {
  const { next, events, firstRun } = diffWatch(undefined, [prod('a', true), prod('b', false)]);
  assert.equal(firstRun, true);
  assert.deepEqual(events, []);
  assert.deepEqual(Object.keys(next), ['a', 'b']);
});

test('produto novo e esgotado que voltou geram aviso; o resto não', () => {
  const known = { a: { available: true, price: 10 }, b: { available: false, price: 10 }, c: { available: true, price: 10 } };
  const { events } = diffWatch(known, [prod('a', true), prod('b', true), prod('c', false), prod('d', false)]);
  assert.deepEqual(events.map((e) => `${e.type}:${e.product.productKey}`), ['back:b', 'new:d']);
});

test('produto que some da busca não vira novidade quando volta', () => {
  const step1 = diffWatch({ a: { available: true, price: 10 } }, [prod('b', true)]).next;
  assert.ok(step1.a, 'a continua conhecido');
  const { events } = diffWatch(step1, [prod('a', true), prod('b', true)]);
  assert.deepEqual(events, []);
});

test('mensagem diz se ainda não tem estoque', () => {
  const msg = formatWatchMessage({ type: 'new', product: prod('Box <Pokémon>', false) }, 'COPAG', 'pokemon');
  assert.match(msg, /Novidade na COPAG/);
  assert.match(msg, /Box &lt;Pokémon&gt;/);
  assert.match(msg, /sem estoque/);
});

test('chave ignora maiúscula e espaço nas pontas', () => {
  assert.equal(watchKey({ store: 'copag', term: ' Pokemon ' }), 'copag|pokemon');
});
