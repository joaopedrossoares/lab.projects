import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from indices import parse_sgs  # noqa: E402


class ParseSgsTest(unittest.TestCase):
    def test_converte_data_e_valor(self):
        rows = [{"data": "01/09/2018", "valor": "0.30"}, {"data": "01/10/2026", "valor": "1621.00"}]
        self.assertEqual(parse_sgs(rows), {"2018-09": 0.30, "2026-10": 1621.0})


if __name__ == "__main__":
    unittest.main()
