// Publica firestore.rules no projeto, sem precisar colar no console:
//   node tools/deploy-rules.mjs
import { readFileSync } from 'node:fs';
import { loadConfig } from '../checker/lib/env.mjs';
import { getAccessToken } from '../checker/lib/firestore.mjs';

const { serviceAccount: sa } = loadConfig();
const token = await getAccessToken(sa, 'https://www.googleapis.com/auth/firebase');
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const api = `https://firebaserules.googleapis.com/v1/projects/${sa.project_id}`;
const content = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

const rs = await fetch(`${api}/rulesets`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content }] } }),
});
const ruleset = await rs.json();
if (!rs.ok) throw new Error(`Regras rejeitadas: ${JSON.stringify(ruleset.error?.details || ruleset.error)}`);

const release = `projects/${sa.project_id}/releases/cloud.firestore`;
const rel = await fetch(`${api}/releases/cloud.firestore`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ release: { name: release, rulesetName: ruleset.name } }),
});
if (!rel.ok) throw new Error(`Falha ao publicar: ${(await rel.text()).slice(0, 300)}`);
console.log(`Regras publicadas (${ruleset.name.split('/').pop()}).`);
