// Alertas por busca rodando no PC.
//   node checker/search-alerts.mjs            → roda de verdade
//   node checker/search-alerts.mjs --dry-run  → mostra o que avisaria, sem enviar nem gravar
import { loadConfig } from './lib/env.mjs';
import { runSearchAlerts } from './search/alerts.mjs';

runSearchAlerts(loadConfig(), { dryRun: process.argv.includes('--dry-run') }).catch((err) => {
  console.error(`Erro geral: ${err.message}`);
  process.exit(1);
});
