// node --test checker/coupons.test.mjs — frases copiadas dos canais reais (13/11/2026)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { couponsFromPost, detectStoreName, extractCodes, mergeCoupons } from './radar/coupons.mjs';

test('extrai os formatos de cupom usados nos canais', () => {
  assert.deepEqual(extractCodes('Por: R$ 96 no pix 💵\nUse o cupom: TODOSITE1311📌'), ['TODOSITE1311']);
  assert.deepEqual(extractCodes('Cupom: VEMHOJE📌'), ['VEMHOJE']);
  assert.deepEqual(extractCodes('use o cupom:VEMHOJE📌'), ['VEMHOJE']);
  assert.deepEqual(extractCodes('-Cupom TECHSEMPRE'), ['TECHSEMPRE']);
  assert.deepEqual(extractCodes('Acesse https://meli.la/152KhCr e use cupom PROMOSTECH'), ['PROMOSTECH']);
  assert.deepEqual(extractCodes('Resgate o cupom: PROVAR 📌'), ['PROVAR']);
  assert.deepEqual(extractCodes('-Cupom 11DO11X3D'), ['11DO11X3D']);
  assert.deepEqual(extractCodes('-Cupom MELHORDOMELIHJ + Saldo MP'), ['MELHORDOMELIHJ']);
});

test('dois códigos no mesmo post', () => {
  assert.deepEqual(extractCodes('Use o Cupom: PEGAESSA ou TOPACHADO 📌'), ['PEGAESSA', 'TOPACHADO']);
});

test('frases que não são código', () => {
  assert.deepEqual(extractCodes('Cupom Shopee Esportes e lazer'), []);
  assert.deepEqual(extractCodes('🔥 APP - Cupom 25% OFF Mercado Livre'), []);
  assert.deepEqual(extractCodes('🔥 Cupom Mercado Livre pra quem resgatou'), []);
  assert.deepEqual(extractCodes('-Resgate o cupom da sacola na live'), []);
  assert.deepEqual(extractCodes('Ganhe um cupom de R$20 reais na Amazon'), []);
  assert.deepEqual(extractCodes('Novos cupons liberados no Mercado Livre'), []);
  assert.deepEqual(extractCodes('Cupom 15% OFF no Mercado Livre'), []);
});

test('loja pelo link e, sem link conhecido, pelo texto', () => {
  assert.equal(detectStoreName({ links: ['https://meli.la/2wE7D1U'], text: '' }), 'Mercado Livre');
  assert.equal(detectStoreName({ links: ['https://amazn.pro/r/dfrSwh'], text: '' }), 'Amazon');
  assert.equal(detectStoreName({ links: ['https://s.shopee.com.br/5fm9dl0VFr'], text: '' }), 'Shopee');
  assert.equal(detectStoreName({ links: [], text: 'Cupom iFood R$ 20 OFF em Mercados\nCupom: ATACADOBF' }), 'iFood');
  assert.equal(detectStoreName({ links: ['https://tidd.ly/3U1HYTb'], text: 'Monitor gamer' }), 'Outra loja');
});

test('cupom do post leva loja, resumo sem link e o link do post', () => {
  const [c] = couponsFromPost(
    { text: 'Parafusadeira 48v\n\nPor: R$ 96 no pix\nUse o cupom: TODOSITE1311\n\nLoja no ML:\nhttps://meli.la/1p4ySqq', links: ['https://meli.la/1p4ySqq'], url: 'https://t.me/promonocontext/1' },
    'Promo Out Of Context',
  );
  assert.equal(c.code, 'TODOSITE1311');
  assert.equal(c.store, 'Mercado Livre');
  assert.ok(!c.text.includes('http'));
  assert.equal(c.url, 'https://t.me/promonocontext/1');
});

test('aviso de esgotado tira o cupom da lista, mesmo vindo sem link da loja', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const stored = [{ code: 'MAISDESCONTOHOJE', store: 'Mercado Livre', firstSeen: now, lastSeen: now, seenCount: 1 }];
  const fresh = couponsFromPost({ text: '☠️Cupom MAISDESCONTOHOJE esgotado!', links: [], url: 'https://t.me/x/2' }, 'LinksBR');
  assert.equal(fresh[0].expired, true);
  assert.deepEqual(mergeCoupons(stored, fresh, now), []);
});

test('juntar: repetido atualiza "visto por último"; velho some; mais recente primeiro', () => {
  const d = (s) => new Date(s);
  const stored = [
    { code: 'A1B2', store: 'Amazon', firstSeen: d('2026-11-10'), lastSeen: d('2026-11-10'), seenCount: 1 },
    { code: 'VELHO', store: 'Shopee', firstSeen: d('2026-11-01'), lastSeen: d('2026-11-01'), seenCount: 1 },
  ];
  const out = mergeCoupons(stored, [{ code: 'A1B2', store: 'Amazon', text: 't', url: 'u', channel: 'c' }, { code: 'NOVO1', store: 'Shopee', text: 't', url: 'u', channel: 'c' }], d('2026-11-13T12:00:00Z'));
  assert.deepEqual(out.map((c) => c.code).sort(), ['A1B2', 'NOVO1']);
  const a = out.find((c) => c.code === 'A1B2');
  assert.equal(a.seenCount, 2);
  assert.deepEqual(a.firstSeen, d('2026-11-10'));
  assert.deepEqual(a.lastSeen, d('2026-11-13T12:00:00Z'));
});
