// Motor do Radar: lê canais públicos de ofertas no Telegram e repassa os posts que batem com os termos.
// Roda no PC (checker/radar.mjs) e na Cloudflare (worker/index.mjs).
//
// Configuração (editada pelo site): settings/radar = { terms: [..], channels: [..] }
// Estado (só o radar grava):        radarState/main = { lastIds: { canal: id }, recent: [..] }
import { createFirestore, getAccessToken } from '../lib/firestore.mjs';
import { escapeHtml, sendTelegram } from '../lib/telegram.mjs';
import { fetchChannel, fetchChannelSince } from './channel.mjs';
import { fingerprint, matchTerms, parseTerm } from './match.mjs';

// Rodando a cada 2 min, o limite raramente é atingido; ele protege o limite de 50 requisições por execução da Cloudflare.
const MAX_SENDS_PER_RUN = 12;
const RECENT_MAX = 400;
const TEXT_MAX = 900;

export function formatRadarMessage(post, channelTitle, matched) {
  let text = post.text;
  if (text.length > TEXT_MAX) text = `${text.slice(0, TEXT_MAX).trimEnd()}…`;
  return `🎯 <b>Radar: ${escapeHtml(matched.join(', '))}</b> · ${escapeHtml(channelTitle)}\n\n${escapeHtml(text)}`;
}

// previewAll (só com dryRun): avalia os ~20 posts visíveis de cada canal, para prévia.
export async function runRadar(config, { dryRun = false, previewAll = false, log = console.log } = {}) {
  const db = createFirestore(config.serviceAccount, await getAccessToken(config.serviceAccount));

  const settings = await db.get('settings', 'radar');
  const terms = (settings?.terms || []).map(parseTerm).filter((t) => t.include.length);
  const channels = settings?.channels || [];
  if (!terms.length || !channels.length) {
    log('Radar sem termos ou sem canais configurados — nada a fazer.');
    return { sent: 0 };
  }

  const state = (await db.get('radarState', 'main')) || {};
  const lastIds = { ...(state.lastIds || {}) };
  const recent = [...(state.recent || [])];
  let sent = 0;

  for (const channel of channels) {
    const last = dryRun && previewAll ? 0 : lastIds[channel];
    let page;
    try {
      page = last ? await fetchChannelSince(channel, last) : await fetchChannel(channel);
    } catch (err) {
      console.error(`✖ ${channel}: ${err.message}`);
      continue;
    }
    const newestId = page.posts.at(-1)?.id;

    // Canal novo na lista: só marca onde parou, para não despejar os posts antigos.
    if (last == null) {
      if (newestId) lastIds[channel] = newestId;
      log(`• ${channel}: começando a acompanhar a partir do post ${newestId}`);
      continue;
    }

    const fresh = page.posts.filter((p) => p.id > last);
    let matchedCount = 0;
    let stoppedAt = null;
    for (const post of fresh) {
      const matched = matchTerms(post.text, terms);
      if (!matched.length) continue;
      const fp = fingerprint(post);
      if (recent.includes(fp)) continue;
      if (sent >= MAX_SENDS_PER_RUN) {
        stoppedAt = post.id;
        break;
      }
      matchedCount++;

      const message = formatRadarMessage(post, page.title, matched);
      if (dryRun) {
        log(`   [telegram] ${message.replace(/\n+/g, ' | ').slice(0, 220)}`);
      } else {
        try {
          await sendTelegram(config, message, {
            button: { text: '▶️ Abrir publicação no canal', url: post.url },
            previewUrl: post.links[0] || post.url,
          });
        } catch (err) {
          console.error(`   Telegram falhou: ${err.message}`);
          continue;
        }
      }
      recent.push(fp);
      sent++;
    }
    // Se parou no limite, retoma do post que ficou de fora na próxima rodada.
    if (newestId) lastIds[channel] = stoppedAt != null ? stoppedAt - 1 : Math.max(newestId, last);
    log(`• ${channel}: ${fresh.length} post(s) novo(s), ${matchedCount} repassado(s)`);
  }

  if (!dryRun) {
    await db.set('radarState', 'main', { lastIds, recent: recent.slice(-RECENT_MAX), updatedAt: new Date() });
  }
  log(`Radar concluído: ${sent} aviso(s).`);
  return { sent };
}
