"""Gera public/data/*.json para publicar o app sem servidor (GitHub Pages).

Uso: python export_static.py [pasta-das-planilhas]
"""
import datetime
import json
import os
import sys

import indices
from dieese import load_dir

src = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents/diaeese/items")
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "data")
os.makedirs(out, exist_ok=True)

series = load_dir(src)
series["snapshot"] = datetime.date.today().isoformat()
for name, value in (("series", series), ("indices", indices.fetch())):
    with open(os.path.join(out, f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False)
print(f"{len(series['months'])} meses exportados para {out}")
