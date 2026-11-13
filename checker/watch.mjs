// Novidades nas lojas rodando no PC.
//   node checker/watch.mjs            → roda de verdade
//   node checker/watch.mjs --dry-run  → mostra o que avisaria, sem enviar nem gravar
import { loadConfig } from './lib/env.mjs';
import { runWatches } from './watch/run.mjs';

runWatches(loadConfig(), { dryRun: process.argv.includes('--dry-run') }).catch((err) => {
  console.error(`Erro geral: ${err.message}`);
  process.exit(1);
});
