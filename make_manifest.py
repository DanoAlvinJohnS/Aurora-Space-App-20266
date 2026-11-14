#!/usr/bin/env python3
"""Optional: list every CSV under ./dataset into dataset/manifest.json.
Use it if your web server does not show folder listings."""
import json, pathlib
root = pathlib.Path(__file__).parent / "dataset"
files = sorted(str(p.relative_to(root)) for p in root.rglob("*.csv"))
(root / "manifest.json").write_text(json.dumps(files, indent=2))
print(f"{len(files)} CSV files written to dataset/manifest.json")
