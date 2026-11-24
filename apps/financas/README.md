# Finanças Casal (`apps/financas`)

Sistema local-first de organização financeira pessoal e de casal com privacidade **Zero-Knowledge**, conferência mensal com acerto líquido, **4 Indicadores de Segurança Financeira** e **Assistente de Planejamento com IA**.

Consulte a arquitetura completa em [PLAN.md](./PLAN.md).

---

## Arquitetura dos Workspaces

- `shared/`: tipos de domínio, parser Itaú PDF unificado (incluindo parcelas futuras) e criptografia `AES-256-GCM` + índices cegos `HMAC-SHA256`.
- `web/`: interface **React + TypeScript + Vite** com `pdfjs-dist` embutido localmente (zero CDNs externas).
- `edge/`: BFF local em Docker (serve `web/`, cifra tudo antes de enviar ao backend, executa o motor financeiro determinístico e o gateway local de IA com chaves salvas somente em `./local-config`).
- `backend/`: API de armazenamento opaco (PostgreSQL na Railway / homelab + fallback SQLite), protegida por `SYNC_API_TOKEN`.

---

## Modos de Execução (`lab.projects`)

### 1. Modo Híbrido (Hoje: UI + Edge Local ↔ Backend Opaco na Railway)

Configure o `.env` na raiz do `lab.projects` (use `.env.example` como base):

```env
FINANCAS_MASTER_KEY=<chave-mestra-32-chars-apenas-local>
FINANCAS_BACKEND_URL=https://api-production-c9df008c.up.railway.app
FINANCAS_SYNC_TOKEN=<token-bearer-configurado-na-railway>
LAB_DOMAIN=traefik.me
```

Suba na raiz do repositório:

```bash
docker compose up -d --build financas
```

Acesse: `http://financas.traefik.me` (ou `http://fatura.traefik.me`).

### 2. Modo Local Offline (SQLite)

Basta deixar `FINANCAS_BACKEND_URL` vazio no `.env`. O Edge grava os mesmos envelopes cifrados localmente em `apps/financas/data/opaque.sqlite`.

### 3. Modo Homelab (Futuro Servidor Local na Rede LAN)

No futuro servidor local, suba o profile `homelab` (Edge + Backend + PostgreSQL 17 tudo na LAN):

```env
FINANCAS_BACKEND_URL=http://financas-backend:3001
FINANCAS_PG_PASSWORD=<senha-local-postgres>
LAB_DOMAIN=lab.lan
```

```bash
docker compose --profile homelab up -d --build financas financas-backend financas-postgres
```

Para migrar os dados da Railway para o Homelab em 1 clique:
1. Na aba **Configurações**, clique em **Exportar Backup Cifrado (.json)**.
2. No Homelab (usando a mesma `FINANCAS_MASTER_KEY`), clique em **Importar Backup Cifrado**.

---

## Configuração de IA (100% Local)

Abra a aba **Configurações** na interface para selecionar o provedor (`Google Gemini API`, `Ollama Local` ou `OpenAI-Compatible`), modelo (padrão `gemini-4-hydrogen`) e API key. A configuração é criptografada e salva **somente** em `apps/financas/local-config/ai-config.enc` — nunca é enviada ao backend da Railway.

---

## Desenvolvimento & Testes (Quality Gate)

```bash
cd apps/financas
npm install
npm run check      # typecheck + vitest (inclui auditoria Zero-Knowledge) + build
```
