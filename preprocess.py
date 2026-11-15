#!/usr/bin/env python3
"""Run once:  pip install numpy pandas shapely  &&  python3 preprocess.py
Streams every FIRMS CSV under ./dataset in chunks (any total size, memory stays small) and writes
dataset/fire.bin + dataset/fire.json: a compact summary the browser loads in seconds.
Re-run whenever the CSV files change."""
import json, time, pathlib
import numpy as np, pandas as pd, shapely
from shapely.geometry import shape

root = pathlib.Path(__file__).parent
NX, NY = 720, 360                      # 0.5 degree cells
NC = NX * NY
Y0, NYR = 2000, 40                     # years 2000..2039
KEEP = {'latitude', 'longitude', 'acq_date', 'confidence', 'daynight', 'brightness', 'bright_ti4'}
# fire brightness temperature (Kelvin) per 1-degree cell: MODIS `brightness`, VIIRS `bright_ti4`
TX, TY = 360, 180
tsum = np.zeros(TX * TY); tcnt = np.zeros(TX * TY); tmin = np.full(TX * TY, np.inf); tmax = np.full(TX * TY, -np.inf)

# ---- country of every cell (computed once, stored in the file) ----
feats = json.load(open(root / 'assets' / 'countries.geojson'))['features']
geoms = [shape(f['geometry']) for f in feats]
NCO = len(geoms)
X = np.tile(-180 + (np.arange(NX) + .5) / 2, NY)
Y = np.repeat(90 - (np.arange(NY) + .5) / 2, NX)
cc = np.full(NC, 255, np.uint8)
for pad in (0, .25):                   # second pass: snap coastal cells to the nearest country
    for i, g in enumerate(geoms):
        x0, y0, x1, y1 = g.bounds
        todo = np.flatnonzero((cc == 255) & (X >= x0 - pad) & (X <= x1 + pad) & (Y >= y0 - pad) & (Y <= y1 + pad))
        if len(todo):
            hit = shapely.contains_xy(g.buffer(pad) if pad else g, X[todo], Y[todo])
            cc[todo[hit]] = i
print('countries assigned to cells')

dense = np.zeros(NYR * 6 * NC, np.uint32)           # (year, sensor, confidence bucket, cell)
cy = np.zeros((NCO, NYR, 2), np.int64); cm = np.zeros((NCO, 12, 2), np.int64)
cd = np.zeros((NCO, 2, 2), np.int64);   cs = np.zeros((NCO, 2), np.int64)
overlap_year = np.zeros((NYR, 2, 3), np.uint64)    # (year, sensor, confidence bucket); filtered to shared years after the loop
OVERLAP_START = 2012                                # VIIRS (Suomi NPP) launched late 2011; earlier years cannot overlap
MIN_OVERLAP = 1000                                  # a year only counts as shared if EACH sensor has at least this many detections
add = lambda a, co, ix: a.__iadd__(np.bincount(co * a.shape[1] + ix, minlength=a.size).reshape(a.shape))
rows = 0


# =====================================================================================================
#  DATA SOURCES: Azure SQL tables (dbo.firms_modis / dbo.firms_viirs ...) or FIRMS CSV files in ./dataset
#  The sensor of each table/file is detected automatically, so nothing here needs editing.
#
#    python preprocess.py                 auto: Azure SQL if the AZURE_SQL_* settings exist, else the CSV files
#    python preprocess.py --source sql    force Azure SQL        (--source csv forces the CSV files)
#    python preprocess.py --tables dbo.firms_modiis,dbo.firms_viirs      skip auto-discovery
#    python preprocess.py --limit 50000   read only N rows per table (quick connection test)
#
#  Settings (environment variables, or one KEY=VALUE per line in a local .env file; .env is git-ignored):
#    AZURE_SQL_SERVER=rocketeers64   (".database.windows.net" is added automatically)
#    AZURE_SQL_DATABASE=Teraflare_Data
#    AZURE_SQL_USER=...   AZURE_SQL_PASSWORD=...        (or one AZURE_SQL_CONNECTION_STRING=...)
#  Your IP must be allowed in the Azure SQL server firewall. Needs:  pip install pyodbc  (or pymssql)
# =====================================================================================================
import os, re, sys, argparse
ap = argparse.ArgumentParser(description='Build dataset/fire.bin, fire.json and temp.json')
ap.add_argument('--source', choices=['auto', 'csv', 'sql'], default='auto')
ap.add_argument('--tables', default='', help='comma separated list, e.g. dbo.firms_modiis,dbo.firms_viirs')
ap.add_argument('--limit', type=int, default=0, help='read at most N rows per SQL table (testing)')
ARGS = ap.parse_args()

