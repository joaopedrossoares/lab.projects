#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ $# -eq 0 ]]; then
  echo "Parando todos os serviços do lab.projects (incluindo profiles local/homelab)..."
  docker compose --profile local --profile homelab down
  exit 0
fi

TARGETS=()
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      echo "Uso: ./scripts/down.sh [apps...]"
      echo "Sem parâmetros: derruba todos os containers."
      echo "Com app (ex: ./scripts/down.sh financas): para e remove apenas os containers daquele app."
      exit 0
      ;;
    financas|fatura|fatura-casal)
      TARGETS+=("financas" "financas-backend" "financas-postgres")
      ;;
    cesta)
      TARGETS+=("cesta-basica")
      ;;
    chords)
      TARGETS+=("chord-finder")
      ;;
    harmonic)
      TARGETS+=("harmonic-cicle")
      ;;
    puzzle)
      TARGETS+=("slide-puzzle")
      ;;
    slides)
      TARGETS+=("ai-slide-generator")
      ;;
    *)
      TARGETS+=("$arg")
      ;;
  esac
done

echo "Parando serviços: ${TARGETS[*]}"
docker compose --profile local --profile homelab stop "${TARGETS[@]}"
docker compose --profile local --profile homelab rm -f "${TARGETS[@]}"
