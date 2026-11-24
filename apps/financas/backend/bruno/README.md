# Collection Bruno — Finanças API

Collection pronta para testar tanto o **Backend Opaco** (Local `http://localhost:3001` ou Produção Railway `https://api-production-c9df008c.up.railway.app`) quanto todas as rotas do **Edge Local** (`http://financas.traefik.me`).

## Como usar no Bruno

1. No Bruno, clique em **Open Collection** e selecione a pasta `apps/financas/backend/bruno`.
2. Escolha o ambiente no canto superior direito:
   - **`Local`**: aponta `backendUrl` para `http://localhost:3001` (suba com `./scripts/up.sh financas local`).
   - **`Producao`**: aponta `backendUrl` para `https://api-production-c9df008c.up.railway.app` (suba com `./scripts/up.sh financas`).
3. Em **Environments → Configure**, preencha o segredo `syncApiToken` com o valor de `FINANCAS_SYNC_TOKEN` do seu `.env` local (o Bruno guarda variáveis `vars:secret` localmente sem commitar no git).

## Estrutura

- `01-Backend-Opaco`: testa diretamente o backend opaco (Railway ou local) com autenticação Bearer.
- `02-Edge-Privacidade`: status da conexão Zero-Knowledge, auditoria e teste de roundtrip cifrado.
- `03-Edge-Labels`: listar, salvar e aplicar regras de labels.
- `04-Edge-Conferencia`: competência mensal (`YYYY-MM`), fechamento do casal e planos do casal.
- `05-Edge-Seguranca`: overview dos 4 indicadores, fluxo recorrente, reservas, perfil e simulador.
- `06-Edge-Planejador-IA`: backlog de compras, configuração de IA local, priorização e chat.