def load_env():
    f = root / '.env'
    if f.exists():
        for line in f.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1); os.environ.setdefault(k.strip(), v.strip().strip('"\''))
load_env()
def sql_configured():
    return bool(os.environ.get('AZURE_SQL_CONNECTION_STRING') or
                (os.environ.get('AZURE_SQL_SERVER') and os.environ.get('AZURE_SQL_DATABASE')))

def sensor_from_name(name):
    n = name.lower()
    if 'viirs' in n: return 1
    if 'modi' in n or 'mcd14' in n: return 0          # "modi" also matches the spelling firms_modiis
    return None

def sql_connect():
    cs = os.environ.get('AZURE_SQL_CONNECTION_STRING')
    server = os.environ.get('AZURE_SQL_SERVER', ''); db = os.environ.get('AZURE_SQL_DATABASE', '')
    user = os.environ.get('AZURE_SQL_USER', ''); pw = os.environ.get('AZURE_SQL_PASSWORD', '')
    if server and '.' not in server: server += '.database.windows.net'
    err = []
    try:
        import pyodbc
        if not cs:
            drv = sorted((d for d in pyodbc.drivers() if 'SQL Server' in d), reverse=True)
            if not drv: raise RuntimeError('no "ODBC Driver for SQL Server" installed')
            cs = (f'DRIVER={{{drv[0]}}};SERVER={server},1433;DATABASE={db};UID={user};PWD={pw};'
                  'Encrypt=yes;TrustServerCertificate=no;Connection Timeout=60')
        return pyodbc.connect(cs)
    except Exception as e:
        err.append(f'pyodbc: {e}')
    try:
        import pymssql
        return pymssql.connect(server=server, user=user, password=pw, database=db, port=1433, login_timeout=60)
    except Exception as e:
        err.append(f'pymssql: {e}')
    sys.exit('Could not connect to Azure SQL.\n  ' + '\n  '.join(err) +
             '\nCheck AZURE_SQL_* settings, that your IP is allowed in the server firewall, and pip install pyodbc (or pymssql).')

def sql_chunks(size=500_000):
    con = sql_connect(); cur = con.cursor()
    cur.execute("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'")
    found = [(a, b) for a, b in cur.fetchall()]
    if ARGS.tables:
        want = [t.strip().strip('[]') for t in ARGS.tables.split(',') if t.strip()]
        tabs = []
        for t in want:
            sch, _, nm = t.rpartition('.'); sch = sch.strip('[]') or 'dbo'
            hit = [x for x in found if x[0].lower() == sch.lower() and x[1].lower() == nm.strip('[]').lower()]
            if not hit: sys.exit(f'Table {t} not found. Tables in this database: ' + ', '.join(f'{a}.{b}' for a, b in found))
            tabs.append(hit[0])
    else:
        tabs = [x for x in found if sensor_from_name(x[1]) is not None]
    if not tabs: sys.exit('No MODIS/VIIRS tables found. Tables in this database: ' + ', '.join(f'{a}.{b}' for a, b in found))
    sens = {sensor_from_name(b) for a, b in tabs}
    if sens == {0}: print('WARNING: only MODIS tables found, calibration will be off.')
    if sens == {1}: print('WARNING: only VIIRS tables found, calibration will be off.')
    for sch, nm in tabs:
        sen = sensor_from_name(nm)
        cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '%s' AND TABLE_NAME = '%s'"
                    % (sch.replace("'", "''"), nm.replace("'", "''")))
        cols = {c[0].strip().lower(): c[0] for c in cur.fetchall()}
        if not {'latitude', 'longitude', 'acq_date'} <= set(cols):
            sys.exit(f'{sch}.{nm} has columns {list(cols.values())}. Expected latitude, longitude, acq_date ...\n'
                     'If they are named Prop_0, Prop_1 ..., re-run the Data Factory copy with "First row as header" enabled.')
        if sen is None: sen = 1 if 'bright_ti4' in cols else 0
        q = lambda k: '[' + cols[k].replace(']', ']]') + ']'
        sel = [f'TRY_CAST({q("latitude")} AS float) AS latitude', f'TRY_CAST({q("longitude")} AS float) AS longitude',
               f'CONVERT(varchar(10), {q("acq_date")}, 23) AS acq_date']
        if 'confidence' in cols: sel.append(f'CAST({q("confidence")} AS varchar(20)) AS confidence')
        if 'daynight' in cols: sel.append(f'CAST({q("daynight")} AS varchar(5)) AS daynight')
        for b in ('brightness', 'bright_ti4'):
            if b in cols: sel.append(f'TRY_CAST({q(b)} AS float) AS {b}')
        top = f'TOP {int(ARGS.limit)} ' if ARGS.limit else ''
        cur.execute(f'SELECT {top}' + ', '.join(sel) + f' FROM [{sch}].[{nm}]')
        names = [d[0].lower() for d in cur.description]
        label = f'{sch}.{nm} ({"VIIRS" if sen else "MODIS"})'
        while True:
            batch = cur.fetchmany(size)
            if not batch: break
            yield label, sen, pd.DataFrame([tuple(r) for r in batch], columns=names)
    con.close()

