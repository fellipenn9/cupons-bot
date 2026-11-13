// node --test checker/search.test.mjs — títulos copiados das buscas reais (13/11/2026)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRelevant, rankResults } from './search/multi.mjs';
import { evaluateSearchAlert } from './search/alerts.mjs';
import { parseKabumSearchItem } from './stores/kabum.mjs';

test('relevante: o título é o produto, não um acessório dele', () => {
  assert.equal(isRelevant('Notebook Acer Ryzen 5 De 4,3 Ghz, 8 Gb, SSD De 256 Gb', 'notebook'), true);
  assert.equal(isRelevant('Mochila Executiva para Notebook 17 Clio Style Preta', 'notebook'), false);
  assert.equal(isRelevant('Fonte De Notebook Sony Kp-537a 19v 4.7a', 'notebook'), false);
  assert.equal(isRelevant('Geladeira Consul Frost Free 1 Porta Facilite CRB36AB 300L', 'geladeira frost free'), true);
  assert.equal(isRelevant('Cervejeira Midea 82l Mdrx150 Preta Frost Free 5 Modos', 'geladeira frost free'), false);
});

test('conector que faz parte da busca não derruba ("placa de video")', () => {
  assert.equal(isRelevant('Placa de Vídeo Afox NVIDIA GeForce GTX750, 2GB GDDR5', 'placa de video'), true);
});

test('-palavra exclui', () => {
  assert.equal(isRelevant('Mesa Notebook Escritório Office-Politorno Branco', 'notebook -mesa'), false);
  assert.equal(isRelevant('Notebook Positivo Vision Intel Celeron N4500', 'notebook -mesa'), true);
});

test('ordem: com estoque e relevante primeiro, depois menor preço', () => {
  const r = rankResults('notebook', [
    { title: 'Notebook Caro', price: 5000, available: true },
    { title: 'Mochila para Notebook', price: 100, available: true },
    { title: 'Notebook Barato', price: 2000, available: true },
    { title: 'Notebook Esgotado', price: 10, available: false },
  ]);
  assert.deepEqual(r.map((x) => x.title), ['Notebook Barato', 'Notebook Caro', 'Mochila para Notebook', 'Notebook Esgotado']);
});

test('KaBuM: Pix, cartão e link do produto', () => {
  const p = parseKabumSearchItem({ id: 1007600, attributes: { title: 'Geladeira LG', price: 5498.95, price_with_discount: 5224, old_price: 0, available: true, photos: { g: ['https://img/g.jpg'] } } });
  assert.equal(p.url, 'https://www.kabum.com.br/produto/1007600');
  assert.equal(p.productKey, 'kabum:1007600');
  assert.equal(p.price, 5224);
  assert.equal(p.priceCard, 5498.95);
  assert.equal(p.listPrice, null);
  assert.equal(p.available, true);
});

const res = (key, price, extra = {}) => ({ productKey: key, price, title: key, storeName: 'Loja', url: `https://loja/${key}`, relevant: true, available: true, ...extra });

test('alerta: 1ª conferência confirma e avisa o que já está na meta', () => {
  const out = evaluateSearchAlert({ term: 'geladeira', targetPrice: 2000 }, [res('a', 1800), res('b', 2500)]);
  assert.match(out.messages[0].html, /Comecei a acompanhar/);
  assert.deepEqual(out.messages.slice(1).map((m) => m.productKey), ['a']);
  assert.equal(out.update.best.price, 1800);
});

test('alerta: não repete; avisa de novo só se cair mais; quem sobe sai da lista', () => {
  const alert = { term: 'g', targetPrice: 2000, checkedAt: new Date(), alerted: { a: 1800, b: 1900 } };
  const out = evaluateSearchAlert(alert, [res('a', 1800), res('b', 1700), res('c', 2100)]);
  assert.deepEqual(out.messages.map((m) => m.productKey), ['b']);
  const out2 = evaluateSearchAlert({ ...alert, alerted: { a: 1800 } }, [res('a', 2100)]);
  assert.deepEqual(out2.alerted, {});
  assert.deepEqual(out2.messages, []);
});

test('alerta: acessório e sem estoque não contam', () => {
  const out = evaluateSearchAlert({ term: 'g', targetPrice: 2000, checkedAt: new Date() }, [res('x', 10, { relevant: false }), res('y', 20, { available: false })]);
  assert.deepEqual(out.messages, []);
  assert.equal(out.update.best, null);
});
