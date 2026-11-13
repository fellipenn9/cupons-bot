// Regra de interesse: cada termo é uma lista de palavras que precisam aparecer TODAS no post,
// em qualquer ordem, sem diferenciar maiúscula nem acento.
//   "pokemon tcg"        → post com "pokémon" e "tcg"
//   "geladeira -frigobar" → post com "geladeira" e sem "frigobar"

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const tokenize = (s) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);

export function parseTerm(term) {
  const include = [];
  const exclude = [];
  // "nintendo - sorteio" (com espaço depois do tracinho) também é exclusão.
  const normalizedTerm = String(term).trim().replace(/(^|\s)-\s+(?=\S)/g, '$1-');
  for (const raw of normalizedTerm.split(/\s+/)) {
    const neg = raw.startsWith('-');
    const words = tokenize(neg ? raw.slice(1) : raw);
    (neg ? exclude : include).push(...words);
  }
  return { term: String(term).trim(), include, exclude };
}

// Palavra casa por inteiro ou como começo de palavra ("notebook" casa "notebooks"; "nintendo" não casa "nin").
function hasWord(tokens, word) {
  return tokens.some((t) => t === word || (word.length >= 4 && t.startsWith(word)));
}

export function matchTerms(text, terms) {
  const tokens = tokenize(text);
  return terms.filter(({ include, exclude }) => include.length && include.every((w) => hasWord(tokens, w)) && !exclude.some((w) => hasWord(tokens, w))).map((t) => t.term);
}

// Mesmo achado repostado em vários canais: compara pelo começo do texto já normalizado.
export function fingerprint(post) {
  return tokenize(post.text).slice(0, 14).join(' ');
}
