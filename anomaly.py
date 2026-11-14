#!/usr/bin/env python3
"""
FireGlobe - anomaly highlighting (initial version)

Flags "unusual" burning activity: a grid cell whose detection count in a given
month/year is far from that same cell's own baseline for that calendar month
(its local seasonal "normal").

Pipeline
    FIRMS CSVs -> 0.5 deg cells by (year, month, cell) -> baseline per cell+month
    -> robust z-score -> dataset/anomalies.json

Method (kept simple and explainable)
    * Baseline = MEDIAN of the same cell and calendar month in all OTHER years
      (leave-one-out, so an extreme year cannot hide itself in its own baseline).
    * Spread   = 1.4826 * MAD, floored by a Poisson-like sqrt(median) term so
      that cells with 2-3 baseline years don't get absurd z-scores.
    * Score    = (count - baseline) / spread.
    * Flagged when |score| >= --z, plus minimum-size and ratio guards to avoid
      flagging tiny absolute changes (e.g. 1 -> 3 detections).
    * Only (year, month) pairs that actually exist in the input count as
      "zero"; months with no data at all are treated as missing, not as 0.

Usage
    python anomaly.py
    python anomaly.py --dataset dataset --out dataset/anomalies.json \
                      --min-conf nominal --z 3 --min-baseline-years 3
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

CONF_RANK = {"any": 0, "nominal": 1, "high": 2}

# 1. Read + harmonize
def confidence_bucket(series: pd.Series, is_viirs: bool) -> pd.Series:
    """Shared scale: 0 low, 1 nominal, 2 high (same rules as the README)."""
    if is_viirs:
        return (series.astype(str).str.strip().str.lower()
                .map({"l": 0, "n": 1, "h": 2}).fillna(1).astype("int8"))
    c = pd.to_numeric(series, errors="coerce")
    return pd.cut(c, [-1, 29, 79, 101], labels=[0, 1, 2]).astype("float").fillna(1).astype("int8")


def aggregate_csvs(dataset: Path, cell: float, min_conf: int, sensor: str) -> pd.DataFrame:
    """Stream all CSVs -> DataFrame[year, month, ilat, ilon, count]."""
    files = sorted(dataset.rglob("*.csv"))
    if not files:
        raise SystemExit(f"No CSV files found under {dataset}/")
    parts = []
    for f in files:
        header = pd.read_csv(f, nrows=0).columns
        is_viirs = "bright_ti4" in header          # README: bright_ti4 => VIIRS
        if sensor == "modis" and is_viirs or sensor == "viirs" and not is_viirs:
            continue
        cols = ["latitude", "longitude", "acq_date", "confidence"]
        for chunk in pd.read_csv(f, usecols=cols, chunksize=500_000,
                                 dtype={"confidence": "string"}):
            if min_conf:
                chunk = chunk[confidence_bucket(chunk["confidence"], is_viirs) >= min_conf]
            d = pd.to_datetime(chunk["acq_date"], errors="coerce")
            g = pd.DataFrame({
                "year": d.dt.year, "month": d.dt.month,
                "ilat": np.floor((chunk["latitude"] + 90) / cell).astype("int32"),
                "ilon": np.floor((chunk["longitude"] + 180) / cell).astype("int32"),
            }).dropna()
            parts.append(g.groupby(["year", "month", "ilat", "ilon"]).size().rename("count"))
        print(f"  read {f.name}")
    out = pd.concat(parts).groupby(level=[0, 1, 2, 3]).sum().reset_index()
    return out.astype({"year": "int16", "month": "int8"})


# 2. Detect
def detect(df: pd.DataFrame, z_thr: float, min_years: int, min_count: int,
           min_ratio: float) -> pd.DataFrame:
    covered = set(zip(df["year"], df["month"]))          # months present in the data
    years = sorted(df["year"].unique())

    wide = df.pivot_table(index=["ilat", "ilon", "month"], columns="year",
                          values="count", aggfunc="sum")
    wide = wide.reindex(columns=years)
    # Missing = 0 only where the dataset actually covers that year+month.
    for (idx_month), sub_idx in wide.groupby(level="month").groups.items():
        for y in years:
            if (y, idx_month) in covered:
                wide.loc[sub_idx, y] = wide.loc[sub_idx, y].fillna(0)
    arr = wide.to_numpy(dtype="float64")                 # NaN = no coverage
    idx = wide.index.to_frame(index=False)

    rows = []
    for j, y in enumerate(years):
        x = arr[:, j]
        others = np.delete(arr, j, axis=1)
        n_base = np.sum(~np.isnan(others), axis=1)
        with np.errstate(all="ignore"):
            med = np.nanmedian(others, axis=1)
            mad = np.nanmedian(np.abs(others - med[:, None]), axis=1)
        spread = np.maximum(1.4826 * mad, np.sqrt(np.maximum(med, 1.0)))
        z = (x - med) / spread
        ratio = (x + 1) / (med + 1)

        ok = ~np.isnan(x) & (n_base >= min_years)
        high = ok & (z >= z_thr) & (x >= min_count) & (ratio >= min_ratio)
        low = ok & (z <= -z_thr) & (med >= min_count) & (ratio <= 1 / min_ratio)
        for mask, kind in ((high, "high"), (low, "low")):
            sel = np.where(mask)[0]
            if sel.size:
                rows.append(pd.DataFrame({
                    "year": y, "month": idx["month"].to_numpy()[sel],
                    "ilat": idx["ilat"].to_numpy()[sel], "ilon": idx["ilon"].to_numpy()[sel],
                    "count": x[sel].astype(int), "baseline": med[sel],
                    "z": z[sel], "type": kind,
                }))
    if not rows:
        return pd.DataFrame(columns=["year", "month", "ilat", "ilon", "count",
                                     "baseline", "z", "type"])
    return pd.concat(rows, ignore_index=True)


# 3. Export
def export(an: pd.DataFrame, cell: float, args, out: Path):
    an = an.copy()
    an["lat"] = (an["ilat"] * cell - 90 + cell / 2).round(3)
    an["lon"] = (an["ilon"] * cell - 180 + cell / 2).round(3)
    an["severity"] = an["z"].abs().round(2)
    an = an.sort_values("severity", ascending=False)

    by_period = (an.groupby(["year", "month", "type"]).size()
                   .rename("cells").reset_index().to_dict("records"))
    payload = {
        "meta": {"cell_deg": cell, "z_threshold": args.z, "min_conf": args.min_conf,
                 "min_baseline_years": args.min_baseline_years,
                 "min_count": args.min_count, "min_ratio": args.min_ratio,
                 "sensor": args.sensor, "n_anomalies": int(len(an)),
                 "method": "leave-one-out median/MAD z-score per cell+calendar month"},
        "by_period": by_period,
        # compact rows: [year, month, lat, lon, count, baseline, z, 1=high/0=low]
        "anomalies": [[int(r.year), int(r.month), r.lat, r.lon, int(r.count),
                       round(float(r.baseline), 1), round(float(r.z), 2),
                       1 if r.type == "high" else 0] for r in an.itertuples()],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"Wrote {out} ({len(an):,} anomalies)")
    print(an.head(10)[["year", "month", "lat", "lon", "count", "baseline", "z", "type"]]
          .to_string(index=False))


def main():
    p = argparse.ArgumentParser(description="FireGlobe anomaly highlighting")
    p.add_argument("--dataset", default="dataset")
    p.add_argument("--out", default="dataset/anomalies.json")
    p.add_argument("--cell", type=float, default=0.5, help="grid size in degrees")
    p.add_argument("--min-conf", choices=CONF_RANK, default="any")
    p.add_argument("--sensor", choices=["all", "modis", "viirs"], default="all")
    p.add_argument("--z", type=float, default=3.0, help="robust z threshold")
    p.add_argument("--min-baseline-years", type=int, default=3)
    p.add_argument("--min-count", type=int, default=10,
                   help="min detections (high) / min baseline (low) to flag")
    p.add_argument("--min-ratio", type=float, default=2.0,
                   help="min fold-change vs baseline")
    args = p.parse_args()

    print("Aggregating detections...")
    df = aggregate_csvs(Path(args.dataset), args.cell, CONF_RANK[args.min_conf], args.sensor)
    print(f"{len(df):,} cell-month records, years: {sorted(df['year'].unique())}")
    an = detect(df, args.z, args.min_baseline_years, args.min_count, args.min_ratio)
    export(an, args.cell, args, Path(args.out))


if __name__ == "__main__":
    main()