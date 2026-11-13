import { kabum } from './kabum.mjs';
import { vtexStores } from './vtex.mjs';

// Lojas com leitor pronto. Para adicionar uma loja: criar o leitor e registrar aqui
// (e na lista STORES de web/app.js, para o site aceitar o link).
// Loja VTEX nova: basta uma linha em VTEX_STORES (vtex.mjs).
export const STORES = [kabum, ...vtexStores];

export function detectStore(url) {
  return STORES.find((s) => s.productKey(url)) || null;
}
