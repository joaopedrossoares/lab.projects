# Finanças Casal (`apps/financas`)

Sistema local-first de organização financeira pessoal e de casal com privacidade Zero-Knowledge e assistente de planejamento com IA.

Consulte o plano detalhado em [PLAN.md](./PLAN.md).

## Arquitetura dos Workspaces

- `shared/`: tipos de domínio, parser Itaú PDF unificado (incluindo parcelas futuras) e criptografia Zero-Knowledge.
- `web/`: interface React + TypeScript + Vite com `pdfjs-dist` embutido localmente (zero CDNs).
- `edge/`: BFF local em Docker (serve `web/`, cofre `AES-256-GCM`, motor financeiro e gateway local de IA).
- `backend/`: API de armazenamento opaco (PostgreSQL na Railway / homelab + SQLite opcional).

## Comandos

```bash
cd apps/financas
npm install
npm run check      # typecheck + testes + build
npm run dev:edge   # servidor Edge local (porta 3000)
npm run dev:web    # Vite dev server (porta 5173)
```

## Docker (`lab.projects`)

Na raiz do repositório:

```bash
docker compose up -d --build financas
```

Acesse em `http://financas.traefik.me` (ou `http://fatura.traefik.me`).
