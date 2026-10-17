"""Servidor do app: entrega a pasta public/, a série em /api/series e os índices em /api/indices."""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import indices
from dieese import load_dir

DATA_DIR = os.environ.get("DATA_DIR", "/data")
PORT = int(os.environ.get("PORT", "8000"))
PUBLIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

_cache = {"key": None, "value": None}


def series():
    # Relê só quando algum arquivo da pasta muda (novo mês baixado, por exemplo).
    key = tuple(sorted((e.name, e.stat().st_mtime) for e in os.scandir(DATA_DIR)))
    if key != _cache["key"]:
        _cache["value"] = load_dir(DATA_DIR)
        _cache["key"] = key
    return _cache["value"]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    def send_json(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/series":
            try:
                return self.send_json(series())
            except OSError as exc:
                return self.send_json({"error": f"Pasta de dados ilegível: {exc}"}, 500)
        if path == "/api/indices":
            try:
                return self.send_json(indices.fetch())
            except Exception as exc:
                return self.send_json({"error": f"Banco Central indisponível: {exc}"}, 502)
        super().do_GET()


if __name__ == "__main__":
    print(f"cesta-basica em :{PORT}, lendo {DATA_DIR}", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
