# FireGlobe

**An interactive 3D globe of global burning activity, harmonizing MODIS and VIIRS active-fire hotspots into one consistent picture.**

Built for the **NASA Space Apps Challenge: "Harmonization of MODIS and VIIRS Hot Spots"**.

> Everything runs in the browser. No backend, no accounts, and your data never leaves your computer.

This repository includes a lightweight project scaffold and a clear local setup path so the concept can be opened and developed without committing the large FIRMS datasets.

---

## Table of contents

- [FireGlobe](#fireglobe)
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
  - [Performance and low-end devices](#performance-and-low-end-devices)
  - [Limitations](#limitations)
  - [Roadmap (progression)](#roadmap-progression)

---

## The idea

Satellites have tracked active fires for more than two decades, but the record is split across sensors (MODIS and VIIRS) whose files use different confidence scales and brightness columns, so they cannot be compared directly. That leaves fire managers without one consistent picture of **when and where burning has occurred**.

FireGlobe merges both records into a single, easy-to-read **burning activity map**. You start with the whole planet, then drill into a country, its history, and the specific locations that burn most.

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

**Takeaways:** most tools are real-time, 2D, and either crowded or paid. FireGlobe focuses on the **historical, harmonized** view in an intuitive **3D** interface that stays simple until you ask for detail.

## Proposed solutions

**Solution 1: Interactive 3D globe (implemented here).**
Think "Google Earth with wildfire-prone areas". Deeper color means a more fire-prone area.

**Solution 2: RTS-style game (concept, not implemented).**
The player builds wildfire relief and prevention buildings and technology (optionally RTS + roguelike, RPG Maker style), as a way to engage people with fire-prevention concepts.

## Features

### Overview (first)
- **Land-attributed heat map** of burning activity: detections without a country assignment are excluded, keeping the heat focused on mapped land.
- **Hexagon 3D** view: Globe.gl's H3 hexagonal prisms rise from the globe; their height and color show intensity.
- **Raised hotspots** view: the original merged point markers, shown separately from the hexagon columns.
- **Animated** grow-in when activity appears, and as the year changes.
- Only three numbers are shown: **country mean, highest, lowest**. Highest and lowest are also labeled on the globe.
- Time slider with **Play** and a **Cumulative** toggle to watch history build up.

### Selected country (then specific)
Click a country and every other country fades to grey. A panel with three tabs opens:

| Tab | Contents |
|---|---|
| **Statistics** | Total detections, peak year, busiest month, MODIS/VIIRS split, day/night split; VIIRS values are marked as MODIS-equivalent when normalized |
| **History** | Per-year chart (click a bar to jump to that year) and seasonality by month |
| **Locations** | The 8 busiest ~100 km areas; click anywhere in the country to see that spot's yearly history |

### Options
- Lighting: **Day / Night / Live** (real-time sun position from UTC)
- Sensor toggles: MODIS, VIIRS
- Optional VIIRS-to-MODIS overlap normalization using the shared 2012+ period
- Minimum confidence: Any / Nominal and high / High only
- Area size: Wide (~110 km) / Fine (~55 km)
- Area-of-interest selection by drawing a region on the globe; the selected region is applied to search results and can be cleared from View settings
- Country search
- **Low-end mode** (auto-detected, can be toggled)

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
5. **Render.** Globe.gl renders the heat map with a narrow Gaussian density kernel, hexagons with its H3 bin layer, and raised hotspots as merged point markers. Heat-map smoothing can still extend slightly past coastlines.

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

# 2. Install the preprocessing requirements
python3 -m pip install -r requirements.txt

# 3. Build the compact summary (once; re-run when CSVs change)
python3 preprocess.py

# 4. Serve the folder and open it
python3 -m http.server
# visit http://localhost:8000
```

```bash
# Sequence
DL Dataset > Preprocess Dataset > Run app
Do on terminal ng vscode

# 1. Download datasets
python download_firms.py
python download_firms.py --start 2015 --end 2025
python download_firms.py --sources MODIS_SP VIIRS_SNPP_SP

# 2. Preprocess
python preprocess.py

# 3. Run
python run.py
```

On Windows, if `python3` is not available, use `python` instead:

```powershell
python -m pip install -r requirements.txt
python preprocess.py
python -m http.server
```

The page needs `dataset/fire.bin` and `dataset/fire.json`. If they are missing, first add the FIRMS CSVs and run the preprocessing command. `preprocess.py` searches recursively, so subfolders are supported. `make_manifest.py` is an optional helper that writes a list of CSV paths to `dataset/manifest.json`; preprocessing does not require that manifest.

`preprocess.py` creates or replaces both generated files; `dataset/fire.bin` is not a script that should be run separately. When the app is opened through the local server, the browser automatically loads `dataset/fire.json` and `dataset/fire.bin`. If those files already exist and the CSV data has not changed, skip preprocessing and serve the folder directly:

```bash
python3 -m http.server
```

Run `python3 preprocess.py` again whenever the FIRMS CSV files change. This refreshes `fire.bin` and `fire.json`, and the app loads the refreshed files after you reload the page.

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
├── requirements.txt    # Python packages for preprocessing
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

## Performance and low-end devices

- Heavy work happens **once** in preprocessing; the browser loads a compact binary summary.
- Aggregations are memoized per setting; the cache is bounded to limit memory use. Raised-hotspot grow-in uses a few updates instead of rebuilding the scene every frame.
- Heat-map KDE is capped at **2,000 input points**. **Low-end mode** (auto-on for ≤ 4 CPU cores or ≤ 4 GB RAM) also caps hexagon and hotspot inputs at 2,000; standard mode allows up to 6,000.
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
- [x] Animation and low-end optimization
- [x] Sensor-overlap normalization using the shared 2012+ period (requires both sensors in the input data)
- [ ] Anomaly highlighting ("unusual conditions" vs. a location's baseline)
- [x] Area-of-interest selection finer than country (draw a region)
- [ ] Potential **fire-spread** view when a hotspot ignites
- [ ] Local **vegetation and terrain** context around hotspots
- [ ] Export (CSV / image) for reports
