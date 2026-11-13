// Confere o token de login do Firebase (Google) que o site manda no cabeçalho Authorization.
// Mesma regra do firestore.rules: só a conta do dono, com e-mail verificado.
const PROJECT_ID = 'cupons-bot';
const OWNER_EMAIL = 'fellipenn9@gmail.com';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let jwksCache = { keys: null, expires: 0 };

async function getKey(kid) {
  if (!jwksCache.keys || Date.now() > jwksCache.expires) {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`Não consegui baixar as chaves do Google (${res.status})`);
    const maxAge = Number(res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 3600);
    jwksCache = { keys: (await res.json()).keys, expires: Date.now() + maxAge * 1000 };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === kid);
  if (!jwk) return null;
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

// Confere assinatura, projeto e validade; devolve o conteúdo do token ou null.
export async function verifyFirebaseToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = b64urlToJson(parts[0]);
    const payload = b64urlToJson(parts[1]);
    if (header.alg !== 'RS256') return null;
    const key = await getKey(header.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    const now = Math.floor(Date.now() / 1000);
    if (!ok || payload.aud !== PROJECT_ID || payload.iss !== `https://securetoken.google.com/${PROJECT_ID}` || !(payload.exp > now) || !(payload.iat <= now + 60)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// Devolve o e-mail do dono se o token for válido e for dele; senão, null.
export async function verifyOwner(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const payload = await verifyFirebaseToken(token);
  return payload?.email === OWNER_EMAIL && payload.email_verified === true ? payload.email : null;
}
