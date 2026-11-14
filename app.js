const $ = s => document.querySelector(s);

/* ---------- settings ---------- */
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CDN = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/';
// Put your own higher-resolution maps in /assets (earth-day.jpg, earth-night.jpg, earth-topology.png)
const TEX = {
  day:   ['assets/earth-day.jpg', CDN + 'earth-day.jpg', CDN + 'earth-blue-marble.jpg'],
  night: ['assets/earth-night.jpg', CDN + 'earth-night.jpg'],
  topo:  ['assets/earth-topology.png', CDN + 'earth-topology.png'],
};
const STOPS = [[255,224,138],[255,138,26],[214,18,40],[122,0,25]];
const ATMO = { day: '#7db4ff', night: '#4d5f9a', live: '#6c9cf5' };

let ref = 1, timer = null, raf = 0, drawTimer = null, sel = -1;
let lite = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 8) <= 4;   // low-end guess, user can toggle
let tab = 'stats', loc = null, view = 'heat', gf = 0, prev = new Map(), cur = [], rk = [], anim = 0;
const HEX_LIMIT = 6000, LOW_HEX_LIMIT = 2000, HEAT_LIMIT = 2000;
let light = 'live', mat = null, T = null, sun = { lat: 0, lng: 0 };
let aoi = null, aoiDrawing = false, aoiStart = null, countryFeatures = [], aoiAutoRotate = false;

/* ---------- globe: one merged mesh for all columns, country polygons on top ---------- */
const globe = Globe()($('#globe'))
  .backgroundImageUrl(CDN + 'night-sky.png')
  .showAtmosphere(true).atmosphereAltitude(0.2).atmosphereColor(ATMO.live)
  .pointLat('lat').pointLng('lng').pointAltitude('alt').pointColor('col').pointRadius('r')
  .pointResolution(6).pointsMerge(true)
  .heatmapsData([]).heatmapPointLat('lat').heatmapPointLng('lng').heatmapPointWeight('weight')
  .heatmapBandwidth(1.5).heatmapColorSaturation(1.5).heatmapBaseAltitude(.006).heatmapTopAltitude(.008)
  .heatmapsTransitionDuration(0)
  .hexBinPointsData([]).hexBinPointLat('lat').hexBinPointLng('lng').hexBinPointWeight('weight')
  .hexMargin(.08).hexAltitude(({ sumWeight }) => .003 + .12 * level(sumWeight))
  .hexTopColor(({ sumWeight }) => color(sumWeight))
  .hexSideColor(({ sumWeight }) => colorL(level(sumWeight) * .55))
  .hexBinMerge(true).hexTransitionDuration(0)
  .labelLat('lat').labelLng('lng').labelText('text').labelColor('color').labelSize(.9).labelDotRadius(.35).labelAltitude(.012).labelResolution(2)
  .ringColor(() => t => `rgba(255,200,80,${1 - t})`).ringMaxRadius(2.5).ringPropagationSpeed(1.5).ringRepeatPeriod(1400)
  .onPointClick(p => p && locAt(p.lat, p.lng))
  .polygonAltitude(0.004).polygonSideColor(() => 'rgba(0,0,0,0)').polygonsTransitionDuration(0)
  .onPolygonClick((p, _e, c) => p && !p.__aoi && (p.__i === sel && c ? locAt(c.lat, c.lng) : pick(p.__i)));

globe.controls().autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches && !lite;
globe.controls().autoRotateSpeed = 0.4;
const fit = () => { globe.renderer().setPixelRatio(lite ? 1 : Math.min(devicePixelRatio || 1, 1.5)); globe.width(innerWidth).height(innerHeight); };
addEventListener('resize', fit); fit();

function level(w) {
  const scale = Math.log1p(ref);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(scale) || scale <= 0) return 0;
  return Math.max(0, Math.min(1, Math.log1p(w) / scale));
}
const fmt = value => Math.round(value).toLocaleString();
const color = w => colorL(level(w));
function colorL(l) {
  const value = Number.isFinite(l) ? Math.max(0, Math.min(1, l)) : 0;
  const x = value * (STOPS.length - 1), i = Math.min(Math.floor(x), STOPS.length - 2), f = x - i;
  return `rgb(${STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f))})`;
}

