import { USER_AGENT, fetchHtml, findJsonLdProduct, findObjectWithKey, toNumber } from '../lib/http.mjs';

// Busca: a mesma API pública de catálogo que o site da KaBuM usa na página de busca.
const SEARCH_API = 'https://servicespub.prod.api.aws.grupokabum.com.br/catalog/v2/products';

const PRODUCT_RE = /kabum\.com\.br\/produto\/(\d+)/i;

export const kabum = {
  id: 'kabum',
  name: 'KaBuM!',

  productKey(url) {
    const m = String(url).match(PRODUCT_RE);
    return m ? `kabum:${m[1]}` : null;
  },

  async fetchOffer(url) {
    const id = this.productKey(url)?.split(':')[1];
    // URL canônica: o slug do produto muda às vezes, o número não.
    return parseKabum(await fetchHtml(`https://www.kabum.com.br/produto/${id}`));
  },

  async search(term, limit = 20) {
    const qs = new URLSearchParams({ query: term, page_size: String(limit) });
    const res = await fetch(`${SEARCH_API}?${qs}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`KaBuM respondeu ${res.status}`);
    return ((await res.json()).data || []).map(parseKabumSearchItem);
  },
};

export function parseKabumSearchItem(item) {
  const a = item.attributes || {};
  const card = toNumber(a.offer?.price) ?? toNumber(a.price);
  const cash = toNumber(a.offer?.price_with_discount) ?? toNumber(a.price_with_discount) ?? card;
  const old = toNumber(a.old_price);
  return {
    store: 'kabum',
    url: `https://www.kabum.com.br/produto/${item.id}`,
    productKey: `kabum:${item.id}`,
    title: a.title || null,
    image: a.photos?.g?.[0] || a.photos?.p?.[0] || null,
    price: cash,
    priceCard: card > cash ? card : null,
    listPrice: old > (card ?? 0) ? old : null,
    available: Boolean(a.available) && cash > 0,
    seller: a.marketplace?.seller_name || null,
  };
}

export function parseKabum(html) {
  const ld = findJsonLdProduct(html);
  const offer = ld && (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers);

  // __NEXT_DATA__ traz o detalhamento: priceWithDiscount = à vista (Pix), price = cartão, oldPrice = "de".
  let detail = null;
  const next = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (next) {
    try {
      detail = findObjectWithKey(JSON.parse(next[1]), 'priceWithDiscount');
    } catch {
      detail = null;
    }
  }

  const price = toNumber(detail?.priceWithDiscount) ?? toNumber(offer?.price);
  if (price == null) throw new Error('Não encontrei o preço na página do KaBuM');

  const image = Array.isArray(ld?.image) ? ld.image[0] : ld?.image;
  const availability = String(offer?.availability || '');

  return {
    title: ld?.name || null,
    image: typeof image === 'string' ? image : null,
    price,
    priceCard: toNumber(detail?.price),
    listPrice: toNumber(detail?.oldPrice),
    available: availability ? /InStock/i.test(availability) : true,
  };
}
