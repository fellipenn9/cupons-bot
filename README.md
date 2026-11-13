# Caçador de Ofertas

Monitor pessoal de preços: cadastro favoritos no site, um verificador consulta as lojas
a cada 2 horas e avisa no Telegram quando o preço chega na meta.

Tudo roda na Cloudflare (Worker `cupons-bot`, plano gratuito):

| Parte | Onde | Quando |
|---|---|---|
| Site (favoritos, metas, histórico, Radar) | `web/` | https://cupons-bot.fellipenn9.workers.dev |
| Verificador de preços | `checker/run-check.mjs` | cron `5,35 * * * *` (a cada 30 min) |
| Radar de ofertas (canais do Telegram) | `checker/radar/run.mjs` | cron `*/2 * * * *` (a cada 2 min) |
| Novidades nas lojas (produto novo / voltou ao estoque) | `checker/watch/run.mjs` | cron `1-59/10 * * * *` (a cada 10 min) |
| Entrada do Worker | `worker/index.mjs` + `wrangler.toml` | — |
| Regras do Firestore | `firestore.rules` | `node tools/deploy-rules.mjs` |

Publicar: `node tools/deploy.mjs` (roda os testes antes). Com `--secrets` reenvia token do
Telegram e chave do Firebase. Logs ao vivo: `npx wrangler@4 tail` (com o token no ambiente).
O GitHub guarda só o código: o Actions da conta está desativado pelo GitHub (nov/2026).

## Lojas

| Loja | Situação |
|---|---|
| KaBuM! | ✅ página do produto: Pix, cartão, preço "de" e estoque |
| Americanas, Brastemp, Consul, Electrolux, Lojas MM, COPAG | ✅ catálogo público VTEX (`checker/stores/vtex.mjs`) |
| Mercado Livre | ⏳ aguardando app de desenvolvedor (API exige token; site bloqueia robôs) |
| Shopee, AliExpress | ⏳ aguardando aprovação de afiliado (API oficial) |
| Amazon | ⏳ PA-API só libera após vendas como afiliado |
| Magalu, Liga Pokémon, Carrefour, Casas Bahia, Ponto, Pichau, Terabyte, Centauro | ❌ bloqueiam robôs (não contornamos) |

Para adicionar uma loja: leitor em `checker/stores/`, registrar em `checker/stores/index.mjs`
e na lista `STORES` de `web/app.js`. Regra: só acesso honesto (API oficial ou página pública
com o User-Agent do projeto) — loja que bloqueia robô não é contornada.

## Comandos

```bash
node --test checker/check.test.mjs checker/radar.test.mjs checker/coupons.test.mjs checker/watch.test.mjs   # testes
node checker/try-url.mjs <link>                 # testa a leitura de um produto
node checker/check.mjs --dry-run                # simula a rodada (não grava, não avisa)
node checker/check.mjs                          # rodada real
node checker/radar.mjs --dry-run --all          # prévia do radar nos ~20 últimos posts de cada canal
node checker/radar.mjs                          # rodada real do radar
node checker/watch.mjs --dry-run                # novidades nas lojas, sem enviar nem gravar
node tools/deploy-rules.mjs                     # publica as regras do Firestore
```

Credenciais locais ficam em `segredos/` (fora do Git): `.env` com `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `ML_APP_ID`, `ML_CLIENT_SECRET`, e `firebase-servico.json`.
Na Cloudflare, viram os segredos do Worker (`node tools/deploy.mjs --secrets`).
`CLOUDFLARE_API_TOKEN` também fica no `.env`.
