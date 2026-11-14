#!/usr/bin/env python3
"""Download NASA FIRMS active-fire CSVs (MODIS + VIIRS) into ./dataset/raw for preprocess.py.

Usage:   python download_firms.py                      (uses the settings below)
         python download_firms.py --start 2015 --end 2025
         python download_firms.py --sources MODIS_SP VIIRS_SNPP_SP

Already-downloaded files are skipped, so you can stop and re-run any time.
Needs only the Python standard library.
"""
import argparse, datetime as dt, json, os, pathlib, sys, time, urllib.request

# ---- your settings -------------------------------------------------------
MAP_KEY = os.environ.get('FIRMS_MAP_KEY', 'f4c6b9a3bb03523241e4d26df77ac661')   # keep out of GitHub!
START_YEAR, END_YEAR = 2020, 2025
# Each year is ~73 requests per sensor. MODIS goes back to 2000, VIIRS S-NPP to 2012, NOAA-20 to 2018.
# --------------------------------------------------------------------------

STEP = 5                                    # days per request (FIRMS area API limit)
API = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'
SOURCES = {                                 # archive source -> first date with data
    'MODIS_SP': dt.date(2000, 11, 1),
    'VIIRS_SNPP_SP': dt.date(2012, 1, 20),
    'VIIRS_NOAA20_SP': dt.date(2018, 1, 1),
}
OUT = pathlib.Path(__file__).resolve().parent / 'dataset' / 'raw'


def fetch(url, dest, tries=3):
    """Download to dest; only keep it if it looks like a real FIRMS CSV."""
    part = dest.with_suffix('.part')
    for t in range(1, tries + 1):
        try:
            with urllib.request.urlopen(url, timeout=300) as r, open(part, 'wb') as f:
                while True:
                    b = r.read(1 << 20)
                    if not b: break
                    f.write(b)
            with open(part, 'rb') as f:
                if f.readline().lower().startswith(b'latitude'):
                    part.replace(dest); return True
            err = 'unexpected reply'
        except Exception as e:
            err = str(e)
        part.unlink(missing_ok=True)
        if t < tries:
            print(f'    retry {t}: {err}', flush=True); time.sleep(10 * t)
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--start', type=int, default=START_YEAR)
    ap.add_argument('--end', type=int, default=END_YEAR)
    ap.add_argument('--key', default=MAP_KEY)
    ap.add_argument('--sources', nargs='+', default=list(SOURCES), choices=list(SOURCES))
    a = ap.parse_args()

    try:
        with urllib.request.urlopen(f'https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY={a.key}', timeout=30) as r:
            print('Key status:', json.dumps(json.loads(r.read())))
    except Exception as e:
        print(f'Could not check key status (continuing): {e}')

    today, failed = dt.date.today(), []
    print(f'Downloading {a.start}-{a.end} to {OUT}\n')
    for name in a.sources:
        folder = OUT / name; folder.mkdir(parents=True, exist_ok=True)
        d = max(dt.date(a.start, 1, 1), SOURCES[name])
        end = min(dt.date(a.end, 12, 31), today)
        total = (end - d).days // STEP + 1
        print(f'=== {name}: {d} to {end} ===')
        for i in range(1, total + 1):
            dest = folder / f'{name}_{d:%Y%m%d}.csv'
            if dest.exists():
                print(f'[{i}/{total}] {d}  already have')
            else:
                src = name.replace('_SP', '_NRT') if (today - d).days < 100 else name   # recent days: near-real-time
                url = f'{API}/{a.key}/{src}/world/{STEP}/{d}'
                if fetch(url, dest):
                    print(f'[{i}/{total}] {src} {d}  {dest.stat().st_size / 1e6:.1f} MB', flush=True)
                else:
                    print(f'[{i}/{total}] {src} {d}  FAILED', flush=True); failed.append(url)
            d += dt.timedelta(days=STEP)
        print()

    if failed:
        print(f'{len(failed)} request(s) failed. Re-run this script to retry them:')
        for u in failed: print('  ', u.replace(a.key, '<KEY>'))
        sys.exit(1)
    print('All downloads finished. Next: python run.py')


if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: print('\nStopped. Re-run to continue where you left off.')
