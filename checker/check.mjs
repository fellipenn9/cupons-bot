// Verificador de preços: lê os favoritos no Firestore, consulta cada loja,
// grava preço/histórico e avisa no Telegram.
//
// Uso:
//   node checker/check.mjs            → roda de verdade
//   node checker/check.mjs --dry-run  → só mostra o que faria (não grava nem avisa)
import { loadConfig } from './lib/env.mjs';
import { createFirestore, getAccessToken } from './lib/firestore.mjs';
import { evaluateFailure, evaluateOffer } from './lib/evaluate.mjs';
import { sendTelegram } from './lib/telegram.mjs';
import { detectStore } from './stores/index.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const PAUSE_BETWEEN_PRODUCTS_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const config = loadConfig();
  const db = createFirestore(config.serviceAccount, await getAccessToken(config.serviceAccount));
  const favorites = await db.list('favorites');
  console.log(`${favorites.length} favorito(s)${DRY_RUN ? ' — modo simulação' : ''}`);

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
        console.log(`✔ [${store.id}] ${offer.title?.slice(0, 50)} → R$ ${offer.price}`);
      } catch (err) {
        result = evaluateFailure(fav, err);
        failed++;
        console.error(`✖ [${store.id}] ${fav.url} → ${err.message}`);
      }
    }

    if (DRY_RUN) {
      for (const m of result.messages) console.log(`   [telegram] ${m.replace(/\n/g, ' | ')}`);
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

  console.log(`Concluído: ${ok} ok, ${failed} com falha.`);
  // Falhas de loja são esperadas e vão para o lastError do favorito; só erro geral derruba o job.
}

main().catch((err) => {
  console.error(`Erro geral: ${err.message}`);
  process.exit(1);
});
