// Publica site + robôs na Cloudflare.
//   node tools/deploy.mjs            → roda os testes e publica
//   node tools/deploy.mjs --secrets  → também (re)envia os segredos (token do Telegram, chave do Firebase)
// As credenciais vêm de segredos/ e passam para o wrangler pela entrada padrão, sem arquivo temporário.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, 'segredos', '.env'), 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const CLOUDFLARE_ACCOUNT_ID = '724c0db21628c7537f3945bec41965c5';
if (!env.CLOUDFLARE_API_TOKEN) throw new Error('Falta CLOUDFLARE_API_TOKEN em segredos/.env');

const run = (args, input) => {
  const r = spawnSync('npx', ['--yes', 'wrangler@4', ...args], {
    cwd: root,
    input,
    stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const tests = spawnSync(process.execPath, ['--test', 'checker/check.test.mjs', 'checker/radar.test.mjs', 'checker/coupons.test.mjs'], { cwd: root, stdio: 'inherit' });
if (tests.status !== 0) {
  console.error('Testes falharam — publicação cancelada.');
  process.exit(1);
}

run(['deploy']);

if (process.argv.includes('--secrets')) {
  const saFile = join(root, 'segredos', 'firebase-servico.json');
  if (!existsSync(saFile)) throw new Error('Falta segredos/firebase-servico.json');
  const secrets = {
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID,
    FIREBASE_SERVICE_ACCOUNT: readFileSync(saFile, 'utf8'),
  };
  run(['secret', 'bulk'], JSON.stringify(secrets));
}
