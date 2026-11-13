// node --test checker/radar.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChannelPage, decodeEntities } from './radar/channel.mjs';
import { fingerprint, matchTerms, parseTerm } from './radar/match.mjs';
import { formatRadarMessage } from './radar/run.mjs';

const page = readFileSync(new URL('./fixtures/tg-ofertasnintendobr.html', import.meta.url), 'utf8');
const terms = (...t) => t.map(parseTerm);

test('canal: lê os posts da página pública real, em ordem, com texto, links e foto', () => {
  const posts = parseChannelPage(page, 'ofertasnintendobr');
  assert.ok(posts.length >= 15);
  assert.ok(posts.every((p, i) => i === 0 || p.id > posts[i - 1].id));
  const last = posts.at(-1);
  assert.equal(last.url, `https://t.me/ofertasnintendobr/${last.id}`);
  assert.ok(posts.some((p) => p.text.length > 30));
  assert.ok(posts.some((p) => p.links.length > 0));
  assert.ok(posts.every((p) => p.links.every((l) => !l.startsWith('https://t.me/'))));
  assert.ok(posts.some((p) => p.photo?.startsWith('https://')));
  assert.ok(!posts.some((p) => /<[a-z]/i.test(p.text)), 'texto sem tags HTML');
});

test('entidades: R&#036; vira R$', () => {
  assert.equal(decodeEntities('De R&#036;449 &amp; frete'), 'De R$449 & frete');
});

test('termos: todas as palavras, sem acento nem maiúscula, em qualquer ordem', () => {
  assert.deepEqual(matchTerms('Box Pokémon TCG Treinador Avançado', terms('pokemon tcg')), ['pokemon tcg']);
  assert.deepEqual(matchTerms('TCG da Pokémon em promoção', terms('Pokémon TCG')), ['Pokémon TCG']);
  assert.deepEqual(matchTerms('Boneco Pokémon de pelúcia', terms('pokemon tcg')), []);
});

test('termos: plural e exclusão', () => {
  assert.deepEqual(matchTerms('Notebooks gamer em oferta', terms('notebook')), ['notebook']);
  assert.deepEqual(matchTerms('Geladeira frost free', terms('geladeira -frigobar')), ['geladeira -frigobar']);
  assert.deepEqual(matchTerms('Frigobar e geladeira', terms('geladeira -frigobar')), []);
});

test('termos: palavra curta não casa pedaço de outra', () => {
  assert.deepEqual(matchTerms('Ventilador Mondial', terms('ps5')), []);
  assert.deepEqual(matchTerms('Console PS5 slim', terms('ps5')), ['ps5']);
  assert.deepEqual(matchTerms('Nintendinho retrô', terms('nin')), []);
});

test('repost em outro canal tem a mesma impressão digital', () => {
  const a = { text: '🔥 Box Pokémon TCG Treinador Avançado via Mercado Livre\nDe R$449 por R$359' };
  const b = { text: 'Box Pokemon TCG treinador avançado via Mercado Livre — De R$ 449 por R$ 359!' };
  assert.equal(fingerprint(a), fingerprint(b));
});

test('mensagem: escapa HTML do post e corta texto longo', () => {
  const msg = formatRadarMessage({ text: '<b>oi</b> ' + 'x'.repeat(2000) }, 'Canal & Cia', ['pokemon']);
  assert.match(msg, /Radar: pokemon<\/b> · Canal &amp; Cia/);
  assert.match(msg, /&lt;b&gt;oi/);
  assert.ok(msg.length < 1100);
});
