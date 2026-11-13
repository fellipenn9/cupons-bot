// Identificação honesta: não nos passamos por navegador. Loja que exigir isso fica de fora.
export const USER_AGENT = 'CacadorDeOfertas/0.1 (monitor pessoal de precos; uso nao comercial)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchHtml(url, { retries = 2, timeoutMs = 25000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, 'accept-language': 'pt-BR,pt;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      // 403/404 não melhoram tentando de novo.
      if (res.status === 403) throw Object.assign(new Error('A loja bloqueou o acesso (403)'), { permanent: true });
      if (res.status === 404) throw Object.assign(new Error('Produto não encontrado (404)'), { permanent: true });
      if (!res.ok) throw new Error(`Loja respondeu ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (err.permanent || attempt === retries) break;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

export function findJsonLdProduct(html) {
  const scripts = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, raw] of scripts) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : data['@graph'] || [data];
    const product = nodes.find((n) => n && (n['@type'] === 'Product' || (Array.isArray(n['@type']) && n['@type'].includes('Product'))));
    if (product) return product;
  }
  return null;
}

// Busca em profundidade o primeiro objeto que tem a chave pedida.
export function findObjectWithKey(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return null;
  if (!Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, key)) return node;
  for (const child of Object.values(node)) {
    const found = findObjectWithKey(child, key, depth + 1);
    if (found) return found;
  }
  return null;
}

export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
