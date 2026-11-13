import { brl, escapeHtml } from './telegram.mjs';

export const HISTORY_MAX = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
export const FAILS_BEFORE_WARNING = 3;

// Decide o que gravar e o que avisar a partir de uma leitura de preço bem-sucedida.
// Função pura: não acessa rede nem banco, para poder ser testada.
export function evaluateOffer(fav, offer, now = new Date()) {
  const title = offer.title || fav.title || 'Produto';
  const link = `<a href="${escapeHtml(fav.url)}">${escapeHtml(title)}</a>`;

  // Sem estoque o preço exibido não é comprável: não entra no histórico, no menor preço nem no alerta.
  if (!offer.available || offer.price == null) return evaluateUnavailable(fav, offer, link, now);

  const messages = [];
  const price = offer.price;

  // Histórico: um ponto quando o preço muda, ou um por dia se ficar parado.
  const history = Array.isArray(fav.history) ? [...fav.history] : [];
  const last = history[history.length - 1];
  if (!last || last.p !== price || now - new Date(last.t) >= DAY_MS) history.push({ t: now, p: price });

  const isNewLow = fav.lowestPrice == null || price < fav.lowestPrice;

  // Alerta de meta: avisa ao atingir a meta e de novo se cair ainda mais.
  // Se o preço volta a subir acima da meta, ou a meta é alterada, o ciclo recomeça.
  const target = fav.targetPrice;
  const alertStillValid = fav.alertedPrice != null && fav.alertTarget === target;
  let alertedPrice = alertStillValid ? fav.alertedPrice : null;
  const reachedTarget = target != null && price <= target;

  if (reachedTarget && (alertedPrice == null || price < alertedPrice)) {
    const extra = alertedPrice != null ? `Caiu de novo: era ${brl(alertedPrice)}.` : `Sua meta era ${brl(target)}.`;
    messages.push(
      `🎯 <b>Chegou no seu preço!</b>\n${link}\n\n<b>${brl(price)}</b> à vista` +
        (offer.priceCard ? ` · ${brl(offer.priceCard)} no cartão` : '') +
        `\n${extra}` +
        (isNewLow && fav.lowestPrice != null ? '\n📉 Menor preço desde que comecei a acompanhar.' : ''),
    );
    alertedPrice = price;
  } else if (!reachedTarget) {
    alertedPrice = null;
  }

  // Primeira leitura: confirma que o monitoramento começou (exceto se já mandou o alerta de meta).
  if (!fav.lastCheckedAt && !messages.length) {
    const gap = target != null ? price - target : null;
    messages.push(
      `👀 <b>Comecei a acompanhar</b>\n${link}\n\nAgora: <b>${brl(price)}</b> à vista` +
        (offer.listPrice ? ` (de ${brl(offer.listPrice)})` : '') +
        (gap != null ? `\nSua meta: ${brl(target)} — faltam ${brl(gap)}.` : ''),
    );
  }

  if (fav.available === false && offer.available && fav.lastCheckedAt) {
    messages.push(`📦 <b>Voltou ao estoque</b>\n${link}\n${brl(price)} à vista`);
  }

  const update = {
    title,
    image: offer.image || fav.image || null,
    price,
    priceCard: offer.priceCard ?? null,
    listPrice: offer.listPrice ?? null,
    available: offer.available,
    lowestPrice: isNewLow ? price : fav.lowestPrice,
    lowestAt: isNewLow ? now : fav.lowestAt ?? now,
    history: history.slice(-HISTORY_MAX),
    lastCheckedAt: now,
    lastError: null,
    failCount: 0,
    alertedPrice,
    alertTarget: alertedPrice != null ? target : null,
  };
  return { update, messages };
}

function evaluateUnavailable(fav, offer, link, now) {
  const messages = [];
  if (!fav.lastCheckedAt) messages.push(`👀 <b>Comecei a acompanhar</b>\n${link}\n\n⚠️ Está sem estoque agora — aviso quando voltar.`);
  return {
    messages,
    update: {
      title: offer.title || fav.title || null,
      image: offer.image || fav.image || null,
      available: false,
      lastCheckedAt: now,
      lastError: null,
      failCount: 0,
    },
  };
}

export function evaluateFailure(fav, error, now = new Date()) {
  const failCount = (fav.failCount || 0) + 1;
  const messages = [];
  if (failCount === FAILS_BEFORE_WARNING) {
    messages.push(
      `⚠️ <b>Não estou conseguindo ler o preço</b>\n<a href="${escapeHtml(fav.url)}">${escapeHtml(fav.title || fav.url)}</a>\n` +
        `${FAILS_BEFORE_WARNING} tentativas seguidas falharam: ${escapeHtml(error.message)}`,
    );
  }
  return { update: { lastError: error.message, lastErrorAt: now, failCount }, messages };
}
