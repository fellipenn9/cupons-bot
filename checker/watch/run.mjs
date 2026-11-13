// Novidades nas lojas: avisa quando aparece produto novo numa busca da loja (ex.: COPAG + "pokemon")
// ou quando um produto esgotado volta ao estoque. Usa a busca do catálogo público VTEX.
//
// Configuração (editada pelo site): settings/watches = { items: [{ store, term }] }
// Estado (só o robô grava):          watchState/main = { known: { "loja|termo": { productKey: { available, price } } } }
import { createFirestore, getAccessToken } from '../lib/firestore.mjs';
import { brl, escapeHtml, sendTelegram } from '../lib/telegram.mjs';
import { vtexStores } from '../stores/vtex.mjs';

const SEARCH_LIMIT = 50;
const KNOWN_MAX = 300;
const MAX_SENDS_PER_RUN = 10;

export const watchKey = (w) => `${w.store}|${w.term.trim().toLowerCase()}`;

// Compara a busca de agora com o que já se conhecia.
// Produto que some da busca continua guardado: se voltar, não conta como novidade.
export function diffWatch(known, products) {
  const next = { ...(known || {}) };
  const events = [];
  for (const p of products) {
    const prev = next[p.productKey];
    if (known && !prev) events.push({ type: 'new', product: p });
    else if (prev && !prev.available && p.available) events.push({ type: 'back', product: p });
    next[p.productKey] = { available: p.available, price: p.price };
  }
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - KNOWN_MAX))) delete next[k];
  return { next, events, firstRun: !known };
}

export function formatWatchMessage(event, storeName, term) {
  const p = event.product;
  const head = event.type === 'new' ? `🆕 <b>Novidade na ${escapeHtml(storeName)}</b>` : `🔁 <b>Voltou ao estoque na ${escapeHtml(storeName)}</b>`;
  const price = p.available
    ? `${brl(p.price)}${p.priceCard ? ` no Pix · ${brl(p.priceCard)} no cartão` : ''}`
    : 'Ainda sem estoque (pode ser pré-venda ou lançamento)';
  return `${head} · ${escapeHtml(term)}\n\n<b>${escapeHtml(p.title)}</b>\n${price}`;
}

export async function runWatches(config, { dryRun = false, log = console.log } = {}) {
  const db = createFirestore(config.serviceAccount, await getAccessToken(config.serviceAccount));
  const items = (await db.get('settings', 'watches'))?.items || [];
  if (!items.length) {
    log('Novidades: nenhuma busca configurada.');
    return { sent: 0 };
  }

  const known = { ...((await db.get('watchState', 'main'))?.known || {}) };
  let sent = 0;
  let changed = false;

  for (const w of items) {
    const store = vtexStores.find((s) => s.id === w.store);
    if (!store) {
      console.error(`✖ Loja desconhecida em settings/watches: ${w.store}`);
      continue;
    }
    const key = watchKey(w);
    let products;
    try {
      products = await store.search(w.term, SEARCH_LIMIT);
    } catch (err) {
      console.error(`✖ ${store.name} "${w.term}": ${err.message}`);
      continue;
    }
    // Busca vazia costuma ser instabilidade da loja; não apaga o que se conhecia.
    if (!products.length) {
      log(`• ${store.name} "${w.term}": busca vazia, mantendo o estado`);
      continue;
    }

    const { next, events, firstRun } = diffWatch(known[key], products);
    known[key] = next;
    changed = true;

    if (firstRun) {
      const msg = `👀 <b>Comecei a acompanhar ${escapeHtml(store.name)}</b> · ${escapeHtml(w.term)}\n\n${products.length} produto(s) hoje. Aviso quando surgir um novo ou quando um esgotado voltar.`;
      if (dryRun) log(`   [telegram] ${msg.replace(/\n+/g, ' | ')}`);
      else await sendTelegram(config, msg).catch((err) => console.error(`   Telegram falhou: ${err.message}`));
    }

    for (const ev of events) {
      if (sent >= MAX_SENDS_PER_RUN) break;
      const msg = formatWatchMessage(ev, store.name, w.term);
      if (dryRun) {
        log(`   [telegram] ${msg.replace(/\n+/g, ' | ')}`);
      } else {
        try {
          await sendTelegram(config, msg, { button: { text: '🛒 Ver na loja', url: ev.product.url }, previewUrl: ev.product.url });
        } catch (err) {
          console.error(`   Telegram falhou: ${err.message}`);
          continue;
        }
      }
      sent++;
    }
    log(`• ${store.name} "${w.term}": ${products.length} produto(s), ${events.length} novidade(s)${firstRun ? ' (primeira leitura)' : ''}`);
  }

  if (changed && !dryRun) await db.set('watchState', 'main', { known, updatedAt: new Date() });
  log(`Novidades concluído: ${sent} aviso(s).`);
  return { sent };
}
