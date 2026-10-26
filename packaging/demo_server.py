"""GNEZDO demo without GNEZDO.exe: serves the demo pages with Python, for PCs where
company rules do not let GNEZDO.exe run. Everything runs in the browser on sample data;
nothing is saved. Started by start.bat:  py demo_server.py
"""
import functools
import http.server
import os
import sys
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "program", "wwwroot-demo")


class Pages(http.server.SimpleHTTPRequestHandler):
    # Windows often maps .js to text/plain in the registry; browsers then refuse to run the page
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
        ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2",
    }

    def log_message(self, *args):
        pass


if not os.path.isdir(ROOT):
    sys.exit("The demo pages are missing (program\\wwwroot-demo). Unzip GNEZDO again.")
try:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Pages, directory=ROOT))
except OSError as e:
    sys.exit(f"Port {PORT} is taken or not allowed ({e}). Try: py demo_server.py 8091")
url = f"http://localhost:{PORT}"
print(f"GNEZDO DEMO (with Python) - sample data, nothing is saved. Open {url} in a browser.")
print("Close this window to stop it.")
webbrowser.open(url)
server.serve_forever()
