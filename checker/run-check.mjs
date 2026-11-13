// Motor do verificador de preços: lê os favoritos, consulta cada loja, grava preço/histórico e avisa.
// Roda no PC (checker/check.mjs) e na Cloudflare (worker/index.mjs).
import { createFirestore, getAccessToken } from './lib/firestore.mjs';
import { evaluateFailure, evaluateOffer } from './lib/evaluate.mjs';
import { sendTelegram } from './lib/telegram.mjs';
import { detectStore } from './stores/index.mjs';

const PAUSE_BETWEEN_PRODUCTS_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runCheck(config, { dryRun = false, log = console.log } = {}) {
  const db = createFirestore(config.serviceAccount, await getAccessToken(config.serviceAccount));
  const favorites = await db.list('favorites');
  log(`${favorites.length} favorito(s)${dryRun ? ' — modo simulação' : ''}`);

  let ok = 0;
  let failed = 0;
  for (const [i, { id, data: fav }] of favorites.entries()) {
    if (i > 0) await sleep(PAUSE_BETWEEN_PRODUCTS_MS);
    const store = detectStore(fav.url);

    let result;
    if (!store) {
      result = { update: { lastError: 'Loja ainda não suportada', lastErrorAt: new Date() }, messages: [] };
      failed++;
    } else {
      try {
        const offer = await store.fetchOffer(fav.url);
        result = evaluateOffer(fav, offer);
        ok++;
        log(`✔ [${store.id}] ${offer.title?.slice(0, 50)} → ${offer.available ? `R$ ${offer.price}` : 'sem estoque'}`);
      } catch (err) {
        result = evaluateFailure(fav, err);
        failed++;
        console.error(`✖ [${store.id}] ${fav.url} → ${err.message}`);
      }
    }

    if (dryRun) {
      for (const m of result.messages) log(`   [telegram] ${m.replace(/\n/g, ' | ')}`);
      continue;
    }
    // Avisa antes de gravar: se o Telegram falhar, alertedPrice não é gravado e o aviso é refeito na próxima rodada.
    try {
      for (const m of result.messages) await sendTelegram(config, m);
    } catch (err) {
      console.error(`   Telegram falhou: ${err.message}`);
      delete result.update.alertedPrice;
      delete result.update.alertTarget;
    }
    try {
      await db.update('favorites', id, result.update);
    } catch (err) {
      console.error(`   Não consegui gravar ${id}: ${err.message}`);
    }
  }

  log(`Concluído: ${ok} ok, ${failed} com falha.`);
  return { ok, failed };
}
