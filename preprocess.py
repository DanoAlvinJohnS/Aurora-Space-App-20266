#!/usr/bin/env python3
"""Run once:  python3 -m pip install -r requirements.txt  &&  python3 preprocess.py
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
KEEP = {'latitude', 'longitude', 'acq_date', 'confidence', 'daynight'}

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
overlap_counts = np.zeros((2, 3), np.uint64)        # (sensor, confidence bucket), shared years only
add = lambda a, co, ix: a.__iadd__(np.bincount(co * a.shape[1] + ix, minlength=a.size).reshape(a.shape))
rows = 0

for f in sorted((root / 'dataset').rglob('*.csv')):
    head = [c.strip().lower() for c in pd.read_csv(f, nrows=0).columns]
    sen = 1 if 'bright_ti4' in head else 0           # 0 MODIS, 1 VIIRS
    print('reading', f.name, flush=True)
    for ch in pd.read_csv(f, chunksize=2_000_000, dtype=str, usecols=lambda c: c.strip().lower() in KEEP, on_bad_lines='skip'):
        ch.columns = [c.strip().lower() for c in ch.columns]
        num = lambda s: pd.to_numeric(s, errors='coerce').to_numpy()
        la, lo = num(ch.latitude), num(ch.longitude)
        yr, mo = num(ch.acq_date.str[:4]) - Y0, num(ch.acq_date.str[5:7]) - 1
        with np.errstate(invalid='ignore'):
            ok = np.isfinite(la) & np.isfinite(lo) & (yr >= 0) & (yr < NYR) & (mo >= 0) & (mo < 12)
        if 'confidence' in ch:
            raw = ch.confidence.fillna('h'); cn = num(raw)
            letter = raw.str.strip().str.lower().str[:1].map({'l': 0, 'n': 1, 'h': 2}).fillna(2).to_numpy()
            with np.errstate(invalid='ignore'):
                cb = np.where(np.isnan(cn), letter, np.where(cn < 30, 0, np.where(cn < 80, 1, 2)))
        else:
            cb = np.full(len(ch), 2)
        dn = (ch.daynight.str.strip().str.upper().str[:1] == 'N').to_numpy() if 'daynight' in ch else np.zeros(len(ch), bool)
        shared = ok & (yr >= 2012 - Y0)
        if shared.any():
            overlap_counts[sen] += np.bincount(cb[shared].astype(np.int64), minlength=3).astype(np.uint64)
        la, lo, yr, mo, cb, dn = la[ok], lo[ok], yr[ok].astype(np.int64), mo[ok].astype(np.int64), cb[ok].astype(np.int64), dn[ok].astype(np.int64)
        cell = np.clip(((90 - la) * 2).astype(np.int64), 0, NY - 1) * NX + np.clip(((lo + 180) * 2).astype(np.int64), 0, NX - 1)
        u, n = np.unique(((yr * 2 + sen) * 3 + cb) * NC + cell, return_counts=True)
        dense[u] += n.astype(np.uint32)
        co = cc[cell].astype(np.int64); m = co != 255
        add(cy[:, :, sen], co[m], yr[m]); add(cm[:, :, sen], co[m], mo[m])
        add(cd[:, :, sen], co[m], dn[m]); add(cs, co[m], np.full(m.sum(), sen))
        rows += int(ok.sum()); print(f'  {rows:,} detections', end='\r', flush=True)
    print()

nz = np.flatnonzero(dense).astype(np.uint32)
if not len(nz): raise SystemExit('No valid rows found in ./dataset')
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
scales = []
for minimum in range(3):
    modis = int(overlap_counts[0, minimum:].sum())
    viirs = int(overlap_counts[1, minimum:].sum())
    scales.append(modis / viirs if modis and viirs else 1.0)
overlap = dict(startYear=2012, counts=overlap_counts.tolist(), scales=scales,
               available=bool(overlap_counts[0].sum() and overlap_counts[1].sum()))
json.dump(dict(stamp=int(time.time()), n=int(len(nz)), bytes=len(blob), nx=NX, ny=NY, y0=Y0,
               years=[Y0 + ya, Y0 + yb], rows=rows, countries=cos, overlap=overlap),
          open(root / 'dataset' / 'fire.json', 'w'))
print(f'done: {rows:,} detections -> {len(nz):,} records, {len(blob) / 1e6:.1f} MB')
