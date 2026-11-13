// Testa a leitura de um link sem mexer no banco: node checker/try-url.mjs <link do produto>
import { detectStore } from './stores/index.mjs';

const url = process.argv[2];
if (!url) {
  console.error('Uso: node checker/try-url.mjs <link do produto>');
  process.exit(1);
}
const store = detectStore(url);
if (!store) {
  console.error('Loja ainda não suportada para esse link.');
  process.exit(1);
}
try {
  console.log(store.productKey(url), await store.fetchOffer(url));
} catch (err) {
  console.error(`Falhou: ${err.message}`);
  process.exit(1);
}
