// Extrai códigos de cupom e a loja dos posts dos canais.
// Padrões vistos nos canais: "Cupom: VEMHOJE", "use o cupom TODOSITE1311", "-Cupom TECHSEMPRE",
// "Use o Cupom: PEGAESSA ou TOPACHADO". Código = MAIÚSCULAS/dígitos logo depois de "cupom".
// "Cupom Shopee", "Cupom 25% OFF", "cupom da sacola" não são códigos.

const CODE = '([A-Z0-9][A-Z0-9_-]{3,24})';
const AFTER_WORD = new RegExp(`^\\s*(?:de\\s+desconto\\s*)?[:\\-–]?\\s*${CODE}(?![\\p{L}\\d])(?:\\s+(?:ou|e|/)\\s+${CODE}(?![\\p{L}\\d]))?`, 'u');
const NOT_CODES = new Set(['AMAZON', 'SHOPEE', 'MAGALU', 'IFOOD', 'KABUM', 'PRIME', 'FRETE', 'GRATIS', 'LINK', 'AQUI', 'LOJA', 'SITE', 'VALIDO', 'BLACK', 'FRIDAY', 'NOVO', 'NOVOS']);

export function extractCodes(text) {
  const codes = new Set();
  for (const m of String(text).matchAll(/cupo(?:m|ns)\b/gi)) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const found = after.match(AFTER_WORD);
    if (!found) continue;
    for (const code of [found[1], found[2]]) {
      if (code && /[A-Z]/.test(code) && !NOT_CODES.has(code)) codes.add(code);
    }
  }
  return [...codes];
}

const STORE_BY_LINK = [
  ['Mercado Livre', /meli\.la|mercadoli(vre|bre)\.com/i],
  ['Amazon', /amzn\.|amazn\.|amazon\.com|link\.amazon/i],
  ['Shopee', /shopee\./i],
  ['Magalu', /magalu|magazineluiza|magazinevoce/i],
  ['AliExpress', /aliexpress/i],
  ['KaBuM!', /kabum\./i],
];
const STORE_BY_TEXT = [
  ['Mercado Livre', /mercado\s*livre|\bmeli\b/i],
  ['Amazon', /amazon/i],
  ['Shopee', /shopee/i],
  ['Magalu', /magalu|magazine\s*luiza/i],
  ['AliExpress', /aliexpress/i],
  ['KaBuM!', /kabum/i],
  ['iFood', /ifood/i],
  ['Americanas', /americanas/i],
  ['Casas Bahia', /casas\s*bahia/i],
  ['Netshoes', /netshoes/i],
];

export function detectStoreName(post) {
  for (const link of post.links || []) {
    const hit = STORE_BY_LINK.find(([, re]) => re.test(link));
    if (hit) return hit[0];
  }
  return STORE_BY_TEXT.find(([, re]) => re.test(post.text))?.[0] || 'Outra loja';
}

// Resumo do post para a aba Cupons: primeiras linhas com conteúdo, sem links.
export function summarize(text, max = 280) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.replace(/https?:\/\/\S+/g, '').trim())
    .filter((l) => l.length > 1);
  const out = lines.join(' · ');
  return out.length > max ? `${out.slice(0, max).trimEnd()}…` : out;
}

// "Cupom X esgotado!" — o canal avisando que acabou: o cupom sai da lista em vez de entrar.
// "acabou" fica de fora: aparece em "acabou de baixar o preço".
const EXPIRED_RE = /esgotad|encerrad|expirad/i;

export function couponsFromPost(post, channelTitle) {
  const store = detectStoreName(post);
  const expired = EXPIRED_RE.test(post.text);
  return extractCodes(post.text).map((code) => ({
    code,
    store,
    text: summarize(post.text),
    url: post.url,
    channel: channelTitle,
    ...(expired && { expired: true }),
  }));
}

// Junta cupons novos à lista guardada: mesmo código + loja só atualiza "visto por último".
export const COUPON_TTL_DAYS = 7;
export function mergeCoupons(stored, fresh, now = new Date(), max = 400) {
  const byKey = new Map(stored.map((c) => [`${c.store}|${c.code}`, c]));
  const expiredCodes = new Set(fresh.filter((c) => c.expired).map((c) => c.code));
  for (const c of fresh) {
    const key = `${c.store}|${c.code}`;
    if (expiredCodes.has(c.code)) continue;
    const prev = byKey.get(key);
    // O mesmo post relido (rodada retomada) não conta como nova aparição.
    const seenCount = prev ? (prev.seenCount || 1) + (prev.url === c.url ? 0 : 1) : 1;
    byKey.set(key, prev ? { ...prev, text: c.text, url: c.url, channel: c.channel, lastSeen: now, seenCount } : { ...c, firstSeen: now, lastSeen: now, seenCount });
  }
  const cutoff = now.getTime() - COUPON_TTL_DAYS * 24 * 60 * 60 * 1000;
  return [...byKey.values()]
    // Esgotado sai em qualquer loja: o aviso de esgotado às vezes vem sem o link da loja.
    .filter((c) => !expiredCodes.has(c.code))
    .filter((c) => new Date(c.lastSeen).getTime() >= cutoff)
    .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
    .slice(0, max);
}
