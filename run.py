#!/usr/bin/env python3
"""One-step launcher for FireGlobe.   Usage:  python run.py   (or double-click)

  1. checks Python packages (offers to install them)
  2. makes sure assets/countries.geojson exists (downloads it if missing)
  3. builds dataset/fire.bin + fire.json with preprocess.py when missing or older than the CSVs
  4. starts a local web server and opens the browser

Options:  --rebuild  force preprocessing    --port N  choose a port    --no-browser
"""
import argparse, importlib.util, pathlib, subprocess, sys, threading, urllib.request, webbrowser
import http.server, socketserver, functools

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / 'dataset'
GEO = ROOT / 'assets' / 'countries.geojson'
GEO_URL = 'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson'
PKGS = {'numpy': 'numpy', 'pandas': 'pandas', 'shapely': 'shapely>=2.0'}

def say(m): print(f'[FireGlobe] {m}', flush=True)

def ensure_packages():
    missing = [p for m, p in PKGS.items() if importlib.util.find_spec(m) is None]
    if not missing: return
    say('Missing Python packages: ' + ', '.join(missing))
    if input('Install them now? (Y/n) ').strip().lower() in ('', 'y', 'yes'):
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', *missing])
    else:
        sys.exit('Install them with:  pip install numpy pandas "shapely>=2.0"')

def ensure_countries():
    if GEO.exists(): return
    say('assets/countries.geojson not found, downloading Natural Earth countries ...')
    GEO.parent.mkdir(exist_ok=True)
    try:
        GEO.write_bytes(urllib.request.urlopen(GEO_URL, timeout=60).read())
    except Exception as e:
        sys.exit(f'Could not download it ({e}).\nPut a countries GeoJSON at {GEO} and run again.')

def build_if_needed(force):
    bin_, js = DATA / 'fire.bin', DATA / 'fire.json'
    csvs = list(DATA.rglob('*.csv'))
    if bin_.exists() and js.exists() and not force:
        if not csvs or max(c.stat().st_mtime for c in csvs) <= min(bin_.stat().st_mtime, js.stat().st_mtime):
            say('Dataset summary is up to date.'); return True
        say('CSV files are newer than fire.bin, rebuilding ...')
    elif not csvs:
        say('No FIRMS CSV files in dataset/ and no fire.bin / fire.json yet.')
        say('Run download_firms.bat (or put MODIS/VIIRS CSVs in dataset/) and run this again.')
        return False
    ensure_packages(); ensure_countries()
    subprocess.check_call([sys.executable, str(ROOT / 'preprocess.py')], cwd=ROOT)
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
    if build_if_needed(a.rebuild): serve(a.port, not a.no_browser)
    else: sys.exit(1)
