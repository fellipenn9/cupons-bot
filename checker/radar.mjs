// Radar: lê canais públicos de ofertas no Telegram e repassa os posts que batem com os seus termos.
//
// Configuração (editada pelo site): settings/radar = { uid, terms: [..], channels: [..] }
// Estado (só o radar grava):        radarState/main = { lastIds: { canal: id }, recent: [..] }
//
// Uso:
//   node checker/radar.mjs            → roda de verdade
//   node checker/radar.mjs --dry-run  → mostra o que repassaria, sem enviar nem gravar
import { pathToFileURL } from 'node:url';
import { loadConfig } from './lib/env.mjs';
import { createFirestore, getAccessToken } from './lib/firestore.mjs';
import { escapeHtml, sendTelegram } from './lib/telegram.mjs';
import { fetchChannel } from './radar/channel.mjs';
import { fingerprint, matchTerms, parseTerm } from './radar/match.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
// Com --dry-run --all, avalia os ~20 posts visíveis de cada canal (prévia do que o radar pegaria).
const PREVIEW_ALL = DRY_RUN && process.argv.includes('--all');
const MAX_SENDS_PER_RUN = 25;
const RECENT_MAX = 400;
const TEXT_MAX = 900;

export function formatRadarMessage(post, channelTitle, matched) {
  let text = post.text;
  if (text.length > TEXT_MAX) text = `${text.slice(0, TEXT_MAX).trimEnd()}…`;
  return `🎯 <b>Radar: ${escapeHtml(matched.join(', '))}</b> · ${escapeHtml(channelTitle)}\n\n${escapeHtml(text)}`;
}

async function main() {
  const config = loadConfig();
  const db = createFirestore(config.serviceAccount, await getAccessToken(config.serviceAccount));

  const settings = await db.get('settings', 'radar');
  const terms = (settings?.terms || []).map(parseTerm).filter((t) => t.include.length);
  const channels = settings?.channels || [];
  if (!terms.length || !channels.length) {
    console.log('Radar sem termos ou sem canais configurados — nada a fazer.');
    return;
  }

  const state = (await db.get('radarState', 'main')) || {};
  const lastIds = { ...(state.lastIds || {}) };
  const recent = [...(state.recent || [])];
  let sent = 0;

  for (const channel of channels) {
    let page;
    try {
      page = await fetchChannel(channel);
    } catch (err) {
      console.error(`✖ ${channel}: ${err.message}`);
      continue;
    }
    const newestId = page.posts.at(-1)?.id;
    const last = PREVIEW_ALL ? 0 : lastIds[channel];

    // Canal novo na lista: só marca onde parou, para não despejar os posts antigos.
    if (last == null) {
      if (newestId) lastIds[channel] = newestId;
      console.log(`• ${channel}: começando a acompanhar a partir do post ${newestId}`);
      continue;
    }

    const fresh = page.posts.filter((p) => p.id > last);
    let matchedCount = 0;
    for (const post of fresh) {
      const matched = matchTerms(post.text, terms);
      if (!matched.length) continue;
      const fp = fingerprint(post);
      if (recent.includes(fp)) continue;
      if (sent >= MAX_SENDS_PER_RUN) break;
      matchedCount++;

      const message = formatRadarMessage(post, page.title, matched);
      if (DRY_RUN) {
        console.log(`   [telegram] ${message.replace(/\n+/g, ' | ').slice(0, 220)}`);
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
      lastIds[channel] = post.id;
    }
    if (newestId && sent < MAX_SENDS_PER_RUN) lastIds[channel] = Math.max(newestId, lastIds[channel]);
    console.log(`• ${channel}: ${fresh.length} post(s) novo(s), ${matchedCount} repassado(s)`);
  }

  if (!DRY_RUN) {
    await db.set('radarState', 'main', { lastIds, recent: recent.slice(-RECENT_MAX), updatedAt: new Date() });
  }
  console.log(`Radar concluído: ${sent} aviso(s).`);
}

// Só roda quando chamado direto (os testes importam formatRadarMessage sem disparar o radar).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Erro geral: ${err.message}`);
    process.exit(1);
  });
}
