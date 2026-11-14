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
- **Heat map** of burning activity: soft colored blobs, deeper/redder = burns more often.
- **Animated** grow-in when activity appears, and as the year changes.
- Only three numbers are shown: **country mean, highest, lowest**. Highest and lowest are also labeled on the globe.
- **Hexagon 3D** mode: 6-sided columns whose height and color show intensity.
- Time slider with **Play** and a **Cumulative** toggle to watch history build up.

### Selected country (then specific)
Click a country and every other country fades to grey. A panel with three tabs opens:

| Tab | Contents |
|---|---|
| **Statistics** | Total detections, peak year, busiest month, MODIS/VIIRS split, day/night split |
| **History** | Per-year chart (click a bar to jump to that year) and seasonality by month |
| **Locations** | The 8 busiest ~100 km areas; click anywhere in the country to see that spot's yearly history |

### Options
- Lighting: **Day / Night / Live** (real-time sun position from UTC)
- Sensor toggles: MODIS, VIIRS
- Minimum confidence: Any / Nominal and high / High only
- Area size: Wide (~110 km) / Fine (~55 km)
- Country search
- **Low-end mode** (auto-detected, can be toggled)

## How it works

```
FIRMS CSVs ──► preprocess.py ──► fire.bin + fire.json ──► browser (globe.gl / three.js)
 (MODIS+VIIRS)   (run once)       (compact summary)        aggregates, animates, renders
```

1. **Preprocess (once).** `preprocess.py` streams every FIRMS CSV in chunks (memory stays small at any total size) and bins detections into **0.5° cells** by `(year, sensor, confidence bucket, cell)`. Each cell is assigned to a country using the Natural Earth polygons, with a second pass to snap coastal cells to the nearest country. Per-country yearly, monthly, day/night and sensor totals are stored too.
2. **Harmonize.** Both sensors are put on one shared confidence scale:
   - MODIS numeric confidence (0–100): `< 30` low, `30–79` nominal, `≥ 80` high.
   - VIIRS letter ratings: `l` low, `n` nominal, `h` high.
   - Sensors are auto-detected from the column headers (`bright_ti4` means VIIRS).
3. **Load.** The browser downloads `fire.bin` once and caches it (Cache API); later visits load instantly.
4. **Aggregate.** One pass over the summary per setting, memoized, produces the grid shown as a heat map or hexagon columns.
5. **Render.** The heat map is a single canvas texture over the globe; hexagons are one merged mesh.

## Dataset

**NASA FIRMS** (Fire Information for Resource Management System): archive active-fire detections.

| Sensor | Satellites | Notes |
|---|---|---|
| **MODIS** | Terra, Aqua | Record starts in 2000; ~1 km pixels; confidence 0–100 |
| **VIIRS** | Suomi NPP (and NOAA-20 / NOAA-21 if included) | Record starts in 2012; ~375 m pixels; confidence low / nominal / high |

> ⚠️ Fill in the exact products and date range you downloaded, e.g. `MODIS C6.1` and `VIIRS S-NPP 375 m`, years `2000–2025`.

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
pip install numpy pandas shapely
python3 preprocess.py 

# 3. Serve the folder and open it
python3 -m http.server
# visit http://localhost:8000 | Temporarily
```

The page needs `dataset/fire.bin` and `dataset/fire.json`. If they are missing, the app should show a clear message explaining how to generate them.

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
├── preprocess.py       # CSV → fire.bin + fire.json
├── download_firms.bat  # Fetch Datasets  
├── assets/
│   └── countries.geojson
└── dataset/
    ├── README.txt
    ├── (your FIRMS CSVs)
    ├── fire.bin        # generated
    └── fire.json       # generated
```

This layout keeps the generated data and source assets separate, while making the repository easier to manage without committing the large NASA FIRMS archives.

## Performance and low-end devices

- Heavy work happens **once** in preprocessing; the browser loads a compact binary summary.
- Aggregations are **memoized** per setting; animation is throttled to ~30 fps.
- **Low-end mode** (auto-on for ≤ 4 CPU cores or ≤ 4 GB RAM): lower pixel ratio, smaller heat texture, no autorotate, no animations, hexagons capped at the 3,000 strongest areas.
- Rendering pauses when the tab is hidden; respects `prefers-reduced-motion`.

## Limitations

Being honest about what the numbers mean:

- **Counts are detections, not burned area.** One large fire can produce many detections.
- **Sensors are harmonized in confidence, not in sensitivity.** VIIRS has finer resolution and typically records more detections than MODIS, so mixing them can raise apparent activity after 2012. Use the sensor toggles to compare like with like. Normalizing detection rates between sensors is future work.
- Data is aggregated to **0.5° cells** (country attribution is approximate near borders and coasts).
- Country polygons are low resolution, so small islands and some borders may be missing or imprecise.
- Historical only: **not** a real-time or forecasting tool.

## Roadmap (progression)

- [x] Interactive 3D globe with color-intensity hotspots
- [x] Harmonized MODIS + VIIRS summary
- [x] Historical progression (time slider, play, cumulative)
- [x] Heat map and 3D hexagon views, country drill-down, per-location history
- [x] Animation and low-end optimization
- [x] Automated Import CSV files using .bat
- [ ] Sensor-overlap normalization (use the shared 2012+ period to calibrate)
- [ ] Anomaly highlighting ("unusual conditions" vs. a location's baseline)
- [ ] Area-of-interest selection finer than country (draw a region)
- [ ] Potential **fire-spread** view when a hotspot ignites
- [ ] Local **vegetation and terrain** context around hotspots
- [ ] Export (CSV / image) for reports
