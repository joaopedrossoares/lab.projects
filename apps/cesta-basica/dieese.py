"""Leitura das planilhas mensais da cesta básica do DIEESE (um .xls por mês)."""
import os
import re

import xlrd

MONTH_RE = re.compile(r"^(\d{2})-(\d{4})$")


def parse_rows(rows):
    """Recebe as linhas de uma planilha e devolve {city, month, values}.

    Formato esperado (exportação do DIEESE):
        ['Gasto Mensal - Belo Horizonte', ...]
        ['', 'Total da Cesta', 'Carne', ...]
        ['01-2019', 405.4, 134.94, ...]
    """
    city = None
    header = None
    for row in rows:
        first = str(row[0]).strip() if row else ""
        if first.startswith("Gasto Mensal"):
            city = first.split("-", 1)[-1].strip()
        elif first == "" and any(str(c).strip() for c in row[1:]):
            header = [str(c).strip() for c in row]
        elif header and MONTH_RE.match(first):
            mm, yyyy = MONTH_RE.match(first).groups()
            values = {}
            for name, cell in zip(header[1:], row[1:]):
                if name and isinstance(cell, (int, float)):
                    values[name] = round(float(cell), 2)
            return {"city": city, "month": f"{yyyy}-{mm}", "items": header[1:], "values": values}
    raise ValueError("linha de dados (MM-AAAA) não encontrada")


def read_file(path):
    book = xlrd.open_workbook(path)
    sheet = book.sheet_by_index(0)
    return parse_rows([sheet.row_values(r) for r in range(sheet.nrows)])


def load_dir(directory):
    """Lê todos os .xls da pasta e devolve a série mensal ordenada."""
    months, items, cities, errors = [], [], set(), []
    for name in sorted(os.listdir(directory)):
        if not name.lower().endswith(".xls"):
            continue
        try:
            rec = read_file(os.path.join(directory, name))
        except Exception as exc:  # planilha inesperada não derruba o resto
            errors.append({"file": name, "error": str(exc)})
            continue
        cities.add(rec["city"])
        for item in rec["items"]:
            if item and item not in items:
                items.append(item)
        months.append({"month": rec["month"], "values": rec["values"]})
    months.sort(key=lambda m: m["month"])
    return {"cities": sorted(c for c in cities if c), "items": items, "months": months, "errors": errors}
