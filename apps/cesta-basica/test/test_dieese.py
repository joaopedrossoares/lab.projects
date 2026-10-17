import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dieese import parse_rows  # noqa: E402


class ParseRowsTest(unittest.TestCase):
    def test_formato_dieese(self):
        rows = [
            ["Gasto Mensal - Belo Horizonte", "", ""],
            ["", "Total da Cesta", "Carne"],
            ["01-2019", 405.4, 134.94],
            ["Fonte: DIEESE", "", ""],
        ]
        rec = parse_rows(rows)
        self.assertEqual(rec["city"], "Belo Horizonte")
        self.assertEqual(rec["month"], "2019-01")
        self.assertEqual(rec["values"], {"Total da Cesta": 405.4, "Carne": 134.94})

    def test_celula_vazia_fica_de_fora(self):
        rows = [["", "Total da Cesta", "Café"], ["06-2026", 826.72, ""]]
        self.assertEqual(parse_rows(rows)["values"], {"Total da Cesta": 826.72})

    def test_sem_linha_de_dados(self):
        with self.assertRaises(ValueError):
            parse_rows([["Gasto Mensal - BH"], ["", "Total da Cesta"]])


if __name__ == "__main__":
    unittest.main()
