# Caçador de Ofertas

Monitor pessoal de preços: cadastro favoritos no site, um verificador consulta as lojas
a cada 2 horas e avisa no Telegram quando o preço chega na meta.

| Parte | Onde | Roda em |
|---|---|---|
| Site (favoritos, metas, histórico) | `web/` | GitHub Pages + Firebase (login Google, Firestore) |
| Verificador | `checker/` | GitHub Actions, a cada 2 h (`.github/workflows/verificar-precos.yml`) |
| Regras de segurança | `firestore.rules` | publicar com `node tools/deploy-rules.mjs` |

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
node --test checker/check.test.mjs              # testes
node checker/try-url.mjs <link>                 # testa a leitura de um produto
node checker/check.mjs --dry-run                # simula a rodada (não grava, não avisa)
node checker/check.mjs                          # rodada real
node tools/deploy-rules.mjs                     # publica as regras do Firestore
```

Credenciais locais ficam em `segredos/` (fora do Git): `.env` com `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `ML_APP_ID`, `ML_CLIENT_SECRET`, e `firebase-servico.json`.
No GitHub, viram os Secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` e
`FIREBASE_SERVICE_ACCOUNT` (conteúdo inteiro do JSON).