def csv_chunks():
    for f in sorted((root / 'dataset').rglob('*.csv')):
        head = [c.strip().lower() for c in pd.read_csv(f, nrows=0).columns]
        sen = sensor_from_name(f.name)
        if sen is None: sen = 1 if 'bright_ti4' in head else 0           # 0 MODIS, 1 VIIRS
        for ch in pd.read_csv(f, chunksize=2_000_000, dtype=str, usecols=lambda c: c.strip().lower() in KEEP, on_bad_lines='skip'):
            yield f.name, sen, ch

sql_used = False
def chunks():
    global sql_used
    use_sql = ARGS.source == 'sql' or (ARGS.source == 'auto' and sql_configured())
    sql_used = use_sql
    print('source:', 'Azure SQL' if use_sql else 'CSV files in ./dataset', flush=True)
    return sql_chunks() if use_sql else csv_chunks()

prev = None
for label, sen, ch in chunks():
    if label != prev:
        if prev is not None: print()
        print('reading', label, flush=True); prev = label
    ch.columns = [c.strip().lower() for c in ch.columns]
    num = lambda s: pd.to_numeric(s, errors='coerce').to_numpy()
    la, lo = num(ch.latitude), num(ch.longitude)
    yr, mo = num(ch.acq_date.str[:4]) - Y0, num(ch.acq_date.str[5:7]) - 1
    with np.errstate(invalid='ignore'):
        ok = np.isfinite(la) & np.isfinite(lo) & (yr >= 0) & (yr < NYR) & (mo >= 0) & (mo < 12)
    if 'confidence' in ch:
        raw = ch.confidence.fillna('h').astype(str); cn = num(raw)
        letter = raw.str.strip().str.lower().str[:1].map({'l': 0, 'n': 1, 'h': 2}).fillna(2).to_numpy()
        with np.errstate(invalid='ignore'):
            cb = np.where(np.isnan(cn), letter, np.where(cn < 30, 0, np.where(cn < 80, 1, 2)))
    else:
        cb = np.full(len(ch), 2)
    dn = (ch.daynight.str.strip().str.upper().str[:1] == 'N').to_numpy() if 'daynight' in ch else np.zeros(len(ch), bool)
    if ok.any():                                # per-year tally; the shared-year filter is applied once all files are read
        idx = (yr[ok].astype(np.int64) * 2 + sen) * 3 + cb[ok].astype(np.int64)
        overlap_year += np.bincount(idx, minlength=NYR * 6).reshape(NYR, 2, 3).astype(np.uint64)
    bcol = 'bright_ti4' if sen else 'brightness'
    br = num(ch[bcol]) if bcol in ch else np.full(len(ch), np.nan)
    la, lo, yr, mo, cb, dn = la[ok], lo[ok], yr[ok].astype(np.int64), mo[ok].astype(np.int64), cb[ok].astype(np.int64), dn[ok].astype(np.int64)
    br = br[ok]
    t1 = np.clip((90 - la).astype(np.int64), 0, TY - 1) * TX + np.clip((lo + 180).astype(np.int64), 0, TX - 1)
    v = np.isfinite(br) & (br > 200) & (br < 600)
    if v.any():
        tcnt += np.bincount(t1[v], minlength=TX * TY); tsum += np.bincount(t1[v], weights=br[v], minlength=TX * TY)
        np.minimum.at(tmin, t1[v], br[v]); np.maximum.at(tmax, t1[v], br[v])
    cell = np.clip(((90 - la) * 2).astype(np.int64), 0, NY - 1) * NX + np.clip(((lo + 180) * 2).astype(np.int64), 0, NX - 1)
    u, n = np.unique(((yr * 2 + sen) * 3 + cb) * NC + cell, return_counts=True)
    dense[u] += n.astype(np.uint32)
    co = cc[cell].astype(np.int64); m = co != 255
    add(cy[:, :, sen], co[m], yr[m]); add(cm[:, :, sen], co[m], mo[m])
    add(cd[:, :, sen], co[m], dn[m]); add(cs, co[m], np.full(m.sum(), sen))
    rows += int(ok.sum()); print(f'  {rows:,} detections', end='\r', flush=True)
