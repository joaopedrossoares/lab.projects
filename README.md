# 🧪 Lab Projects & Infrastructure

Um laboratório de desenvolvimento local centralizado, orquestrado com Docker, roteado via Traefik v3 e visualizado através de um painel de controle unificado (Homepage).

---

## 🏗️ Arquitetura do Laboratório

O ambiente foi desenhado para isolar aplicações e experimentos sem conflitos de portas, utilizando uma rede Docker interna (`lab-net`).

* **Traefik (Reverse Proxy):** Intercepta as requisições HTTP locais e as direciona para os containers corretos com base em regras de Host (`*.traefik.me`).
* **Homepage (Dashboard Central):** Lê o `docker.sock` em tempo real para exibir o status de todos os serviços em execução, divididos por categorias.
* **Aplicações e Snippets:** Ambientes isolados rodando Nginx (para estáticos) ou Node.js (para aplicações dinâmicas).

---

## 📁 Estrutura de Diretórios

```text
lab.projects/
├── docker-compose.yml            # Orquestrador central de todos os serviços
├── config-homepage/              # Configurações e widgets do dashboard
│   ├── docker.yaml
│   └── services.yaml
├── apps/                         # Aplicações completas com interface web
│   ├── afinador/                 # Afinador de instrumentos via microfone (Nginx)
│   ├── ai-slide-generator/       # Gerador de slides com IA (Gemini + Marp, Node.js)
│   ├── chord-finder/             # App de busca de cifras (Node.js)
│   ├── fatura-casal-csv-app/     # Leitor e extrator de faturas (Nginx)
│   ├── harmonic-cicle/           # Estudo visual de ciclo harmônico (Nginx)
│   ├── mercado/                  # Comparador de preços de supermercado por CEP (Node.js)
│   └── slide-puzzle/             # Slide Math Puzzle, jogo de lógica numérico (Nginx)
└── snippets/                     # Scripts isolados e PoCs (Testes rápidos, TS/JS/HTML)
```
## 🚀 Como Subir o Ambiente
Certifique-se de estar na raiz do repositório (lab.projects).

Suba todos os containers em segundo plano (construindo imagens locais se necessário):

Bash
docker compose up -d --build
Acesse os serviços localmente:

| Serviço | Endereço | Observação |
| --- | --- | --- |
| Hub Visual (Dashboard) | http://localhost:3000 | |
| Painel Traefik | http://localhost:8080 | |
| Ciclo Harmônico | http://harmonic.traefik.me | |
| Chord Finder | http://chords.traefik.me | |
| Afinador | http://localhost:8081 | Exposto direto em `localhost` para o navegador liberar o microfone (também em http://afinador.traefik.me) |
| Faturas Casal | http://fatura.traefik.me | |
| Slide Math Puzzle | http://puzzle.traefik.me | |
| Mercado | http://mercado.traefik.me | CEP definido em `CEP` no `docker-compose.yml` |
| AI Slide Builder | http://slides.traefik.me | Requer `GEMINI_API_KEY` no `docker-compose.yml` |
| Excalidraw | http://excalidraw.traefik.me | Imagem oficial `excalidraw/excalidraw`, sem código local |

🛠️ Comandos Úteis
Parar o laboratório:

Bash
```docker compose down```
Ver logs de um serviço específico:

Bash
```docker compose logs -f <nome-do-servico>```
Limpar containers órfãos/parados:

Bash
```docker container prune -f```
