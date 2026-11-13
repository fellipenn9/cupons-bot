import { kabum } from './kabum.mjs';

// Lojas com leitor pronto. Para adicionar uma loja: criar o leitor e registrar aqui
// (e na lista STORES de web/app.js, para o site aceitar o link).
export const STORES = [kabum];

export function detectStore(url) {
  return STORES.find((s) => s.productKey(url)) || null;
}
