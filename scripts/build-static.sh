#!/usr/bin/env bash
# Deploy the browser app, its first-party JS and assets; exclude source Python/CSV.
set -euo pipefail
cd "$(dirname "$0")/.."

required=(index.html about.html app.js motion.js sans.js theme.js style.css themes.css assets/countries.geojson dataset/fire.bin dataset/fire.json)
for file in "${required[@]}"; do
  if [[ ! -s "$file" ]]; then
    echo "ERROR: Required website file missing/empty: $file" >&2
    exit 1
  fi
done

rm -rf public
mkdir -p public/assets public/dataset
cp -- *.html *.css *.js public/
cp -R -- assets/. public/assets/
cp -- dataset/fire.bin dataset/fire.json public/dataset/

# Check files that the current HTML and app.js import.
for file in index.html app.js motion.js sans.js theme.js themes.css dataset/fire.bin dataset/fire.json; do
  test -s "public/$file" || { echo "Failed to package $file" >&2; exit 1; }
done
printf 'Built static website in public/\n'