/* ---------- earth: sharp textures + day / night / live-sun shader ---------- */
const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
uniform sampler2D dayTex, nightTex, topoTex;
uniform vec2 sun;        // sub-solar latitude, longitude (radians)
uniform float mode;      // 0 night, 1 day, 2 live
uniform float relief;
varying vec2 vUv;
void main(){
  float lng = (vUv.x * 2.0 - 1.0) * 3.14159265;
  float lat = (vUv.y - 0.5) * 3.14159265;
  float cosz = sin(lat) * sin(sun.x) + cos(lat) * cos(sun.x) * cos(lng - sun.y);

  vec3 day = texture2D(dayTex, vUv).rgb;
  float h = (texture2D(topoTex, vUv + vec2(0.0008, 0.0)).r - texture2D(topoTex, vUv - vec2(0.0008, 0.0)).r);
  day *= clamp(1.0 + h * relief, 0.8, 1.2);

  vec3 night = texture2D(nightTex, vUv).rgb;
  vec3 nightCol = night * 1.25 + day * 0.035;

  vec3 dayCol = day;
  float k = mode;
  if (mode > 1.5) {
    k = smoothstep(-0.10, 0.10, cosz);
    dayCol = day * mix(0.55, 1.0, smoothstep(0.0, 0.55, cosz));
    dayCol += vec3(1.0, 0.42, 0.15) * exp(-pow(cosz / 0.09, 2.0)) * 0.14;   // warm twilight band
  }
  gl_FragColor = vec4(mix(nightCol, dayCol, k), 1.0);
}`;

function loadImage(urls) {
  return new Promise((res, rej) => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) return rej(new Error('texture not found'));
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => res(im); im.onerror = next; im.src = urls[i++];
    };
    next();
  });
}

async function initEarth() {
  try { T = await import('https://esm.sh/three'); } catch (e) { console.warn('three.js module unavailable, using plain textures', e); }
  if (T) {
    try {
      const [d, n, t] = await Promise.all([loadImage(TEX.day), loadImage(TEX.night), loadImage(TEX.topo).catch(() => null)]);
      const aniso = globe.renderer().capabilities.getMaxAnisotropy();
      const tex = im => { const x = new T.Texture(im); x.anisotropy = aniso; x.needsUpdate = true; return x; };
      mat = new T.ShaderMaterial({
        uniforms: {
          dayTex: { value: tex(d) }, nightTex: { value: tex(n) }, topoTex: { value: tex(t || d) },
          relief: { value: t ? 4.0 : 0.0 }, sun: { value: new T.Vector2() }, mode: { value: 2 },
        },
        vertexShader: VERT, fragmentShader: FRAG,
      });
      globe.globeMaterial(mat);
    } catch (e) { console.warn('Shader earth failed, using plain textures', e); mat = null; }
  }
  if (!mat) {                                            // fallback: plain images, no live lighting
    globe.bumpImageUrl(CDN + 'earth-topology.png');
    $('[data-mode="live"]').disabled = true;
    if (light === 'live') light = 'night';
  }
  setLighting(light);
}

function sunPos(date) {                                  // sub-solar point from UTC time
  const rad = Math.PI / 180, d = date / 86400000 - 10957.5;      // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, e = (23.439 - 3.6e-7 * d) * rad;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15;
  let lng = ra / rad - gmst; lng = ((lng % 360) + 540) % 360 - 180;
  return { lat: dec / rad, lng };
}

function updateSun() {
  const now = new Date(); sun = sunPos(now);
  if (mat) mat.uniforms.sun.value.set(sun.lat * Math.PI / 180, sun.lng * Math.PI / 180);
  const f = (v, a, b) => `${Math.abs(v).toFixed(0)} deg ${v >= 0 ? a : b}`;
  $('#clock').textContent = `${now.toISOString().slice(11, 16)} UTC - sun is overhead near ${f(sun.lat, 'N', 'S')}, ${f(sun.lng, 'E', 'W')}`;
}

function setLighting(m) {
  light = m;
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m));
  globe.atmosphereColor(ATMO[m]);
  if (mat) mat.uniforms.mode.value = { night: 0, day: 1, live: 2 }[m];
  else globe.globeImageUrl(m === 'day' ? TEX.day[1] : TEX.night[1]);
  const live = m === 'live';
  $('#clock').hidden = $('#sunbtn').hidden = !live;
  if (live) updateSun();
}
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => setLighting(b.dataset.mode));
$('#sunbtn').onclick = () => { updateSun(); globe.controls().autoRotate = false; globe.pointOfView({ lat: sun.lat, lng: sun.lng, altitude: 2.2 }, 1200); };
setInterval(() => { if (light === 'live') updateSun(); }, 15000);

/* ---------- prepared dataset (made once by preprocess.py, cached in the browser) ---------- */
let M, N, NC, CELL, YR, SN, CB, CNT, CC, countries = [];
const GM = {}, memo = new Map();

async function getBin() {
  const url = 'dataset/fire.bin?v=' + M.stamp;
  try { const hit = await (await caches.open('fireglobe')).match(url); if (hit) return { buf: await hit.arrayBuffer(), cached: true }; } catch (e) { /* no cache here */ }
  const res = await fetch(url); if (!res.ok) throw new Error('fire.bin');
  const len = +res.headers.get('content-length') || M.bytes, rd = res.body.getReader(), parts = []; let got = 0;
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    parts.push(value); got += value.length;
    $('#lbar').style.width = Math.min(100, got / len * 100) + '%';
    $('#ldetail').textContent = `${(got / 1e6).toFixed(0)} of ${(len / 1e6).toFixed(0)} MB (first visit only)`;
  }
  const buf = await new Blob(parts).arrayBuffer();
  try { const c = await caches.open('fireglobe'); for (const k of await c.keys()) await c.delete(k); await c.put(url, new Response(buf)); } catch (e) { /* ignore */ }
  return { buf, cached: false };
}

async function boot() {
  $('#loading').hidden = false;
  const t0 = performance.now();
  let cached = false;
  try {
    const mr = await fetch('dataset/fire.json', { cache: 'no-cache' });
    if (!mr.ok) throw new Error('fire.json');
    M = await mr.json(); N = M.n; NC = M.nx * M.ny; countries = M.countries;
    const r = await getBin(); cached = r.cached;
    const key = new Uint32Array(r.buf, 0, N);
    CNT = new Uint32Array(r.buf, 4 * N, N); CC = new Uint8Array(r.buf, 8 * N, NC);
    CELL = new Uint32Array(N); YR = new Uint8Array(N); SN = new Uint8Array(N); CB = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const k = key[i], l = (k / NC) | 0; CELL[i] = k - l * NC; YR[i] = (l / 6) | 0; SN[i] = ((l / 3) | 0) & 1; CB[i] = l % 3; }
    let gj; try { gj = await (await fetch('assets/countries.geojson')).json(); }
    catch (e) { gj = await (await fetch('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')).json(); }
    gj.features.forEach((f, i) => f.__i = i);
    countryFeatures = gj.features;
    paint(); globe.polygonsData(countryFeatures);
  } catch (e) {
    console.warn(e);
    $('#lmsg').innerHTML = 'Prepared data not found. Put your FIRMS CSVs in <b>/dataset</b>, run <code>python3 preprocess.py</code> once, then serve this folder (for example <code>python3 -m http.server</code>) and reload.';
    $('.progress').hidden = true; return;
  }
  const yr = $('#year'); yr.min = M.years[0]; yr.max = M.years[1]; yr.value = M.years[1];
  $('#meta').textContent = `${M.rows.toLocaleString()} detections, ${cached ? 'loaded from cache' : 'downloaded'} in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  $('#loading').hidden = true;
  ['#controls', '#timeline'].forEach(s => $(s).hidden = false);
  configureOverlap();
  $('#lite').checked = lite; if (lite) $('#res').value = '2'; setView(view);
  detail(); draw();
}

