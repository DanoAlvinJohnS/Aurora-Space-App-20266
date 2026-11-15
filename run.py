#!/usr/bin/env python3
"""One-step launcher for TeraFlare.   Usage:  python run.py   (or double-click)

  1. installs the pip requirements automatically (requirements.txt)
  2. makes sure assets/countries.geojson exists (downloads it if missing)
  3. builds dataset/fire.bin + fire.json with preprocess.py when missing or older than the CSVs
  4. starts a local web server and opens the browser

Options:  --rebuild  force preprocessing    --port N  choose a port    --no-browser
"""
import argparse, os, importlib, importlib.util, pathlib, subprocess, sys, threading, urllib.request, webbrowser
import http.server, socketserver, functools

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / 'dataset'
GEO = ROOT / 'assets' / 'countries.geojson'
GEO_URL = 'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson'
PKGS = {'numpy': 'numpy', 'pandas': 'pandas', 'shapely': 'shapely>=2.0'}

def say(m): print(f'[TeraFlare] {m}', flush=True)

def ensure_packages():
    """Install anything from requirements.txt that is missing or too old (no prompt)."""
    from importlib import metadata
    need = {'numpy': (1, 20), 'pandas': (1, 3), 'shapely': (2, 0)}   # shapely 2 is needed for contains_xy
    bad = []
    for name, minv in need.items():
        try:
            v = tuple(int(x) for x in metadata.version(name).split('.')[:2] if x.isdigit())
            if v < minv: bad.append(name)
        except metadata.PackageNotFoundError:
            bad.append(name)
    if not bad:
        say('Python packages OK.'); return
    say('Installing requirements: ' + ', '.join(bad))
    req = ROOT / 'requirements.txt'
    if not req.exists():                                               # recreate it if it was deleted
        req.write_text('numpy>=1.20\npandas>=1.3\nshapely>=2.0\n')
    cmd = [sys.executable, '-m', 'pip', 'install', '-r', str(req)]
    for extra in ([], ['--user'], ['--break-system-packages']):      # fall back for locked-down Pythons
        if subprocess.call(cmd + extra) == 0: break
    else:
        sys.exit('pip install failed. Try manually:  pip install -r requirements.txt')
    importlib.invalidate_caches()

def ensure_countries():
    if GEO.exists(): return
    say('assets/countries.geojson not found, downloading Natural Earth countries ...')
    GEO.parent.mkdir(exist_ok=True)
    try:
        GEO.write_bytes(urllib.request.urlopen(GEO_URL, timeout=60).read())
    except Exception as e:
        sys.exit(f'Could not download it ({e}).\nPut a countries GeoJSON at {GEO} and run again.')

def sql_configured():
    vals = dict(os.environ); env = ROOT / '.env'
    if env.exists():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.strip().startswith('#'):
                k, v = line.split('=', 1); vals.setdefault(k.strip(), v.strip())
    return bool(vals.get('AZURE_SQL_CONNECTION_STRING') or (vals.get('AZURE_SQL_SERVER') and vals.get('AZURE_SQL_DATABASE')))

def build_if_needed(force):
    bin_, js = DATA / 'fire.bin', DATA / 'fire.json'
    csvs = list(DATA.rglob('*.csv'))
    if bin_.exists() and js.exists() and (DATA / 'temp.json').exists() and not force:
        if sql_configured() or not csvs or max(c.stat().st_mtime for c in csvs) <= min(bin_.stat().st_mtime, js.stat().st_mtime):
            say('Dataset summary is up to date' + (' (use --rebuild to re-read Azure SQL).' if sql_configured() else '.')); return True
        say('CSV files are newer than fire.bin, rebuilding ...')
    elif not csvs and not sql_configured():
        say('No FIRMS CSV files in dataset/ and no fire.bin / fire.json yet.')
        say('Run download_firms.bat (or put MODIS/VIIRS CSVs in dataset/) and run this again.')
        return False
    ensure_countries()
    subprocess.check_call([sys.executable, str(ROOT / 'preprocess.py')], cwd=ROOT)   # reads Azure SQL if configured, else the CSVs
    return True

def serve(port, browser):
    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
        def end_headers(self):
            if self.path.split('?')[0].endswith(('.html', '.js', '.json', '.css')): self.send_header('Cache-Control', 'no-cache')
            super().end_headers()
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    for p in range(port, port + 20):
        try: srv = socketserver.ThreadingTCPServer(('127.0.0.1', p), functools.partial(H, directory=str(ROOT))); break
        except OSError: continue
    else: sys.exit('No free port found.')
    url = f'http://localhost:{p}/'
    say(f'Serving {url}   (Ctrl+C to stop)')
    if browser: threading.Timer(.8, lambda: webbrowser.open(url)).start()
    try: srv.serve_forever()
    except KeyboardInterrupt: say('Stopped.')

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--rebuild', action='store_true')
    ap.add_argument('--port', type=int, default=8000); ap.add_argument('--no-browser', action='store_true')
    a = ap.parse_args()
    if sys.version_info < (3, 9): sys.exit('Python 3.9 or newer is required.')
    ensure_packages()                      # always, before anything else
    if build_if_needed(a.rebuild): serve(a.port, not a.no_browser)
    else: sys.exit(1)