if prev is not None: print()

nz = np.flatnonzero(dense).astype(np.uint32)
if not len(nz): raise SystemExit('No valid rows found (check the source, the date column and the table contents)')
lay = nz // NC; ya, yb = int((lay // 6).min()), int((lay // 6).max())
blob = nz.tobytes() + dense[nz].tobytes() + cc.tobytes()
(root / 'dataset' / 'fire.bin').write_bytes(blob)
def pt(g):
    g = max(g.geoms, key=lambda p: p.area) if hasattr(g, 'geoms') else g
    return g.representative_point()
cos = []
for i, (f, g) in enumerate(zip(feats, geoms)):
    y_by_sensor = cy[i, ya:yb + 1, :].T
    m_by_sensor = cm[i, :, :].T
    dn_by_sensor = cd[i, :, :].T
    cos.append(dict(
        name=(f['properties'].get('NAME') or f['properties'].get('ADMIN')),
        lat=round(pt(g).y, 2), lng=round(pt(g).x, 2),
        y=y_by_sensor.sum(axis=0).tolist(), m=m_by_sensor.sum(axis=0).tolist(),
        dn=dn_by_sensor.sum(axis=0).tolist(), s=cs[i].tolist(),
        ys=y_by_sensor.tolist(), ms=m_by_sensor.tolist(), dns=dn_by_sensor.tolist()))
tn = np.flatnonzero(tcnt)
json.dump(dict(nx=TX, ny=TY, unit='K', cells=tn.tolist(), min=np.round(tmin[tn], 1).tolist(), max=np.round(tmax[tn], 1).tolist(),
               mean=np.round(tsum[tn] / tcnt[tn], 1).tolist(), n=tcnt[tn].astype(int).tolist()), open(root / 'dataset' / 'temp.json', 'w'))
# ---- MODIS/VIIRS harmonisation: scale VIIRS to MODIS using ONLY years where both sensors really have data ----
yrs_all = np.arange(NYR) + Y0
tot = overlap_year.sum(axis=2)                                   # (year, sensor)
shared_mask = (yrs_all >= OVERLAP_START) & (tot[:, 0] >= MIN_OVERLAP) & (tot[:, 1] >= MIN_OVERLAP)
shared_years = [int(y) for y in yrs_all[shared_mask]]
print('\nDetections per year (rows kept by the build):')
print(f"  {'year':<6}{'MODIS':>14}{'VIIRS':>14}  shared")
for i in np.flatnonzero(tot.sum(axis=1)):
    print(f"  {int(yrs_all[i]):<6}{int(tot[i, 0]):>14,}{int(tot[i, 1]):>14,}  {'yes' if shared_mask[i] else ''}")
overlap_counts = overlap_year[shared_mask].sum(axis=0)            # (sensor, confidence bucket)
scales = []
for minimum in range(3):
    modis = int(overlap_counts[0, minimum:].sum())
    viirs = int(overlap_counts[1, minimum:].sum())
    scales.append(modis / viirs if modis and viirs else 1.0)
overlap = dict(startYear=OVERLAP_START, years=shared_years, source='sql' if sql_used else 'csv', minPerYear=MIN_OVERLAP, counts=overlap_counts.tolist(), scales=scales,
               available=bool(shared_years))
if shared_years:
    print(f'overlap calibration uses shared years {shared_years}: VIIRS scaled x{scales[0]:.3f} to match MODIS')
else:
    print('WARNING: no year has >= %d detections from BOTH MODIS and VIIRS; calibration disabled, raw counts used.' % MIN_OVERLAP)
    print('         MODIS per year:', {int(y): int(n) for y, n in zip(yrs_all, tot[:, 0]) if n})
    print('         VIIRS per year:', {int(y): int(n) for y, n in zip(yrs_all, tot[:, 1]) if n})
json.dump(dict(stamp=int(time.time()), n=int(len(nz)), bytes=len(blob), nx=NX, ny=NY, y0=Y0,
               years=[Y0 + ya, Y0 + yb], rows=rows, countries=cos, overlap=overlap),
          open(root / 'dataset' / 'fire.json', 'w'))
print(f'done: {rows:,} detections -> {len(nz):,} records, {len(blob) / 1e6:.1f} MB')
