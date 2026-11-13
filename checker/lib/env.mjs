import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Na nuvem (GitHub Actions) as credenciais vêm de variáveis de ambiente (Secrets).
// Rodando no PC, caem para os arquivos da pasta segredos/, que nunca vai para o Git.
const SECRETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'segredos');

function readDotEnv() {
  const file = join(SECRETS_DIR, '.env');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function loadConfig() {
  const local = readDotEnv();
  const pick = (key) => (process.env[key] || local[key] || '').trim();

  let serviceAccountJson = pick('FIREBASE_SERVICE_ACCOUNT');
  const saFile = join(SECRETS_DIR, 'firebase-servico.json');
  if (!serviceAccountJson && existsSync(saFile)) serviceAccountJson = readFileSync(saFile, 'utf8');

  const config = {
    telegramToken: pick('TELEGRAM_BOT_TOKEN'),
    telegramChatId: pick('TELEGRAM_CHAT_ID'),
    serviceAccount: serviceAccountJson ? JSON.parse(serviceAccountJson) : null,
  };

  const missing = [];
  if (!config.telegramToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (!config.telegramChatId) missing.push('TELEGRAM_CHAT_ID');
  if (!config.serviceAccount) missing.push('FIREBASE_SERVICE_ACCOUNT');
  if (missing.length) throw new Error(`Credenciais ausentes: ${missing.join(', ')}`);
  return config;
}
