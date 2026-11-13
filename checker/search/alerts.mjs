// Alertas por busca: "me avise quando qualquer loja tiver <termo> por até R$ X".
// Documento searchAlerts/{id} = { uid, term, targetPrice, createdAt }  ← site
//   + best, checkedAt, alerted { productKey: preço avisado }, lastError ← robô
import { createFirestore, getAccessToken } from '../lib/firestore.mjs';
import { brl, escapeHtml, sendTelegram } from '../lib/telegram.mjs';
import { searchAll } from './multi.mjs';

// Cada alerta faz uma consulta por loja; a Cloudflare grátis permite 50 por execução.
export const MAX_ALERTS_PER_RUN = 5;
const MAX_MESSAGES_PER_ALERT = 3;

const pickBest = (r) => r && { title: r.title, price: r.price, store: r.store, storeName: r.storeName, url: r.url, image: r.image };

// Avisa cada produto relevante abaixo da meta uma vez; de novo só se o preço cair mais.
// Produto que sobe acima da meta sai da lista de avisados (se voltar a cair, avisa outra vez).
export function evaluateSearchAlert(alert, results, now = new Date()) {
  const target = alert.targetPrice;
  const candidates = results.filter((r) => r.relevant && r.available && r.price > 0);
  const best = candidates[0] || null;
  const under = candidates.filter((r) => r.price <= target);
  const prev = alert.alerted || {};
  const alerted = {};
  for (const r of under) if (prev[r.productKey] != null) alerted[r.productKey] = Math.min(prev[r.productKey], r.price);

  const messages = [];
  const termLine = `<b>${escapeHtml(alert.term)}</b> · meta ${brl(target)}`;
  if (!alert.checkedAt) {
    const today = best ? `Hoje o mais barato é ${brl(best.price)} na ${escapeHtml(best.storeName)}:\n${escapeHtml(best.title)}` : 'Nenhuma loja tem esse produto agora.';
    messages.push({ html: `👀 <b>Comecei a acompanhar a busca</b>\n${termLine}\n\n${today}`, url: best?.url });
  }
  for (const r of under) {
    if (messages.length >= MAX_MESSAGES_PER_ALERT) break;
    const before = prev[r.productKey];
    if (before != null && r.price >= before) continue;
    const card = r.priceCard ? ` (${brl(r.priceCard)} no cartão)` : '';
    messages.push({
      html: `🔔 <b>Achei abaixo da sua meta</b>\n${termLine}\n\n<b>${escapeHtml(r.title)}</b>\n${brl(r.price)}${card} na ${escapeHtml(r.storeName)}`,
      url: r.url,
      productKey: r.productKey,
      price: r.price,
    });
  }

  return { update: { best: pickBest(best), underCount: under.length, checkedAt: now, lastError: null }, alerted, messages };
}

export async function runSearchAlerts(config, { dryRun = false, log = console.log } = {}) {
  const db = createFirestore(config.serviceAccount, await getAccessToken(config.serviceAccount));
  const all = await db.list('searchAlerts');
  // Mais de 5: vai em rodízio, primeiro os que estão há mais tempo sem conferir.
  const due = all.sort((a, b) => new Date(a.data.checkedAt || 0) - new Date(b.data.checkedAt || 0)).slice(0, MAX_ALERTS_PER_RUN);
  log(`${all.length} alerta(s) por busca; conferindo ${due.length}${dryRun ? ' — modo simulação' : ''}`);

  for (const { id, data: alert } of due) {
    let result;
    try {
      const { results, errors } = await searchAll(alert.term);
      if (errors.length) log(`   lojas com erro: ${errors.map((e) => e.storeName).join(', ')}`);
      result = evaluateSearchAlert(alert, results);
      log(`✔ "${alert.term}" ≤ ${alert.targetPrice}: ${result.update.underCount} abaixo da meta; melhor ${result.update.best?.price ?? '—'}`);
    } catch (err) {
      console.error(`✖ "${alert.term}": ${err.message}`);
      if (!dryRun) await db.update('searchAlerts', id, { lastError: err.message, checkedAt: new Date() }).catch(() => {});
      continue;
    }

    const alerted = { ...result.alerted };
    for (const m of result.messages) {
      if (dryRun) {
        log(`   [telegram] ${m.html.replace(/\n+/g, ' | ')}`);
        continue;
      }
      try {
        await sendTelegram(config, m.html, m.url ? { button: { text: '🛒 Ver na loja', url: m.url }, previewUrl: m.url } : {});
        // Só conta como avisado o que o Telegram aceitou; o resto é tentado de novo na próxima rodada.
        if (m.productKey) alerted[m.productKey] = m.price;
      } catch (err) {
        console.error(`   Telegram falhou: ${err.message}`);
      }
    }
    if (!dryRun) {
      try {
        await db.update('searchAlerts', id, { ...result.update, alerted });
      } catch (err) {
        console.error(`   Não consegui gravar ${id}: ${err.message}`);
      }
    }
  }
}
