// Ponto de entrada na Cloudflare.
// - Site: os arquivos de web/ são servidos direto pela Cloudflare (bloco [assets] do wrangler.toml).
// - Agendamentos (crons do wrangler.toml): Radar a cada 15 min, verificador de preços a cada 2 h.
import { runCheck } from '../checker/run-check.mjs';
import { runRadar } from '../checker/radar/run.mjs';

export const RADAR_CRON = '*/15 * * * *';
export const CHECK_CRON = '17 */2 * * *';

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
    else console.error(`Cron desconhecido: ${event.cron}`);
  },

  // Só chega aqui o que não é arquivo do site.
  async fetch() {
    return new Response('Não encontrado', { status: 404 });
  },
};
