#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ENV_MODE="prod"
BUILD_FLAG="--build"
APPS=()

ALL_APPS=(
  "harmonic-cicle"
  "chord-finder"
  "financas"
  "excalidraw"
  "slide-puzzle"
  "ai-slide-generator"
  "mercado"
  "cesta-basica"
  "afinador"
)

usage() {
  cat <<'EOF'
Uso: ./scripts/up.sh [apps...] [prod|local] [--no-build]

Exemplos:
  ./scripts/up.sh                    # Sobe TODOS os apps (ambiente padrão: prod)
  ./scripts/up.sh local              # Sobe TODOS os apps rodando 100% localmente
  ./scripts/up.sh financas           # Sobe apenas o necessário para Finanças (apontando para prod/Railway)
  ./scripts/up.sh financas local     # Sobe apenas Finanças rodando 100% local (Edge + Backend + Postgres)
  ./scripts/up.sh mercado            # Sobe apenas Traefik + Homepage + Mercado
  ./scripts/up.sh financas --no-build

Apps suportados:
  financas (fatura), mercado, cesta-basica (cesta), afinador,
  chord-finder (chords), harmonic-cicle (harmonic), slide-puzzle (puzzle),
  ai-slide-generator (slides), excalidraw
EOF
}

resolve_app_name() {
  case "$1" in
    financas|fatura|fatura-casal) echo "financas" ;;
    mercado) echo "mercado" ;;
    cesta-basica|cesta) echo "cesta-basica" ;;
    afinador) echo "afinador" ;;
    chord-finder|chords) echo "chord-finder" ;;
    harmonic-cicle|harmonic) echo "harmonic-cicle" ;;
    slide-puzzle|puzzle) echo "slide-puzzle" ;;
    ai-slide-generator|slides) echo "ai-slide-generator" ;;
    excalidraw) echo "excalidraw" ;;
    *) return 1 ;;
  esac
}

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    prod|production)
      ENV_MODE="prod"
      ;;
    local)
      ENV_MODE="local"
      ;;
    --no-build)
      BUILD_FLAG=""
      ;;
    *)
      if resolved="$(resolve_app_name "$arg")"; then
        APPS+=("$resolved")
      else
        echo "Erro: parâmetro ou app desconhecido: '$arg'" >&2
        echo "Use './scripts/up.sh --help' para ver as opções disponíveis." >&2
        exit 1
      fi
      ;;
  esac
done

# Carrega variáveis do .env local se existir (para checagens e impressão de URLs)
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

LAB_DOMAIN="${LAB_DOMAIN:-traefik.me}"
TRAEFIK_HTTP_PORT="${TRAEFIK_HTTP_PORT:-80}"
PORT_SUFFIX=""
if [[ "$TRAEFIK_HTTP_PORT" != "80" ]]; then
  PORT_SUFFIX=":${TRAEFIK_HTTP_PORT}"
fi

# Sem apps especificados -> sobe todos os apps
if [[ ${#APPS[@]} -eq 0 ]]; then
  APPS=("${ALL_APPS[@]}")
fi

# Sempre inclui roteador Traefik e Hub Visual Homepage
SERVICES=("traefik" "homepage")
COMPOSE_ARGS=()
INCLUDES_FINANCAS=false

for app in "${APPS[@]}"; do
  if [[ "$app" == "financas" ]]; then
    INCLUDES_FINANCAS=true
  fi
  SERVICES+=("$app")
done

if [[ "$INCLUDES_FINANCAS" == true ]]; then
  if [[ "$ENV_MODE" == "local" ]]; then
    COMPOSE_ARGS+=(--profile local)
    SERVICES+=("financas-postgres" "financas-backend")
    export FINANCAS_BACKEND_URL="http://financas-backend:3001"
  else
    if [[ -z "${FINANCAS_BACKEND_URL:-}" ]]; then
      echo "Aviso: FINANCAS_BACKEND_URL não está definido no .env (modo prod). O Edge usará SQLite local." >&2
    fi
  fi
fi

# Remove duplicatas mantendo a ordem
UNIQUE_SERVICES=()
for svc in "${SERVICES[@]}"; do
  already=false
  for existing in "${UNIQUE_SERVICES[@]:-}"; do
    if [[ "$existing" == "$svc" ]]; then
      already=true
      break
    fi
  done
  if [[ "$already" == false ]]; then
    UNIQUE_SERVICES+=("$svc")
  fi
done

echo "============================================================"
echo " lab.projects — Subindo serviços"
echo " Ambiente : $ENV_MODE"
echo " Serviços : ${UNIQUE_SERVICES[*]}"
if [[ "$INCLUDES_FINANCAS" == true ]]; then
  echo " Finanças : BACKEND=${FINANCAS_BACKEND_URL:-sqlite-local}"
fi
echo "============================================================"

# shellcheck disable=SC2086
docker compose ${COMPOSE_ARGS[@]+"${COMPOSE_ARGS[@]}"} up -d $BUILD_FLAG "${UNIQUE_SERVICES[@]}"

echo ""
echo "Serviços no ar:"
echo "  - Hub Visual (Homepage): http://localhost:3000"
echo "  - Painel Traefik       : http://localhost:8080"

for app in "${APPS[@]}"; do
  case "$app" in
    financas)
      echo "  - Finanças Casal (UI)  : http://financas.${LAB_DOMAIN}${PORT_SUFFIX} (ou http://fatura.${LAB_DOMAIN}${PORT_SUFFIX})"
      if [[ "$ENV_MODE" == "local" ]]; then
        echo "  - Finanças Backend API : http://localhost:3001 (Bruno env: Local)"
      else
        echo "  - Finanças Backend API : ${FINANCAS_BACKEND_URL:-sqlite-local} (Bruno env: Producao)"
      fi
      ;;
    mercado)            echo "  - Mercado              : http://mercado.${LAB_DOMAIN}${PORT_SUFFIX}" ;;
    cesta-basica)       echo "  - Cesta Básica         : http://cesta.${LAB_DOMAIN}${PORT_SUFFIX}" ;;
    afinador)           echo "  - Afinador             : http://localhost:8081" ;;
    chord-finder)       echo "  - Chord Finder         : http://chords.${LAB_DOMAIN}${PORT_SUFFIX}" ;;
    harmonic-cicle)     echo "  - Ciclo Harmônico      : http://harmonic.${LAB_DOMAIN}${PORT_SUFFIX}" ;;
    slide-puzzle)       echo "  - Slide Math Puzzle    : http://puzzle.${LAB_DOMAIN}${PORT_SUFFIX}" ;;
    ai-slide-generator) echo "  - AI Slide Builder     : http://slides.${LAB_DOMAIN}${PORT_SUFFIX}" ;;
    excalidraw)         echo "  - Excalidraw           : http://excalidraw.${LAB_DOMAIN}${PORT_SUFFIX}" ;;
  esac
done
