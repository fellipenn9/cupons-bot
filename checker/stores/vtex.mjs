import { USER_AGENT } from '../lib/http.mjs';

// Lojas na plataforma VTEX expõem o catálogo público oficial em /api/catalog_system/pub.
// Um leitor só atende todas; cada loja é uma linha em VTEX_STORES.
export const VTEX_STORES = [
  { id: 'americanas', name: 'Americanas', host: 'www.americanas.com.br' },
  { id: 'brastemp', name: 'Brastemp', host: 'www.brastemp.com.br' },
  { id: 'consul', name: 'Consul', host: 'www.consul.com.br' },
  { id: 'electrolux', name: 'Electrolux', host: 'loja.electrolux.com.br' },
  { id: 'lojasmm', name: 'Lojas MM', host: 'www.lojasmm.com' },
  { id: 'copag', name: 'COPAG', host: 'www.copagloja.com.br' },
];

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  // A VTEX responde 206 (conteúdo parcial) em buscas paginadas; é sucesso.
  if (res.status === 403) throw Object.assign(new Error('A loja bloqueou o acesso (403)'), { permanent: true });
  if (!res.ok) throw new Error(`Loja respondeu ${res.status}`);
  return res.json();
}

// Escolhe a melhor oferta entre os vendedores com estoque; Pix vem das condições de pagamento.
export function parseVtexProduct(product) {
  const offers = [];
  for (const item of product.items || []) {
    for (const seller of item.sellers || []) {
      const o = seller.commertialOffer || {};
      if (!(o.AvailableQuantity > 0) || !(o.Price > 0)) continue;
      const pix = (o.Installments || []).find((i) => /pix/i.test(i.PaymentSystemName || '') && i.NumberOfInstallments === 1);
      const cash = pix?.Value > 0 ? Math.min(pix.Value, o.Price) : o.Price;
      offers.push({ item, seller, o, cash });
    }
  }
  const best = offers.sort((a, b) => a.cash - b.cash)[0];
  const image = (best?.item || product.items?.[0])?.images?.[0]?.imageUrl || null;

  if (!best) {
    return { title: product.productName, image, price: null, priceCard: null, listPrice: null, available: false, seller: null };
  }
  return {
    title: product.productName,
    image,
    price: best.cash,
    priceCard: best.o.Price > best.cash ? best.o.Price : null,
    listPrice: best.o.ListPrice > best.o.Price ? best.o.ListPrice : null,
    available: true,
    seller: best.seller.sellerName || null,
  };
}

function createVtexStore({ id, name, host }) {
  const base = `https://${host}`;
  const hostRe = new RegExp(`^(www\\.)?${host.replace(/^www\./, '').replace(/\./g, '\\.')}$`, 'i');

  return {
    id,
    name,
    host,

    productKey(url) {
      let u;
      try {
        u = new URL(url);
      } catch {
        return null;
      }
      if (!hostRe.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/([^/]+)\/p\/?$/);
      return m ? `${id}:${m[1]}` : null;
    },

    async fetchOffer(url) {
      const slug = this.productKey(url).slice(id.length + 1);
      const list = await getJson(`${base}/api/catalog_system/pub/products/search/${encodeURIComponent(slug)}/p`);
      if (!Array.isArray(list) || !list.length) throw Object.assign(new Error('Produto não encontrado na loja'), { permanent: true });
      return parseVtexProduct(list[0]);
    },

    async search(term, limit = 20) {
      const qs = new URLSearchParams({ ft: term, _from: '0', _to: String(limit - 1) });
      const list = await getJson(`${base}/api/catalog_system/pub/products/search?${qs}`);
      return list.map((p) => ({ store: id, url: p.link, productKey: `${id}:${p.linkText}`, ...parseVtexProduct(p) }));
    },
  };
}

export const vtexStores = VTEX_STORES.map(createVtexStore);
