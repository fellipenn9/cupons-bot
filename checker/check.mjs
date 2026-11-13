// Verificador de preços rodando no PC.
//   node checker/check.mjs            → roda de verdade
//   node checker/check.mjs --dry-run  → só mostra o que faria (não grava nem avisa)
import { loadConfig } from './lib/env.mjs';
import { runCheck } from './run-check.mjs';

runCheck(loadConfig(), { dryRun: process.argv.includes('--dry-run') }).catch((err) => {
  console.error(`Erro geral: ${err.message}`);
  process.exit(1);
});
