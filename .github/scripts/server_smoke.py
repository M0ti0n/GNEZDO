"""The whole server build on Linux, as a user meets it: web + API + SQL Server from docker compose.

    python3 .github/scripts/server_smoke.py [http://localhost:8080] [--after-restart]

Checks: the page loads, the API needs a sign-in, the first admin is made, a real nest
(nestprep + PackingSolver) runs to the end, a second user signs in without a password,
a non-admin cannot change machines, and sign-out closes the API again.
With --after-restart: the cookie saved by the first run still works (keys kept in the volume).
"""
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request

args = [a for a in sys.argv[1:] if not a.startswith("--")]
BASE = (args[0] if args else "http://localhost:8080").rstrip("/")
AFTER_RESTART = "--after-restart" in sys.argv
JAR_FILE = "smoke-cookies.txt"


def client():
    jar = http.cookiejar.LWPCookieJar(JAR_FILE)
    return jar, urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(opener, method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json", "X-Gnezdo-Browser": "smoke"})
    try:
        with opener.open(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw and r.headers.get_content_type() == "application/json" else raw)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def ok(cond, what):
    print(("ok   " if cond else "FAIL ") + what, flush=True)
    if not cond:
        sys.exit(1)


def wait_up():
    _, o = client()
    for _ in range(120):
        try:
            s, b = call(o, "GET", "/api/health")
            if s == 200:
                return b
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            pass
        time.sleep(2)
    ok(False, "the API answers /api/health within 4 minutes")


health = wait_up()
ok(health.get("demo") is False, "the API runs with the database (not the demo)")

if AFTER_RESTART:
    jar, o = client()
    jar.load(ignore_discard=True, ignore_expires=True)
    s, me = call(o, "GET", "/api/auth/state")
    ok(s == 200 and (me.get("user") or {}).get("name") == "Admin", "after a restart the admin is still signed in")
    s, _ = call(o, "GET", "/api/nest/status")
    ok(s == 200, "and may use the API")
    sys.exit(0)

jar, o = client()
s, page = call(o, "GET", "/")
ok(s == 200 and b"<div id=\"root\"" in page, "the web page loads")

s, st = call(o, "GET", "/api/auth/state")
ok(s == 200 and st.get("required") and st.get("setupNeeded"), f"sign-in is required, no users yet ({st})")
s, _ = call(o, "GET", "/api/nest/status")
ok(s == 401, "the API is closed before signing in")

s, b = call(o, "POST", "/api/auth/setup", {"name": "Admin", "password": "smoke-pass-1"})
ok(s == 200, f"the first admin is made ({s} {b})")
jar.save(ignore_discard=True, ignore_expires=True)
s, st = call(o, "GET", "/api/auth/state")
ok((st.get("user") or {}).get("isAdmin") is True, "and is signed in as an admin")

s, ns = call(o, "GET", "/api/nest/status")
ok(s == 200 and ns.get("available"), f"the nesting engine is installed ({ns})")

req = {
    "mode": "fast", "minutes": None, "partGapMm": 5, "edgeGapMm": 5,
    "parts": [
        {"id": "a", "name": "A", "rotations": [0, 90, 180, 270], "mirror": False, "path": "M0 0 L400 0 L400 200 L0 200Z", "qty": 6, "material": "S235", "thicknessMm": 10},
        {"id": "b", "name": "B", "rotations": [0, 90, 180, 270], "mirror": False, "path": "M0 0 L300 0 L300 300 L150 120 L0 300Z", "qty": 4, "material": "S235", "thicknessMm": 10},
        {"id": "c", "name": "C", "rotations": [0, 90, 180, 270], "mirror": False, "path": "M0 0 L120 0 L120 120 L0 120Z", "qty": 10, "material": "S235", "thicknessMm": 10},
    ],
    "sheets": [{"id": "s1", "material": "S235", "thicknessMm": 10, "lengthMm": 2000, "widthMm": 1000, "qty": None, "source": "stock",
                "trims": {"xMinus": 5, "xPlus": 5, "yMinus": 5, "yPlus": 5}, "partGapMm": 5}],
}
s, run = call(o, "POST", "/api/nest", req)
ok(s in (200, 202) and run.get("id"), f"a fast nest starts ({s} {run})")
t0 = time.time()
while run.get("state") in ("queued", "running") and time.time() - t0 < 240:
    time.sleep(2)
    s, run = call(o, "GET", f"/api/nest/{run['id']}")
res = run.get("result") or {}
print(f"     state={run.get('state')} after {time.time() - t0:.0f} s, error={run.get('error')}")
ok(run.get("state") == "done", "the nest runs to the end")
sheets = res.get("sheets") or []
placed = sum((res.get("nested") or {}).values())
ok(res.get("valid") is True and placed == 20, f"all 20 parts placed, no overlaps ({len(sheets)} sheets, {placed} parts)")

s, u = call(o, "POST", "/api/users", {"name": "Alex", "password": "", "isAdmin": False})
ok(s in (200, 201), f"the admin adds a user without a password ({s} {u})")

o2 = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))   # another browser
s, b = call(o2, "POST", "/api/auth/signin", {"name": "alex", "password": ""})
ok(s == 200, f"Alex signs in by name only ({s} {b})")
s, b = call(o2, "PUT", "/api/settings/machines", {"value": []})
ok(s == 403, f"Alex may not change the machines ({s})")
s, b = call(o2, "POST", "/api/auth/signin", {"name": "Admin", "password": "wrong"})
ok(s == 401, "a wrong password is refused")

s, _ = call(o2, "POST", "/api/auth/signout")
s, _ = call(o2, "GET", "/api/nest/status")
ok(s == 401, "after signing out the API is closed again")
print("all good")
