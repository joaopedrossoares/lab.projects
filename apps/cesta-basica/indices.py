"""Séries do Banco Central (SGS) usadas para corrigir a cesta: INPC e salário mínimo."""
import json
import time
import urllib.request

SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados?formato=json&dataInicial={start}&dataFinal={end}"

# Para acrescentar outro índice (IPCA = 433, por exemplo), basta uma linha aqui.
SERIES = {
    "inpc": 188,      # INPC, variação % mensal
    "salario": 1619,  # Salário mínimo nominal, R$
}

CACHE_SECONDS = 24 * 3600
_cache = {"at": 0, "value": None}


def parse_sgs(rows):
    """[{'data': '01/09/2018', 'valor': '0.30'}] -> {'2018-09': 0.30}"""
    out = {}
    for r in rows:
        _, mm, yyyy = r["data"].split("/")
        out[f"{yyyy}-{mm}"] = float(r["valor"])
    return out


def fetch(start="01/01/2018", end="31/12/2030"):
    if _cache["value"] and time.time() - _cache["at"] < CACHE_SECONDS:
        return _cache["value"]
    value = {}
    for name, code in SERIES.items():
        url = SGS_URL.format(code=code, start=start, end=end)
        with urllib.request.urlopen(url, timeout=20) as res:
            value[name] = parse_sgs(json.load(res))
    _cache.update(at=time.time(), value=value)
    return value