/* ---------- aggregation: one pass over the summary, memoised per setting ---------- */
const gmap = res => GM[res] || (GM[res] = (() => {
  const W = M.nx / res, a = new Uint32Array(NC);
  for (let c = 0; c < NC; c++) { const iy = (c / M.nx) | 0, ix = c - iy * M.nx; a[c] = ((iy / res) | 0) * W + ((ix / res) | 0); }
  return a;
})());

function overlapCount(sensor, minimum) {
  const counts = M.overlap && M.overlap.counts && M.overlap.counts[sensor];
  return counts ? counts.slice(minimum).reduce((sum, n) => sum + n, 0) : 0;
}
function overlapAvailable() {
  return overlapCount(0, 0) > 0 && overlapCount(1, 0) > 0;
}
function normalizationOn() {
  return $('#normalize').checked && overlapAvailable();
}
function overlapScale(minimum = 0) {
  if (!normalizationOn()) return 1;
  const modis = overlapCount(0, minimum), viirs = overlapCount(1, minimum);
  return modis && viirs ? modis / viirs : 1;
}
function updateOverlapStatus() {
  const control = $('#normalize'), status = $('#normstatus');
  if (!overlapAvailable()) {
    control.checked = false;
    control.disabled = true;
    status.textContent = 'Unavailable: add both MODIS and VIIRS detections from 2012 or later.';
    return;
  }
  control.disabled = false;
  const minimum = +$('#conf').value, modis = overlapCount(0, minimum), viirs = overlapCount(1, minimum);
  if (!modis || !viirs) {
    status.textContent = 'No overlap at this confidence level; raw counts are used for this filter.';
  } else if (control.checked) {
    status.textContent = `VIIRS scaled by ${overlapScale(minimum).toFixed(3)} using ${modis.toLocaleString()} MODIS and ${viirs.toLocaleString()} VIIRS detections from 2012+.`;
  } else {
    status.textContent = 'Normalization is off; raw detection counts are shown.';
  }
}
function configureOverlap() {
  const control = $('#normalize');
  control.checked = overlapAvailable();
  updateOverlapStatus();
}
function countryMetrics(country) {
  const scale = overlapScale(0);
  const combine = (bySensor, fallback) => bySensor
    ? bySensor[0].map((n, i) => n + (bySensor[1][i] || 0) * scale)
    : fallback;
  const years = combine(country.ys, country.y);
  const months = combine(country.ms, country.m);
  const dayNight = country.dns
    ? [country.dns[0][0] + country.dns[1][0] * scale, country.dns[0][1] + country.dns[1][1] * scale]
    : country.dn;
  return {
    years,
    months,
    dayNight,
    total: years.reduce((sum, n) => sum + n, 0),
    modis: country.s[0],
    viirs: country.s[1] * scale,
  };
}

