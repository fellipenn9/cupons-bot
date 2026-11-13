// Ponto de entrada na Cloudflare.
// - Site: os arquivos de web/ são servidos direto pela Cloudflare (bloco [assets] do wrangler.toml).
// - Agendamentos (crons do wrangler.toml): Radar a cada 2 min, novidades nas lojas a cada 10 min,
//   verificador de preços e alertas por busca a cada 30 min (em minutos diferentes). Cada cron é uma execução separada, com seu próprio limite de requisições.
import { runCheck } from '../checker/run-check.mjs';
import { runRadar } from '../checker/radar/run.mjs';
import { runWatches } from '../checker/watch/run.mjs';
import { searchAll } from '../checker/search/multi.mjs';
import { runSearchAlerts } from '../checker/search/alerts.mjs';
import { verifyOwner } from './auth.mjs';

// Não exportar: no Worker, todo export do arquivo de entrada é tratado como handler e derruba o runtime.
const RADAR_CRON = '*/2 * * * *';
const CHECK_CRON = '5,35 * * * *';
const WATCH_CRON = '1-59/10 * * * *';
const SEARCH_ALERTS_CRON = '15,45 * * * *';

function configFrom(env) {
  return {
    telegramToken: env.TELEGRAM_BOT_TOKEN,
    telegramChatId: env.TELEGRAM_CHAT_ID,
    serviceAccount: JSON.parse(env.FIREBASE_SERVICE_ACCOUNT),
  };
}

export default {
  async scheduled(event, env, ctx) {
    const config = configFrom(env);
    if (event.cron === RADAR_CRON) ctx.waitUntil(runRadar(config));
    else if (event.cron === CHECK_CRON) ctx.waitUntil(runCheck(config));
    else if (event.cron === WATCH_CRON) ctx.waitUntil(runWatches(config));
    else if (event.cron === SEARCH_ALERTS_CRON) ctx.waitUntil(runSearchAlerts(config));
    else console.error(`Cron desconhecido: ${event.cron}`);
  },

  // Só chega aqui o que não é arquivo do site.
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/search') return handleSearch(request, url);
    return new Response('Não encontrado', { status: 404 });
  },
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function handleSearch(request, url) {
  if (!(await verifyOwner(request))) return json({ error: 'Entre com a sua conta para buscar.' }, 401);
  const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim();
  if (q.length < 2 || q.length > 80) return json({ error: 'Digite de 2 a 80 caracteres.' }, 400);
  try {
    return json(await searchAll(q));
  } catch (err) {
    console.error(`Busca "${q}" falhou: ${err.message}`);
    return json({ error: 'A busca falhou. Tente de novo.' }, 502);
  }
}
