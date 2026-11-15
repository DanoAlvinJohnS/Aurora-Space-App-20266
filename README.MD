# TeraFlare

**An interactive 3D globe of global burning activity, harmonizing MODIS and VIIRS active-fire hotspots into one consistent picture.**

Built for the **NASA Space Apps Challenge: "Harmonization of MODIS and VIIRS Hot Spots"**.

> Everything runs in the browser. No backend, no accounts, and your data never leaves your computer.

This repository includes a lightweight project scaffold and a clear local setup path so the concept can be opened and developed without committing the large FIRMS datasets.

---

## Table of contents

- [TeraFlare](#teraflare)
  - [Table of contents](#table-of-contents)
  - [The idea](#the-idea)
  - [Goal](#goal)
  - [Challenge background](#challenge-background)
  - [Research: existing tools](#research-existing-tools)
  - [Proposed solutions](#proposed-solutions)
  - [Features](#features)
    - [Overview (first)](#overview-first)
    - [Selected country (then specific)](#selected-country-then-specific)
    - [Options](#options)
  - [How it works](#how-it-works)
  - [Dataset](#dataset)
  - [Getting started](#getting-started)
  - [Project structure](#project-structure)
  - [Performance](#performance)
  - [Limitations](#limitations)
  - [Roadmap (progression)](#roadmap-progression)

---

## The idea

Satellites have tracked active fires for more than two decades, but the record is split across sensors (MODIS and VIIRS) whose files use different confidence scales and brightness columns, so they cannot be compared directly. That leaves fire managers without one consistent picture of **when and where burning has occurred**.

TeraFlare merges both records into a single, easy-to-read **burning activity map**. You start with the whole planet, then drill into a country, its history, and the specific locations that burn most.

## Goal

Give **emergency responders, scientists and land managers** a clear way to:

- see where burning (wildfires *and* agricultural burns detectable by satellite) is concentrated,
- examine **historical patterns** and **seasonality** (the burning-activity "calendar"),
- spot **unusual or critical periods** within a selected area of interest,
- guide monitoring and early-warning efforts.

Design principle: **overall first, then specific.** No information overload; details appear only after the user chooses a country.

## Challenge background

From NASA:

> Understanding how burning activity is distributed across our planet over time, including wildfires and agricultural burns intense enough to be detected by satellite sensors, enables us to anticipate critical periods, guide monitoring efforts, and improve fire response. Satellites have tracked active fire hotspots for more than two decades, but the record is split across sensors whose data cannot be compared directly, leaving fire managers without a consistent picture of when and where burning has occurred. Your challenge is to build a web application that harmonizes these records into a burning activity calendar based on active fire hotspots, enabling early warning and emergency responders, scientists, and land managers to examine historical fire patterns, unusual conditions, and critical periods within a selected area of interest.

## Research: existing tools

| Tool | What it does | Gap we saw |
|---|---|---|
| [WatchDuty](https://www.watchduty.org/) | Real-time wildfire and flood alerts; air, wind and precipitation insights; satellite-based fire plotting | Real-time focus, 2D map |
| [DisasterAWARE](https://www.disasteraware.com/monitoring-wildfires-with-disasteraware) | Real-time wildfire monitoring; plots fire radiative points showing location and intensity | Real-time focus, 2D map |
| [Greenpeace Global Fire Dashboard](https://maps.greenpeace.org/fire_dashboard/) | Hotspots for wildfires; closest to our initial idea | Information overload; UI not intuitive; 2D map |
| [EOS Land Viewer](https://eos.com/wildfire-detection-and-monitoring/) | Forest health and wildfire-risk monitoring | Pay-to-use; 2D map |

**Takeaways:** most tools are real-time, 2D, and either crowded or paid. TeraFlare focuses on the **historical, harmonized** view in an intuitive **3D** interface that stays simple until you ask for detail.

## Proposed solutions

**Solution 1: Interactive 3D globe (implemented here).**
Think "Google Earth with wildfire-prone areas". Deeper color means a more fire-prone area.

**Solution 2: RTS-style game (concept, not implemented).**
The player builds wildfire relief and prevention buildings and technology (optionally RTS + roguelike, RPG Maker style), as a way to engage people with fire-prevention concepts.

## Features

### Overview (first)
- Only the **land-attributed heat map** is shown before a country is selected.
- Three numbers: **country mean, highest, lowest**; highest and lowest are labeled on the globe.
- Time slider with **Play** and a **Cumulative** toggle, under the location pill at the bottom of the globe.

### Selected country (then specific)
Click a country: the others fade, **region/province outlines** appear colored by burning frequency, **3D hexagons** (top 1 / 10 / 25 / 50 / 100 % of hotspots, 10 % by default, set in Advanced settings) rise on top of the heat map, and a panel opens:

| Tab | Contents |
|---|---|
| **Statistics** | Overall total and average per region; the top 1-3 burning **regions** (you choose how many) and the lowest; highest, lowest and average **temperature** with region names; peak year and busiest month |
| **History** | Buttons for **Per year**, **Seasonality** or **Both** (side by side). Each chart can be drawn as vertical bars, horizontal bars, a line or a pie. Below: busiest **named regions**; click a region or anywhere in the country for its yearly history and temperature |

Region names come from Natural Earth admin-1 boundaries, loaded on first country selection from `assets/admin1.geojson` if present, otherwise from a CDN. Temperature comes from `dataset/temp.json`, written by `preprocess.py` (re-run `python run.py --rebuild` once).

Branding: **Powerr** for the TeraFlare wordmark, **Bricolage Grotesque** for headings and numbers, **Figtree** for body text and details (both from Google Fonts), plus the TeraFlare logos from `assets/`.

### Options
- Lighting: **Day / Night / Live** (real-time sun position from UTC)
- Sensor toggles: MODIS, VIIRS
- Optional VIIRS-to-MODIS overlap normalization using the shared 2012+ period
- Minimum confidence: Any / Nominal and high / High only
- Area size: Wide (~110 km) / Fine (~55 km)
- Country search

## How it works

```
FIRMS CSVs ──► preprocess.py ──► fire.bin + fire.json ──► browser (globe.gl / three.js)
 (MODIS+VIIRS)   (run once)       (compact summary)        aggregates, animates, renders
```

1. **Preprocess (once).** `preprocess.py` streams every FIRMS CSV in chunks and bins detections into **0.5° cells** by `(year, sensor, confidence bucket, cell)`. Each cell is assigned to a country using the Natural Earth polygons, with a second pass to snap coastal cells to the nearest country. Per-country yearly, monthly, day/night and sensor totals are stored too.
2. **Harmonize.** Both sensors are put on one shared confidence scale:
   - MODIS numeric confidence (0–100): `< 30` low, `30–79` nominal, `≥ 80` high.
   - VIIRS letter ratings: `l` low, `n` nominal, `h` high.
   - Sensors are auto-detected from the column headers (`bright_ti4` means VIIRS).
   - When both sensors have detections in 2012 or later, the optional overlap adjustment computes a global VIIRS weight for each confidence filter: MODIS detections in the shared period divided by VIIRS detections in that same period. The weight is applied to VIIRS counts in the map and country/location summaries.
3. **Load.** The browser downloads `fire.bin` once and caches it (Cache API); later visits load instantly.
4. **Aggregate.** One pass over the summary per setting, memoized, produces the grid shown as a heat map, H3 hexagonal prisms, or raised hotspots. Cells without a Natural Earth country assignment are omitted from the map layers.
5. **Render.** The heat map first applies a weighted 3x3 neighborhood average to reduce single-cell noise, then uses an adaptive 60th-percentile floor and log-scaled contrast to emphasize local hotspots. Hexagons use Globe.gl's H3 bin layer, and raised hotspots use merged point markers. Heat-map smoothing can still extend slightly past coastlines.

## Dataset

**NASA FIRMS** (Fire Information for Resource Management System): archive active-fire detections.

The current local input set contains **MODIS active-fire detections from Terra and Aqua**. The CSV `version` field contains `6.03`, `6.2`, and `61.03`; these are the values present in the input files, not a claim that the files belong to one standardized collection.

The 974 current CSV files contain **17,872,463 rows** with acquisition dates from **2000-11-01 through 2025-12-31**, but are not a continuous annual record: the included year folders are **2000, 2002, 2004, 2005, and 2025**. The current input set contains **no VIIRS files**, so overlap normalization is implemented but unavailable until VIIRS detections from the shared 2012+ period are added. The app disables the adjustment when it cannot calculate it.

| Sensor in current input | Satellites | Coverage |
|---|---|---|
| **MODIS** | Terra, Aqua | 2000-11-01 to 2025-12-31; only 2000, 2002, 2004, 2005 and 2025 are included |
| **VIIRS** | Not present in the current input set | Add overlapping 2012+ data to enable calibration |

Columns used: `latitude`, `longitude`, `acq_date`, `confidence`, `daynight`.

Other data:
- Country boundaries: Natural Earth (`assets/countries.geojson`)
- Earth textures: [three-globe example images](https://github.com/vasturiano/three-globe) (or your own in `/assets`)

Raw CSVs are **not** committed (too large). Download them from [FIRMS](https://firms.modaps.eosdis.nasa.gov/download/) and place them in `dataset/`.

## Getting started

**Requirements:** Python 3.9+, a modern browser.

```bash
# 1. Put FIRMS MODIS and VIIRS CSVs in ./dataset (subfolders are fine)

# 2. Build the compact summary (once; re-run when CSVs change)
pip install -r requirements.txt   # run.py does this automatically
python3 preprocess.py

# 3. Serve the folder and open it
python3 -m http.server
# visit http://localhost:8000
```

The page needs `dataset/fire.bin` and `dataset/fire.json`. If they are missing, first add the FIRMS CSVs and run the preprocessing command. `preprocess.py` searches recursively, so subfolders are supported. `make_manifest.py` is an optional helper that writes a list of CSV paths to `dataset/manifest.json`; preprocessing does not require that manifest.

Optional: put higher-resolution `earth-day.jpg`, `earth-night.jpg` and `earth-topology.png` in `assets/`.

## Project structure

The repository includes a minimal working scaffold for the app and the expected data folders used by the project.

```text
.
├── README.MD           # Project overview and local setup notes
├── index.html          # Globe page, options, timeline
├── about.html          # About page
├── app.js              # Globe, heat map, hexagons, panels, animation
├── style.css           # Glass UI styling
├── preprocess.py       # FIRMS CSVs → fire.bin + fire.json
├── make_manifest.py    # Optional CSV file-list helper
├── assets/
│   └── countries.geojson
└── dataset/
    ├── INSTRUCTION.txt
    ├── (your FIRMS CSVs)
    ├── fire.bin        # generated
    └── fire.json       # generated
```

This layout keeps the generated data and source assets separate, while making the repository easier to manage without committing the large NASA FIRMS archives.

## Performance

- Heavy work happens **once** in preprocessing; the browser loads a compact binary summary.
- Aggregations are memoized per setting; the cache is bounded to limit memory use. Raised-hotspot grow-in uses a few updates instead of rebuilding the scene every frame.
- Heat-map KDE is capped at **2,000 input points**. Hexagon and hotspot inputs are capped at 6,000.
- Rendering pauses when the tab is hidden; respects `prefers-reduced-motion`.

## Limitations

Being honest about what the numbers mean:

- **Counts are detections, not burned area.** One large fire can produce many detections.
- **Sensor overlap normalization is a global count-rate adjustment, not physical equivalence.** It scales VIIRS counts by the ratio of MODIS to VIIRS detections in the shared 2012+ period (using the selected confidence threshold). It does not correct regional coverage, revisit rate, sensitivity, or VIIRS's finer resolution. Review the displayed factor and compare sensors separately where appropriate.
- The current local dataset contains MODIS only, so the overlap adjustment is disabled until overlapping VIIRS data is added.
- Data is aggregated to **0.5° cells**; cells without a country assignment are omitted from the map and its global counter. Country attribution is approximate near borders and coasts, and heat-map density smoothing can extend slightly over nearby water.
- Country polygons are low resolution, so small islands and some borders may be missing or imprecise.
- Historical only: **not** a real-time or forecasting tool.

## Roadmap (progression)

- [x] Interactive 3D globe with color-intensity hotspots
- [x] Harmonized MODIS + VIIRS summary
- [x] Historical progression (time slider, play, cumulative)
- [x] Land-attributed heat map, H3 3D hexagon columns, raised hotspot markers, country drill-down, per-location history
- [x] Animation and performance optimization
- [x] Sensor-overlap normalization using the shared 2012+ period (requires both sensors in the input data)
- [ ] Anomaly highlighting ("unusual conditions" vs. a location's baseline)
- [ ] Area-of-interest selection finer than country (draw a region)
- [ ] Potential **fire-spread** view when a hotspot ignites
- [ ] Local **vegetation and terrain** context around hotspots
- [ ] Export (CSV / image) for reports