function cellInAoi(cell) {
  const iy = (cell / M.nx) | 0, ix = cell - iy * M.nx;
  const lat = 90 - (iy + .5) * 180 / M.ny;
  const lng = -180 + (ix + .5) * 360 / M.nx;
  return lat >= aoi.south && lat <= aoi.north && lng >= aoi.west && lng <= aoi.east;
}

function agg() {
  const res = sel >= 0 ? 1 : +$('#res').value, end = +$('#year').value - M.y0, cum = $('#cum').checked, mc = +$('#conf').value;
  const s0 = $('#modis').checked, s1 = $('#viirs').checked, scale = overlapScale(mc);
  const k = [res, sel, end, +cum, mc, +s0, +s1, scale, aoi ? `${aoi.south},${aoi.west},${aoi.north},${aoi.east}` : ''].join();
  let r = memo.get(k); if (r) { ref = r.ref; return r; }
  const map = gmap(res), W = M.nx / res, grid = new Float32Array(W * (M.ny / res));
  const cellCounts = new Float32Array(NC), cs = new Float64Array(countries.length);
  let total = 0;
  for (let i = 0; i < N; i++) {
    const y = YR[i]; if (y > end || (!cum && y !== end) || CB[i] < mc || !(SN[i] ? s1 : s0)) continue;
    const c = CNT[i] * (SN[i] ? scale : 1), cell = CELL[i], o = CC[cell];
    if (o === 255) continue;
    if (aoi && !cellInAoi(cell)) continue;
    cs[o] += c;
    if (sel >= 0 && o !== sel) continue;
    total += c;
    cellCounts[cell] += c;
  }
  const positionWeights = new Float32Array(grid.length), positionCells = new Uint32Array(grid.length);
  for (let cell = 0; cell < NC; cell++) {
    const count = cellCounts[cell]; if (!count) continue;
    const g = map[cell]; grid[g] += count;
    if (count > positionWeights[g]) { positionWeights[g] = count; positionCells[g] = cell; }
  }
  let mx = 1; for (let g = 0; g < grid.length; g++) if (grid[g] > mx) mx = grid[g];
  ref = mx; const pts = [];
  for (let g = 0; g < grid.length; g++) {
    const v = grid[g]; if (!v) continue;
    const cell = positionCells[g], iy = (cell / M.nx) | 0, ix = cell - iy * M.nx;
    pts.push({ lat: 90 - (iy + .5) * 180 / M.ny, lng: -180 + (ix + .5) * 360 / M.nx, v, i: g });
  }
  pts.sort((a, b) => a.v - b.v); r = { pts, total, cs, res, ref }; memo.set(k, r); if (memo.size > 20) memo.delete(memo.keys().next().value);
  return r;
}
function hexLimit() {
  return lite ? LOW_HEX_LIMIT : HEX_LIMIT;
}
function apply(e) {
  const limit = view === 'heat' ? HEAT_LIMIT : hexLimit();
  const src = cur.length > limit ? cur.slice(-limit) : cur;
  const points = src.map(q => {
    const p = prev.get(q.i), weight = (p ? p.v : 0) + (q.v - (p ? p.v : 0)) * e;
    return { lat: q.lat, lng: q.lng, weight, i: q.i };
  });
  if (view === 'heat') {
    globe.pointsData([]).hexBinPointsData([]);
    globe.heatmapsData(points.length ? [points] : []);
    return;
  }
  globe.heatmapsData([]);
  if (view === 'hex') {
    globe.pointsData([]).hexBinResolution(cur.res === 2 ? 3 : 4).hexBinPointsData(points);
    return;
  }
  globe.hexBinPointsData([]);
  globe.pointsData(points.map(p => ({ lat: p.lat, lng: p.lng, alt: .005 + .14 * level(p.weight), col: colorL(level(p.weight)), r: cur.res * .22 })));
}
function run() {
  cancelAnimationFrame(anim);
  if (lite || view !== 'raised') return apply(1);
  const t0 = performance.now(); let lastFrame = -1;
  const step = t => {
    const p = Math.min(1, (t - t0) / 450), frame = Math.min(4, Math.floor(p * 4));
    if (frame > lastFrame || p === 1) { lastFrame = frame; apply(1 - (1 - p) ** 3); }
    if (p < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
function setView(v) {
  view = v;
  document.querySelectorAll('#vseg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
  if (v !== 'raised') globe.pointsData([]);
  prev = new Map(); run();
}
function draw() {
  const r = agg(), y = $('#year').value, y0 = M.years[0];
  prev = view === 'raised' && !lite ? new Map(cur.map(q => [q.i, q])) : new Map();
  cur = r.pts; cur.res = r.res; run();
  $('#count').textContent = fmt(r.total);
  $('#countlabel').textContent = normalizationOn() ? 'MODIS-equivalent detections' : 'detections shown';
  $('#yl').textContent = $('#cum').checked && +y > y0 ? `${y0}-${y}` : y;
  rk = []; countries.forEach((c, i) => r.cs[i] > 0 && rk.push([i, r.cs[i]])); rk.sort((a, b) => b[1] - a[1]);
  const L = (e, t, col) => ({ lat: countries[e[0]].lat, lng: countries[e[0]].lng, text: t + countries[e[0]].name, color: col });
  globe.labelsData(sel < 0 && rk.length > 1 ? [L(rk[0], 'Highest: ', '#ffe08a'), L(rk[rk.length - 1], 'Lowest: ', '#9fd0ff')] : []);
  list(); detail();
}
const redraw = () => {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }, 60);
};

/* ---------- countries: everything but the selected one fades to grey ---------- */
function paint() {
  const g = (gf * .8).toFixed(2);
  globe.polygonCapColor(p => p.__aoi ? 'rgba(0,0,0,0)' : p.__i === sel ? 'rgba(0,0,0,0)' : `rgba(64,64,70,${g})`)
    .polygonStrokeColor(p => p.__aoi ? '#ffb366' : p.__i === sel ? '#ffb366' : 'rgba(255,255,255,.18)');
}
function aoiFeature() {
  if (!aoi) return null;
  const { west, east, south, north } = aoi;
  return {
    __aoi: true,
    geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
    type: 'Feature',
  };
}
function renderAoi() {
  const feature = aoiFeature();
  globe.polygonsData(feature ? countryFeatures.concat(feature) : countryFeatures);
  paint();
  $('#clear-aoi').hidden = !aoi;
  $('#aoi-status').textContent = aoi
    ? `Region: ${aoi.south.toFixed(1)} to ${aoi.north.toFixed(1)} deg latitude, ${aoi.west.toFixed(1)} to ${aoi.east.toFixed(1)} deg longitude.`
    : 'Draw a rectangle on the globe to limit the search.';
}
function focusAoi() {
  const { west, east, south, north } = aoi;
  const span = Math.max(east - west, north - south);
  const altitude = Math.max(.45, Math.min(2.2, span / 70));
  globe.controls().autoRotate = false;
  globe.pointOfView({
    lat: (south + north) / 2,
    lng: (west + east) / 2,
    altitude,
  }, lite ? 0 : 900);
}
function globePoint(event) {
  const point = globe.toGlobeCoords(event.clientX, event.clientY);
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lng) ? point : null;
}
function finishAoiDraw() {
  if (!aoiDrawing) return;
  aoiDrawing = false;
  aoiStart = null;
  $('#globe').classList.remove('aoi-drawing');
  globe.controls().enabled = true;
  globe.controls().autoRotate = aoiAutoRotate;
}
function setAoi(start, end) {
  const west = Math.min(start.lng, end.lng), east = Math.max(start.lng, end.lng);
  const south = Math.min(start.lat, end.lat), north = Math.max(start.lat, end.lat);
  if (east - west < 1 || north - south < 1) {
    $('#aoi-status').textContent = 'Draw a larger rectangle to select a region.';
    return;
  }
  aoi = { west, east, south, north };
  TOP.clear();
  renderAoi();
  focusAoi();
  redraw();
}
$('#draw-aoi').onclick = () => {
  aoiDrawing = true;
  aoiStart = null;
  $('#globe').classList.add('aoi-drawing');
  $('#aoi-status').textContent = 'Drag across the globe to draw a region.';
  aoiAutoRotate = globe.controls().autoRotate;
  globe.controls().autoRotate = false;
  globe.controls().enabled = false;
};
$('#clear-aoi').onclick = () => {
  finishAoiDraw();
  aoi = null;
  TOP.clear();
  renderAoi();
  redraw();
};
$('#globe').addEventListener('pointerdown', event => {
  if (!aoiDrawing) return;
  event.preventDefault();
  event.stopPropagation();
  const point = globePoint(event);
  if (!point) return;
  aoiStart = point;
  $('#globe').setPointerCapture(event.pointerId);
}, true);
$('#globe').addEventListener('pointermove', event => {
  if (!aoiDrawing) return;
  event.preventDefault();
  event.stopPropagation();
}, true);
$('#globe').addEventListener('pointerup', event => {
  if (!aoiDrawing || !aoiStart) return;
  event.preventDefault();
  event.stopPropagation();
  const point = globePoint(event);
  if (point) setAoi(aoiStart, point);
  finishAoiDraw();
}, true);
$('#globe').addEventListener('pointercancel', event => {
  if (!aoiDrawing) return;
  event.preventDefault();
  event.stopPropagation();
  finishAoiDraw();
}, true);
function fadeTo(t) {
  if (lite) { gf = t; return paint(); }
  const a = gf, t0 = performance.now();
  const s = n => { const p = Math.min(1, (n - t0) / 450); gf = a + (t - a) * p; paint(); if (p < 1) requestAnimationFrame(s); };
  requestAnimationFrame(s);
}
function pick(i) {
  sel = i; tab = 'stats'; loc = null; globe.ringsData([]); globe.controls().autoRotate = false; fadeTo(1);
  globe.pointOfView({ lat: countries[i].lat, lng: countries[i].lng, altitude: 1.8 }, lite ? 0 : 1000);
  draw();
}
function clear() { sel = -1; loc = null; globe.ringsData([]); fadeTo(0); draw(); }

function list() {
  const q = $('#csearch').value.trim().toLowerCase(), cs = agg().cs;
  const rows = countries.map((c, i) => [i, cs[i]]).filter(([i, n]) => n > 0 && countries[i].name.toLowerCase().includes(q)).sort((a, b) => b[1] - a[1]);
  $('#clist').innerHTML = rows.map(([i, n]) => `<button class="ci${i === sel ? ' sel' : ''}" data-i="${i}"><span>${countries[i].name}</span><span class="hint">${fmt(n)}</span></button>`).join('') || '<p class="hint">No countries with detections.</p>';
}

/* ---------- panel: overview first, then Statistics / History / Locations ---------- */
const TOP = new Map(), TABS = [['stats', 'Statistics'], ['hist', 'History'], ['loc', 'Locations']];
const row = (a, b) => `<div class="evt"><span>${a}</span><span>${b}</span></div>`;
const bars = (a, f, cls, attr) => { const m = Math.max(...a) || 1; return `<div class="bars ${cls}">${a.map((n, i) => `<i ${attr ? `${attr}="${i}"` : ''} class="${n === m ? 'peak' : ''}" style="height:${Math.max(3, n / m * 100)}%" title="${f(i)}: ${n.toLocaleString()}"></i>`).join('')}</div>`; };
function tops() {                                  // busiest 1-degree areas of the selected country
  if (TOP.has(sel)) return TOP.get(sel);
  const m = new Map(), W = M.nx, H = W >> 1;
  const scale = overlapScale(0);
  for (let i = 0; i < N; i++) { const cell = CELL[i]; if (CC[cell] !== sel || (aoi && !cellInAoi(cell))) continue; const iy = (cell / W) | 0, k = (iy >> 1) * H + ((cell - iy * W) >> 1); m.set(k, (m.get(k) || 0) + CNT[i] * (SN[i] ? scale : 1)); }
  const r = [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => { const by = (k / H) | 0; return { lat: 90 - by - .5, lng: -180 + (k - by * H) + .5, n }; });
  TOP.set(sel, r); return r;
}
function locAt(lat, lng) {                         // yearly history of one specific spot
  const by = Math.floor(90 - lat), bx = Math.floor(lng + 180), W = M.nx, off = M.years[0] - M.y0, a = new Array(M.years[1] - M.years[0] + 1).fill(0);
  const scale = overlapScale(0);
  for (let i = 0; i < N; i++) { const cell = CELL[i], iy = (cell / W) | 0; if ((iy >> 1) === by && ((cell - iy * W) >> 1) === bx) a[YR[i] - off] += CNT[i] * (SN[i] ? scale : 1); }
  loc = { lat: 90 - by - .5, lng: -180 + bx + .5, a }; tab = 'loc'; globe.ringsData([loc]); detail();
}
function overview() {
  if (!rk.length) return '<p class="hint">No detections for these filters.</p>';
  const mean = rk.reduce((a, r) => a + r[1], 0) / rk.length, hi = rk[0], lo = rk[rk.length - 1];
  const t = (l, e, v) => `<button class="tile" ${e ? `data-i="${e[0]}"` : ''}><span class="hint">${l}</span><b>${v}</b><span>${e ? countries[e[0]].name : 'per country'}</span></button>`;
  return `<h3>Overview</h3><div class="tiles">${t('Mean', null, fmt(mean))}${t('Highest', hi, fmt(hi[1]))}${t('Lowest', lo, fmt(lo[1]))}</div><p class="hint">Click a country on the globe (or Highest / Lowest) to see its statistics, history and specific locations.</p>`;
}
function detail() {
  const box = $('#detail');
  if (sel < 0) { box.innerHTML = overview(); return; }
  const c = countries[sel], metrics = countryMetrics(c), y0 = M.years[0], tot = metrics.total;
  const back = '<button id="clr" class="btn ghost small inline">Back to overview</button>';
  if (!tot) { box.innerHTML = `<p class="name">${c.name}</p><p class="hint">No detections in this dataset.</p>${back}`; return; }
  const top = Math.max(...metrics.years), mt = Math.max(...metrics.months), dn = metrics.dayNight[0] + metrics.dayNight[1], yaxis = `<div class="axis"><span>${y0}</span><span>${M.years[1]}</span></div>`;
  let body;
  if (tab === 'stats') body = `<div class="stats"><div><b>${fmt(tot)}</b>detections</div><div><b>${y0 + metrics.years.indexOf(top)}</b>peak year</div><div><b>${MON[metrics.months.indexOf(mt)]}</b>busiest month</div></div>
    ${row('Shown with current filters', `<b>${fmt(agg().cs[sel])}</b>`)}    ${row(normalizationOn() ? 'MODIS / VIIRS-equivalent' : 'MODIS / VIIRS', `${fmt(metrics.modis)} / ${fmt(metrics.viirs)}`)}
    ${row('Seen by day / night', dn ? `${Math.round(metrics.dayNight[0] / dn * 100)}% / ${Math.round(metrics.dayNight[1] / dn * 100)}%` : 'N/A')}
    <p class="hint">Country totals and charts include all confidence levels${normalizationOn() ? '; VIIRS is overlap-scaled.' : '.'}</p>`;
  else if (tab === 'hist') body = `<h3>Per year (click a bar)</h3>${bars(metrics.years, i => y0 + i, '', 'data-y')}${yaxis}<h3>Seasonality</h3>${bars(metrics.months, i => MON[i], 'm')}<div class="axis months">${MON.map(m => `<span>${m[0]}</span>`).join('')}</div>`;
  else body = `<h3>Hotspot areas (about 100 km)</h3>${tops().map(p => `<button class="ci" data-l="${p.lat},${p.lng}"><span>${p.lat.toFixed(1)}, ${p.lng.toFixed(1)}</span><span class="hint">${fmt(p.n)}</span></button>`).join('') || '<p class="hint">None.</p>'}
    ${loc ? `<h3>Area ${loc.lat.toFixed(1)}, ${loc.lng.toFixed(1)} per year</h3>${bars(loc.a, i => y0 + i, '', '')}${yaxis}` : '<p class="hint">Or click anywhere inside the country to inspect that spot.</p>'}`;
  box.innerHTML = `<p class="name">${c.name}</p><div class="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>${body}${back}`;
}

/* ---------- wiring ---------- */
function activateSidebarTab(name) {
  const dashboard = name === 'dashboard';
  $('#dashboard-tab').setAttribute('aria-selected', dashboard);
  $('#settings-tab').setAttribute('aria-selected', !dashboard);
  $('#dashboard-panel').hidden = !dashboard;
  $('#settings-panel').hidden = dashboard;
}
document.querySelectorAll('.sidebar-tabs [role="tab"]').forEach(button => {
  button.onclick = () => activateSidebarTab(button.id === 'dashboard-tab' ? 'dashboard' : 'settings');
});
let expandedSidebarWidth = '';
$('#collapse').onclick = () => {
  const collapsed = $('#controls').classList.toggle('is-collapsed');
  if (collapsed) {
    expandedSidebarWidth = $('#controls').style.width;
    $('#controls').style.width = '58px';
  } else {
    $('#controls').style.width = expandedSidebarWidth;
  }
  $('#collapse').setAttribute('aria-expanded', !collapsed);
  $('#collapse').setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
};
const resizeHandle = $('#resize-handle');
function resizeSidebar(width) {
  const styles = getComputedStyle($('#controls'));
  const min = Math.max(220, parseFloat(styles.minWidth) || 0);
  const max = parseFloat(styles.maxWidth) || innerWidth;
  $('#controls').style.width = `${Math.max(min, Math.min(max, width))}px`;
}
resizeHandle.addEventListener('pointerdown', e => {
  if ($('#controls').classList.contains('is-collapsed')) return;
  e.preventDefault();
  const startX = e.clientX, startWidth = $('#controls').getBoundingClientRect().width;
  resizeHandle.setPointerCapture(e.pointerId);
  const move = event => resizeSidebar(startWidth + event.clientX - startX);
  const stop = () => {
    resizeHandle.removeEventListener('pointermove', move);
    resizeHandle.removeEventListener('pointerup', stop);
    resizeHandle.removeEventListener('pointercancel', stop);
  };
  resizeHandle.addEventListener('pointermove', move);
  resizeHandle.addEventListener('pointerup', stop);
  resizeHandle.addEventListener('pointercancel', stop);
});
resizeHandle.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    resizeSidebar($('#controls').getBoundingClientRect().width + (e.key === 'ArrowRight' ? 16 : -16));
  }
});
$('#clist').onclick = e => { const b = e.target.closest('.ci'); if (b) pick(+b.dataset.i); };
$('#csearch').addEventListener('input', list);
addEventListener('keydown', e => { if (e.key === 'Escape' && sel >= 0) clear(); });
['#modis', '#viirs', '#conf', '#cum', '#year', '#res'].forEach(s => $(s).addEventListener('input', redraw));
$('#conf').addEventListener('input', updateOverlapStatus);
$('#normalize').addEventListener('change', () => {
  TOP.clear();
  updateOverlapStatus();
  if (loc) locAt(loc.lat, loc.lng);
  redraw();
});
$('#play').onclick = () => {
  if (timer) { clearInterval(timer); timer = null; $('#play').textContent = 'Play'; return; }
  $('#play').textContent = 'Pause';
  timer = setInterval(() => { const y = $('#year'); y.value = +y.value >= +y.max ? y.min : +y.value + 1; redraw(); }, 900);
};

$('#detail').onclick = e => {
  const t = e.target.closest('[data-i],[data-t],[data-l],[data-y],#clr'); if (!t) return;
  if (t.id === 'clr') return clear();
  if (t.dataset.i) return pick(+t.dataset.i);
  if (t.dataset.t) { tab = t.dataset.t; return detail(); }
  if (t.dataset.l) { const [la, lo] = t.dataset.l.split(',').map(Number); globe.pointOfView({ lat: la, lng: lo, altitude: 1.1 }, lite ? 0 : 800); return locAt(la, lo); }
  if (t.dataset.y !== undefined) { $('#year').value = M.years[0] + +t.dataset.y; redraw(); }
};
document.querySelectorAll('#vseg button').forEach(b => b.onclick = () => setView(b.dataset.v));
$('#lite').onchange = e => { lite = e.target.checked; fit(); if (lite) globe.controls().autoRotate = false; run(); };
document.addEventListener('visibilitychange', () => document.hidden ? globe.pauseAnimation() : globe.resumeAnimation());
await initEarth();
boot();
