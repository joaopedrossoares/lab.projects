---
name: commit-phase
description: >-
  Standardizes git commits in lab.projects using short Conventional Commits in
  Portuguese directly on main. Use this skill whenever finishing an execution
  phase of a plan or creating any commit in this repository.
---

# Padronização de Commits por Fase (`lab.projects`)

Siga este procedimento ao finalizar cada fase de um plano ou ao commitar alterações neste repositório.

## 1. Branch e Política de Commit

- **Commit direto na `main`**: este repositório aceita commits diretos na branch `main` ao concluir cada fase (não é necessário criar branch nem PR, salvo solicitação explícita).
- Verifique a branch atual antes de commitar:
  ```bash
  git branch --show-current
  ```
- Faça **1 commit atômico por fase concluída** (ou por correção isolada), somente após todos os critérios de aceite e testes da fase passarem.
- Só execute `git push` se o usuário pedir explicitamente ou ao final de um marco acordado.

## 2. Quality Gate Obrigatório (Pré-Commit)

Nunca commite código que quebre a aplicação ou vaze dados sensíveis:

1. **Verifique arquivos sensíveis**: rode `git status -s` e confirme que **não** há arquivos proibidos no stage (`.env`, `*.pdf`, `*.csv`, `*.xlsx`, `*.db`, `*.sqlite*`, chaves mestras, `data/`, `local-config/`).
2. **Rode a validação do app modificado** (para `apps/financas`, execute a suíte completa definida no plano):
   - Typecheck (`npm run typecheck`)
   - Testes automatizados (`npm test`)
   - Build de produção (`npm run build`)
3. Se qualquer verificação falhar, corrija antes de commitar.

## 3. Padrão de Mensagem Curta

Use **Conventional Commits em português**, em **uma única linha curta** (até 72 caracteres), sem ponto final:

```text
<tipo>(<escopo>): <resumo curto em minúsculas>
```

- **Tipos permitidos**:
  - `feat` — nova funcionalidade ou entrega de fase
  - `fix` — correção de bug
  - `refactor` — refatoração sem alterar comportamento
  - `test` — adição ou ajuste de testes
  - `chore` — configuração, build, docker, dependências, skills
  - `docs` — documentação (`README.md`, guias)
- **Escopos**: nome do app (`financas`, `mercado`, `cesta-basica`) ou infra (`compose`, `traefik`, `skills`).
- **Boas mensagens (curtas e objetivas)**:
  - `chore(skills): adiciona skill de padronizacao de commits`
  - `feat(financas): fase 0 base react e parser itau`
  - `feat(financas): fase 1 backend opaco e cofre zero-knowledge`
  - `feat(financas): fase 2 memoria de labels e categorias`
  - `feat(financas): fase 3 conferencia mensal do casal e historico`
  - `feat(financas): fase 4 fluxo enxuto e indicadores de seguranca`
  - `feat(financas): fase 5 config ia local e planejador de compras`
  - `chore(financas): fase 6 profiles homelab e backup cifrado`

## 4. Execução e Verificação

1. Adicione apenas os arquivos pertinentes à fase (evite `git add -A` cego quando houver arquivos temporários locais):
   ```bash
   git add <arquivos-da-fase>
   git diff --cached --stat
   ```
2. Crie o commit com mensagem curta:
   ```bash
   git commit -m "<tipo>(<escopo>): <resumo curto>"
   ```
3. Valide o resultado:
   ```bash
   git log -n 1 --stat
   git status -s
   ```
