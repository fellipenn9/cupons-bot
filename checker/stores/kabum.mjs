import { fetchHtml, findJsonLdProduct, findObjectWithKey, toNumber } from '../lib/http.mjs';

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
};

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
