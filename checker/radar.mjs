// Radar rodando no PC.
//   node checker/radar.mjs                  → roda de verdade
//   node checker/radar.mjs --dry-run        → mostra o que repassaria, sem enviar nem gravar
//   node checker/radar.mjs --dry-run --all  → prévia sobre os ~20 últimos posts de cada canal
import { loadConfig } from './lib/env.mjs';
import { runRadar } from './radar/run.mjs';

runRadar(loadConfig(), { dryRun: process.argv.includes('--dry-run'), previewAll: process.argv.includes('--all') }).catch((err) => {
  console.error(`Erro geral: ${err.message}`);
  process.exit(1);
});
