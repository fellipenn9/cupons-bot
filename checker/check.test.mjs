// node --test checker/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKabum, kabum } from './stores/kabum.mjs';
import { evaluateFailure, evaluateOffer, FAILS_BEFORE_WARNING } from './lib/evaluate.mjs';

const fixture = readFileSync(new URL('./fixtures/kabum-produto.html', import.meta.url), 'utf8');
const offer = (price, extra = {}) => ({ title: 'Mouse', image: null, price, priceCard: null, listPrice: null, available: true, ...extra });
const checked = { url: 'https://www.kabum.com.br/produto/1', lastCheckedAt: new Date('2026-11-01'), lowestPrice: 120 };

test('KaBuM: lê Pix, cartão, "de" e estoque da página real salva', () => {
  const o = parseKabum(fixture);
  assert.match(o.title, /Logitech G203/);
  assert.equal(o.price, 99.99);
  assert.equal(o.priceCard, 117.64);
  assert.equal(o.listPrice, 199.99);
  assert.equal(o.available, true);
  assert.match(o.image, /^https:\/\/images\.kabum\.com\.br\//);
});

test('KaBuM: reconhece o link com ou sem slug e ignora outras lojas', () => {
  assert.equal(kabum.productKey('https://www.kabum.com.br/produto/112948/mouse-x?gclid=1'), 'kabum:112948');
  assert.equal(kabum.productKey('https://kabum.com.br/produto/5'), 'kabum:5');
  assert.equal(kabum.productKey('https://www.kabum.com.br/busca/mouse'), null);
  assert.equal(kabum.productKey('https://www.amazon.com.br/dp/B0'), null);
});

test('KaBuM: página sem preço vira erro, não preço zero', () => {
  assert.throws(() => parseKabum('<html></html>'), /preço/);
});

test('primeira leitura avisa que começou a acompanhar', () => {
  const { messages, update } = evaluateOffer({ url: 'u', targetPrice: 80 }, offer(100));
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Comecei a acompanhar/);
  assert.equal(update.lowestPrice, 100);
  assert.equal(update.alertedPrice, null);
});

test('avisa ao atingir a meta, não repete no mesmo preço, avisa de novo se cair mais', () => {
  const first = evaluateOffer({ ...checked, targetPrice: 100 }, offer(100));
  assert.match(first.messages[0], /Chegou no seu preço/);
  assert.equal(first.update.alertedPrice, 100);

  const same = evaluateOffer({ ...checked, targetPrice: 100, ...first.update }, offer(100));
  assert.equal(same.messages.length, 0);

  const lower = evaluateOffer({ ...checked, targetPrice: 100, ...first.update }, offer(90));
  assert.match(lower.messages[0], /Caiu de novo/);
});

test('subir acima da meta rearma o alerta', () => {
  const fav = { ...checked, targetPrice: 100, alertedPrice: 95, alertTarget: 100 };
  const up = evaluateOffer(fav, offer(110));
  assert.equal(up.messages.length, 0);
  assert.equal(up.update.alertedPrice, null);
  const back = evaluateOffer({ ...fav, ...up.update }, offer(98));
  assert.match(back.messages[0], /Chegou no seu preço/);
});

test('mudar a meta rearma o alerta', () => {
  const fav = { ...checked, targetPrice: 100, alertedPrice: 95, alertTarget: 120 };
  assert.match(evaluateOffer(fav, offer(95)).messages[0], /Chegou no seu preço/);
});

test('sem estoque não dispara alerta de meta; voltar ao estoque avisa', () => {
  const out = evaluateOffer({ ...checked, targetPrice: 100 }, offer(50, { available: false }));
  assert.equal(out.messages.length, 0);
  const back = evaluateOffer({ ...checked, targetPrice: 40, available: false }, offer(50));
  assert.match(back.messages[0], /Voltou ao estoque/);
});

test('histórico: grava quando o preço muda e não duplica preço igual no mesmo dia', () => {
  const t0 = new Date('2026-11-10T10:00:00Z');
  const a = evaluateOffer({ ...checked, history: [] }, offer(100), t0);
  const b = evaluateOffer({ ...checked, ...a.update }, offer(100), new Date('2026-11-10T12:00:00Z'));
  assert.equal(b.update.history.length, 1);
  const c = evaluateOffer({ ...checked, ...b.update }, offer(95), new Date('2026-11-10T14:00:00Z'));
  assert.equal(c.update.history.length, 2);
  const d = evaluateOffer({ ...checked, ...c.update }, offer(95), new Date('2026-11-11T15:00:00Z'));
  assert.equal(d.update.history.length, 3);
});

test('falhas: avisa uma única vez, na terceira seguida', () => {
  const err = new Error('A loja bloqueou o acesso (403)');
  let fav = { url: 'u' };
  const sent = [];
  for (let i = 0; i < 5; i++) {
    const r = evaluateFailure(fav, err);
    sent.push(r.messages.length);
    fav = { ...fav, ...r.update };
  }
  assert.deepEqual(sent, [0, 0, 1, 0, 0]);
  assert.equal(FAILS_BEFORE_WARNING, 3);
});
