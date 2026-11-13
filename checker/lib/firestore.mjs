// Cliente mínimo do Firestore via REST, autenticado pela conta de serviço.
// Só usa APIs web (fetch, crypto.subtle), então roda igual no Node e no Cloudflare Workers.

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s) => new TextEncoder().encode(s);

async function signRs256(privateKeyPem, data) {
  const der = Uint8Array.from(atob(privateKeyPem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(data)));
}

export async function getAccessToken(serviceAccount, scope = 'https://www.googleapis.com/auth/datastore') {
  const b64json = (v) => base64url(utf8(JSON.stringify(v)));
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64json({ alg: 'RS256', typ: 'JWT' })}.${b64json({
    iss: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = await signRs256(serviceAccount.private_key, unsigned);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`Falha ao autenticar no Google: ${body.error_description || body.error}`);
  return body.access_token;
}

export function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(v) } };
}

export function encodeFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, encodeValue(v)]));
}

export function decodeValue(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

export function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}

export function createFirestore(serviceAccount, token) {
  const base = `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  async function call(url, init = {}) {
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) throw new Error(`Firestore ${init.method || 'GET'} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.status === 204 ? null : res.json();
  }

  return {
    async list(collection) {
      const docs = [];
      let pageToken = '';
      do {
        const qs = new URLSearchParams({ pageSize: '300', ...(pageToken && { pageToken }) });
        const body = await call(`${base}/${collection}?${qs}`);
        for (const d of body.documents || []) docs.push({ id: d.name.split('/').pop(), data: decodeFields(d.fields) });
        pageToken = body.nextPageToken || '';
      } while (pageToken);
      return docs;
    },

    async get(collection, id) {
      const res = await fetch(`${base}/${collection}/${id}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Firestore GET ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return decodeFields((await res.json()).fields);
    },

    // Atualiza só os campos informados e falha se o documento foi apagado nesse meio-tempo.
    async update(collection, id, data) {
      const qs = new URLSearchParams({ 'currentDocument.exists': 'true' });
      for (const key of Object.keys(data)) qs.append('updateMask.fieldPaths', key);
      return call(`${base}/${collection}/${id}?${qs}`, { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(data) }) });
    },

    async set(collection, id, data) {
      return call(`${base}/${collection}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(data) }) });
    },

    async remove(collection, id) {
      return call(`${base}/${collection}/${id}`, { method: 'DELETE' });
    },
  };
}
