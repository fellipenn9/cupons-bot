// Busca o mesmo produto em todas as lojas que têm busca, em paralelo, e ordena pelo menor preço.
// Usada pelo site (worker /api/search) e pelos alertas por busca (run-check.mjs).
import { normalize, parseTerm } from '../radar/match.mjs';
import { STORES } from '../stores/index.mjs';

export const SEARCH_STORES = STORES.filter((s) => typeof s.search === 'function');

const tokenize = (s) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
// "Mochila para Notebook", "Fonte de Notebook": a palavra aparece, mas o produto é outro.
const CONNECTORS = new Set(['para', 'pra', 'p', 'de', 'do', 'da', 'com', 'compativel', 'compatível']);
const sameWord = (t, w) => t === w || (w.length >= 4 && t.startsWith(w));

// "relevant" = o título tem todas as palavras da busca como assunto (não depois de "para/de/com"),
// e nenhuma das -excluídas. O alerta por busca só considera os relevantes.
export function isRelevant(title, term) {
  const { include, exclude } = parseTerm(term);
  if (!include.length) return false;
  const tokens = tokenize(title);
  if (exclude.some((w) => tokens.some((t) => sameWord(t, w)))) return false;
  return include.every((w, i) => {
    // Se a própria busca tem o conector antes da palavra ("placa de video"), não exige.
    const allowConnector = i > 0 && CONNECTORS.has(include[i - 1]);
    return tokens.some((t, j) => sameWord(t, w) && (allowConnector || CONNECTORS.has(w) || !CONNECTORS.has(tokens[j - 1])));
  });
}

export function rankResults(term, results) {
  return results
    .map((r) => ({ ...r, relevant: isRelevant(r.title, term) }))
    .sort((a, b) => Number(b.available) - Number(a.available) || Number(b.relevant) - Number(a.relevant) || (a.price ?? Infinity) - (b.price ?? Infinity));
}

export async function searchAll(term, { perStore = 12, stores = SEARCH_STORES } = {}) {
  const settled = await Promise.allSettled(stores.map((s) => s.search(term, perStore)));
  const results = [];
  const errors = [];
  settled.forEach((r, i) => {
    const store = stores[i];
    if (r.status === 'fulfilled') results.push(...r.value.map((p) => ({ ...p, store: store.id, storeName: store.name })));
    else errors.push({ store: store.id, storeName: store.name, message: r.reason?.message || String(r.reason) });
  });
  return { results: rankResults(term, results), errors };
}
