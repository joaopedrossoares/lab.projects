"""Servidor do app: entrega a pasta public/ e a série em /api/series."""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

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

    def do_GET(self):
        if self.path.split("?")[0] == "/api/series":
            try:
                body, status = json.dumps(series(), ensure_ascii=False).encode(), 200
            except OSError as exc:
                body, status = json.dumps({"error": f"Pasta de dados ilegível: {exc}"}).encode(), 500
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == "__main__":
    print(f"cesta-basica em :{PORT}, lendo {DATA_DIR}", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
