import { spring, materialize, reduced } from './motion.js';
const $ = s => document.querySelector(s);

/* ---------- settings ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CDN = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/';
// Put your own higher-resolution maps in /assets (earth-day.jpg, earth-night.jpg, earth-topology.png)
const TEX = {
  day: ['assets/earth-day.jpg', CDN + 'earth-day.jpg', CDN + 'earth-blue-marble.jpg'],
  night: ['assets/earth-night.jpg', CDN + 'earth-night.jpg'],
  topo: ['assets/earth-topology.png', CDN + 'earth-topology.png'],
};
const STOPS = [[255,224,138],[255,138,26],[214,18,40],[122,0,25]];
const ATMO = { day: '#8db4ff', night: '#3b5bc4', live: '#4a7ff8' };

let ref = 1, timer = null, raf = 0, drawTimer = null, sel = -1;
let lite = (() => { try { return localStorage.getItem('fg-lite') !== '0'; } catch (e) { return true; } })();   // low-end mode is ON by default; the choice is remembered
let tab = 'stats', loc = null, view = 'heat', gf = 0, prev = new Map(), cur = [], rk = [], anim = 0;
const HEX_LIMIT = 6000, LOW_HEX_LIMIT = 2000, HEAT_LIMIT = 1200, LOW_HEAT_LIMIT = 450;
let light = 'live', mat = null, T = null, sun = { lat: 0, lng: 0 };

/* ---------- globe: one merged mesh for all columns, country polygons on top ---------- */
const globe = Globe()($('#globe'))
  .backgroundImageUrl(CDN + 'night-sky.png')
  .showAtmosphere(true)
  .atmosphereAltitude(0.2)
  .atmosphereColor(ATMO.live)
  .pointLat('lat')
  .pointLng('lng')
  .pointAltitude('alt')
  .pointColor('col')
  .pointRadius('r')
  .pointResolution(6)
  .pointsMerge(true)
  .heatmapsData([])
  .heatmapPointLat('lat')
  .heatmapPointLng('lng')
  .heatmapPointWeight('weight')
  .heatmapBandwidth(1.5)
  .heatmapColorSaturation(1.5)
  .heatmapBaseAltitude(0.006)
  .heatmapTopAltitude(0.008)
  .heatmapsTransitionDuration(0)
  .hexBinPointsData([])
  .hexBinPointLat('lat')
  .hexBinPointLng('lng')
  .hexBinPointWeight('weight')
  .hexMargin(0.08)
  .hexAltitude(({ sumWeight }) => 0.003 + 0.12 * level(sumWeight))
  .hexTopColor(({ sumWeight }) => color(sumWeight))
  .hexSideColor(({ sumWeight }) => colorL(level(sumWeight) * 0.55))
  .hexBinMerge(true)
  .hexTransitionDuration(0)
  .labelLat('lat')
  .labelLng('lng')
  .labelText('text')
  .labelColor('color')
  .labelSize(0.9)
  .labelDotRadius(0.35)
  .labelAltitude(0.012)
  .labelResolution(2)
  .ringColor(() => (t) => `rgba(255,200,80,${1 - t})`)
  .ringMaxRadius(2.5)
  .ringPropagationSpeed(1.5)
  .ringRepeatPeriod(1400)
  .onPointClick((p) => p && locAt(p.lat, p.lng))
  .polygonAltitude(0.004)
  .polygonSideColor(() => 'rgba(0,0,0,0)')
  .polygonsTransitionDuration(0)
  .onPolygonClick(
    (p, _e, c) => p && !p.__aoi && (p.__i === sel && c ? locAt(c.lat, c.lng) : pick(p.__i))
  );

globe.controls().autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches && !lite;
globe.controls().autoRotateSpeed = 0.4;
const fit = () => { globe.renderer().setPixelRatio(lite ? 1 : Math.min(devicePixelRatio || 1, 1.5)); globe.width(innerWidth).height(innerHeight); };
addEventListener('resize', () => { fit(); updateNames(); }); fit();

/* ---------- spring camera: starts from where the globe is NOW, keeps its velocity if interrupted ---------- */
let cam = null;
function flyTo(t, instant) {
  const p = globe.pointOfView();
  const v0 = cam ? cam.velocity() : undefined;
  if (cam) { cam.stop(); cam = null; }
  if (instant || lite || reduced.v) { globe.pointOfView(t, 0); return; }
  const dl = (((t.lng - p.lng + 540) % 360) + 360) % 360 - 180;            // shortest way round the planet
  cam = spring([p.lat, p.lng, p.altitude], [t.lat, p.lng + dl, t.altitude], { response: .5, damping: 1, velocity: v0, eps: .01 },
    ([lat, lng, altitude]) => globe.pointOfView({ lat, lng, altitude }, 0), () => { cam = null; });
}
['pointerdown', 'wheel', 'touchstart'].forEach(ev => $('#globe').addEventListener(ev, () => { if (cam) { cam.stop(); cam = null; } }, { capture: true, passive: true }));   // grabbing the globe always wins

function level(w) {
  const scale = Math.log1p(ref);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(scale) || scale <= 0) return 0;
  return Math.max(0, Math.min(1, Math.log1p(w) / scale));
}
const fmt = (value) => Math.round(value).toLocaleString();
const color = (w) => colorL(level(w));
function colorL(l) {
  const value = Number.isFinite(l) ? Math.max(0, Math.min(1, l)) : 0;
  const x = value * (STOPS.length - 1),
    i = Math.min(Math.floor(x), STOPS.length - 2),
    f = x - i;
  return `rgb(${STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f))})`;
}

/* ---------- earth: sharp textures + day / night / live-sun shader ---------- */
const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
uniform sampler2D dayTex, nightTex, topoTex;
uniform vec2 sun;        // sub-solar latitude, longitude (radians)
uniform float mode;      // 0 night, 1 day, 2 live
uniform float relief;
uniform sampler2D maskTex;
uniform float maskAmt;   // 0 = normal, 1 = everything outside the selected country is blurred and darkened
varying vec2 vUv;
void main(){
  float lng = (vUv.x * 2.0 - 1.0) * 3.14159265;
  float lat = (vUv.y - 0.5) * 3.14159265;
  float mk = texture2D(maskTex, vUv).r * maskAmt, bias = mk * 4.0;
  float cosz = sin(lat) * sin(sun.x) + cos(lat) * cos(sun.x) * cos(lng - sun.y);

  vec3 day = texture2D(dayTex, vUv, bias).rgb;
  float h = (texture2D(topoTex, vUv + vec2(0.0008, 0.0)).r - texture2D(topoTex, vUv - vec2(0.0008, 0.0)).r);
  day *= clamp(1.0 + h * relief, 0.8, 1.2);

  vec3 night = texture2D(nightTex, vUv, bias).rgb;
  vec3 nightCol = night * 1.25 + day * 0.035;

  vec3 dayCol = day;
  float k = mode;
  if (mode > 1.5) {
    k = smoothstep(-0.10, 0.10, cosz);
    dayCol = day * mix(0.55, 1.0, smoothstep(0.0, 0.55, cosz));
    dayCol += vec3(1.0, 0.42, 0.15) * exp(-pow(cosz / 0.09, 2.0)) * 0.14;   // warm twilight band
  }
  vec3 col = mix(nightCol, dayCol, k);
  col = mix(col, vec3(dot(col, vec3(.3, .59, .11))), mk * .45) * mix(1.0, .3, mk);
  gl_FragColor = vec4(col, 1.0);
}`;

function loadImage(urls) {
  return new Promise((res, rej) => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) return rej(new Error('texture not found'));
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = next;
      im.src = urls[i++];
    };
    next();
  });
}

async function initEarth() {
  try {
    T = await import('https://esm.sh/three');
  } catch (e) {
    console.warn('three.js module unavailable, using plain textures', e);
  }
  if (T) {
    try {
      const [d, n, t] = await Promise.all([
        loadImage(TEX.day),
        loadImage(TEX.night),
        loadImage(TEX.topo).catch(() => null),
      ]);
      const aniso = globe.renderer().capabilities.getMaxAnisotropy();
      const tex = (im) => {
        const x = new T.Texture(im);
        x.anisotropy = aniso;
        x.needsUpdate = true;
        return x;
      };
      mat = new T.ShaderMaterial({
        uniforms: {
          dayTex: { value: tex(d) },
          nightTex: { value: tex(n) },
          topoTex: { value: tex(t || d) },
          relief: { value: t ? 4.0 : 0.0 },
          sun: { value: new T.Vector2() },
          mode: { value: 2 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
      });
      globe.globeMaterial(mat);
    } catch (e) {
      console.warn('Shader earth failed, using plain textures', e);
      mat = null;
    }
  }
  if (!mat) {
    // fallback: plain images, no live lighting
    globe.bumpImageUrl(CDN + 'earth-topology.png');
    $('[data-mode="live"]').disabled = true;
    if (light === 'live') light = 'night';
  }
  initHeat();
  setLighting(light);
}

function sunPos(date) {
  // sub-solar point from UTC time
  const rad = Math.PI / 180,
    d = date / 86400000 - 10957.5; // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad,
    q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad,
    e = (23.439 - 3.6e-7 * d) * rad;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)),
    ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15;
  let lng = ra / rad - gmst;
  lng = (((lng % 360) + 540) % 360) - 180;
  return { lat: dec / rad, lng };
}

function updateSun() {
  const now = new Date();
  sun = sunPos(now);
  if (mat) mat.uniforms.sun.value.set((sun.lat * Math.PI) / 180, (sun.lng * Math.PI) / 180);
  const f = (v, a, b) => `${Math.abs(v).toFixed(0)} deg ${v >= 0 ? a : b}`;
  $('#clock').textContent =
    `${now.toISOString().slice(11, 16)} UTC - sun is overhead near ${f(sun.lat, 'N', 'S')}, ${f(sun.lng, 'E', 'W')}`;
}

function setLighting(m) {
  light = m;
  document
    .querySelectorAll('.seg button')
    .forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === m));
  globe.atmosphereColor(ATMO[m]);
  if (mat) mat.uniforms.mode.value = { night: 0, day: 1, live: 2 }[m];
  else globe.globeImageUrl(m === 'day' ? TEX.day[1] : TEX.night[1]);
  const live = m === 'live';
  $('#clock').hidden = $('#sunbtn').hidden = !live;
  if (live) updateSun();
}
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => setLighting(b.dataset.mode));
$('#sunbtn').onclick = () => { updateSun(); globe.controls().autoRotate = false; flyTo({ lat: sun.lat, lng: sun.lng, altitude: 2.2 }); };
setInterval(() => { if (light === 'live') updateSun(); }, 15000);

/* ---------- prepared dataset (made once by preprocess.py, cached in the browser) ---------- */
let M,
  N,
  NC,
  CELL,
  YR,
  SN,
  CB,
  CNT,
  CC,
  countries = [];
const GM = {},
  memo = new Map();

async function getBin() {
  const url = 'dataset/fire.bin?v=' + M.stamp;
  try {
    const hit = await (await caches.open('fireglobe')).match(url);
    if (hit) return { buf: await hit.arrayBuffer(), cached: true };
  } catch (e) {
    /* no cache here */
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('fire.bin');
  const len = +res.headers.get('content-length') || M.bytes,
    rd = res.body.getReader(),
    parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    $('#lbar').style.width = Math.min(100, (got / len) * 100) + '%';
    $('#ldetail').textContent =
      `${(got / 1e6).toFixed(0)} of ${(len / 1e6).toFixed(0)} MB (first visit only)`;
  }
  const buf = await new Blob(parts).arrayBuffer();
  try {
    const c = await caches.open('fireglobe');
    for (const k of await c.keys()) await c.delete(k);
    await c.put(url, new Response(buf));
  } catch (e) {
    /* ignore */
  }
  return { buf, cached: false };
}

async function boot() {
  ensureUI();
  $('#loading').hidden = false;
  const t0 = performance.now();
  let cached = false;
  try {
    const mr = await fetch('dataset/fire.json', { cache: 'no-cache' });
    if (!mr.ok) throw new Error('fire.json');
    M = await mr.json();
    N = M.n;
    NC = M.nx * M.ny;
    countries = M.countries;
    const r = await getBin();
    cached = r.cached;
    const key = new Uint32Array(r.buf, 0, N);
    CNT = new Uint32Array(r.buf, 4 * N, N); CC = new Uint8Array(r.buf, 8 * N, NC);
    CELL = new Uint32Array(N); YR = new Uint8Array(N); SN = new Uint8Array(N); CB = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const k = key[i], l = (k / NC) | 0; CELL[i] = k - l * NC; YR[i] = (l / 6) | 0; SN[i] = ((l / 3) | 0) & 1; CB[i] = l % 3; }
    let gj; try { gj = await (await fetch('assets/countries.geojson')).json(); }
    catch (e) { gj = await (await fetch('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')).json(); }
    gj.features.forEach((f, i) => f.__i = i);
    FEATS = gj.features;
    globe.pathPointLat(p => p[1]).pathPointLng(p => p[0]).pathPointAlt(() => .015).pathColor(() => '#ffc757').pathStroke(1.6).pathTransitionDuration(0).pathsData([]);
    paint(); globe.polygonsData(gj.features);
  } catch (e) {
    console.warn(e);
    $('#lmsg').innerHTML =
      'Prepared data not found. Put your FIRMS CSVs in <b>/dataset</b>, run <code>python3 preprocess.py</code> once, then serve this folder (for example <code>python3 -m http.server</code>) and reload.';
    $('.progress').hidden = true;
    return;
  }
  const yr = $('#year'); yr.min = M.years[0]; yr.max = M.years[1]; yr.value = M.years[1];
  $('#meta').textContent = `${M.rows.toLocaleString()} detections, ${cached ? 'loaded from cache' : 'downloaded'} in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  $('#lmsg').textContent = 'Building the map …'; $('#lbar').style.width = '100%'; $('.progress').classList.add('ind');
  await nextPaint();                                   // let the skeleton paint before the heavy first draw
  ['#controls', '#timeline'].forEach(s => $(s).hidden = false);
  materialize($('#controls'), { dx: -18, dy: 0 });
  configureOverlap();
  $('#lite').checked = lite; if (lite) $('#res').value = '2'; setView(view, true);
  detail(); draw();
  await nextPaint(); $('#loading').hidden = true; updateHere(true); updateNames();
}

/* ---------- aggregation: one pass over the summary, memoised per setting ---------- */
const gmap = (res) =>
  GM[res] ||
  (GM[res] = (() => {
    const W = M.nx / res,
      a = new Uint32Array(NC);
    for (let c = 0; c < NC; c++) {
      const iy = (c / M.nx) | 0,
        ix = c - iy * M.nx;
      a[c] = ((iy / res) | 0) * W + ((ix / res) | 0);
    }
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
  const modis = overlapCount(0, minimum),
    viirs = overlapCount(1, minimum);
  return modis && viirs ? modis / viirs : 1;
}
function updateOverlapStatus() {
  const control = $('#normalize'),
    status = $('#normstatus');
  if (!overlapAvailable()) {
    control.checked = false;
    control.disabled = true;
    status.textContent = 'Unavailable: add both MODIS and VIIRS detections from 2012 or later.';
    return;
  }
  control.disabled = false;
  const minimum = +$('#conf').value,
    modis = overlapCount(0, minimum),
    viirs = overlapCount(1, minimum);
  if (!modis || !viirs) {
    status.textContent =
      'No overlap at this confidence level; raw counts are used for this filter.';
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
  const combine = (bySensor, fallback) =>
    bySensor ? bySensor[0].map((n, i) => n + (bySensor[1][i] || 0) * scale) : fallback;
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
  const iy = (cell / M.nx) | 0,
    ix = cell - iy * M.nx;
  const lat = 90 - ((iy + 0.5) * 180) / M.ny;
  const lng = -180 + ((ix + 0.5) * 360) / M.nx;
  return lat >= aoi.south && lat <= aoi.north && lng >= aoi.west && lng <= aoi.east;
}

function agg() {
  const res = sel >= 0 ? 1 : +$('#res').value,
    end = +$('#year').value - M.y0,
    cum = $('#cum').checked,
    mc = +$('#conf').value;
  const s0 = $('#modis').checked,
    s1 = $('#viirs').checked,
    scale = overlapScale(mc);
  const k = [
    res,
    sel,
    end,
    +cum,
    mc,
    +s0,
    +s1,
    scale,
    aoi ? `${aoi.south},${aoi.west},${aoi.north},${aoi.east}` : '',
  ].join();
  let r = memo.get(k);
  if (r) {
    ref = r.ref;
    return r;
  }
  const map = gmap(res),
    W = M.nx / res,
    grid = new Float32Array(W * (M.ny / res));
  const cellCounts = new Float32Array(NC),
    cs = new Float64Array(countries.length);
  let total = 0;
  for (let i = 0; i < N; i++) {
    const y = YR[i];
    if (y > end || (!cum && y !== end) || CB[i] < mc || !(SN[i] ? s1 : s0)) continue;
    const c = CNT[i] * (SN[i] ? scale : 1),
      cell = CELL[i],
      o = CC[cell];
    if (o === 255) continue;
    if (aoi && !cellInAoi(cell)) continue;
    cs[o] += c;
    if (sel >= 0 && o !== sel) continue;
    total += c;
    cellCounts[cell] += c;
  }
  const positionWeights = new Float32Array(grid.length),
    positionCells = new Uint32Array(grid.length);
  for (let cell = 0; cell < NC; cell++) {
    const count = cellCounts[cell];
    if (!count) continue;
    const g = map[cell];
    grid[g] += count;
    if (count > positionWeights[g]) {
      positionWeights[g] = count;
      positionCells[g] = cell;
    }
  }
  let mx = 1;
  for (let g = 0; g < grid.length; g++) if (grid[g] > mx) mx = grid[g];
  ref = mx;
  const pts = [];
  for (let g = 0; g < grid.length; g++) {
    const v = grid[g];
    if (!v) continue;
    const cell = positionCells[g],
      iy = (cell / M.nx) | 0,
      ix = cell - iy * M.nx;
    pts.push({
      lat: 90 - ((iy + 0.5) * 180) / M.ny,
      lng: -180 + ((ix + 0.5) * 360) / M.nx,
      v,
      i: g,
    });
  }
  pts.sort((a, b) => a.v - b.v);
  r = { pts, total, cs, res, ref };
  memo.set(k, r);
  if (memo.size > 20) memo.delete(memo.keys().next().value);
  return r;
}
function hexLimit() {
  return lite ? LOW_HEX_LIMIT : HEX_LIMIT;
}
function coarsen(pts, limit, step) {          // merge nearby cells until at most `limit` points remain (keeps full coverage, unlike dropping weak cells)
  for (;;) {
    const m = new Map();
    for (const q of pts) {
      const k = Math.floor((q.lat + 90) / step) * 1000 + Math.floor((q.lng + 180) / step), b = m.get(k);
      if (b) { b.w += q.weight; b.la += q.lat * q.weight; b.lo += q.lng * q.weight; }
      else m.set(k, { w: q.weight, la: q.lat * q.weight, lo: q.lng * q.weight });
    }
    if (m.size <= limit) return { step, pts: [...m.values()].map(b => ({ lat: b.la / b.w, lng: b.lo / b.w, weight: b.w })) };
    step *= 1.4;
  }
}
function applyHeat() {
  if (heat) { globe.heatmapsData([]); globe.pointsData([]).hexBinPointsData([]); return; }   // the canvas overlay draws it
  const all = cur.map(q => ({ lat: q.lat, lng: q.lng, weight: q.v }));
  const c = all.length ? coarsen(all, lite ? LOW_HEAT_LIMIT : HEAT_LIMIT, sel >= 0 ? .5 : lite ? 4 : 2) : null;
  globe.pointsData([]).hexBinPointsData([]);
  if (c) globe.heatmapBandwidth(Math.max(sel >= 0 ? .8 : 1.5, c.step * .7));
  globe.heatmapsData(c ? [c.pts] : []);
}
function apply(e) {
  if (view === 'heat') return applyHeat();
  const limit = hexLimit();
  const src = cur.length > limit ? cur.slice(-limit) : cur;
  const points = src.map((q) => {
    const p = prev.get(q.i),
      weight = (p ? p.v : 0) + (q.v - (p ? p.v : 0)) * e;
    return { lat: q.lat, lng: q.lng, weight, i: q.i };
  });
  globe.heatmapsData([]);
  if (view === 'hex') {
    globe
      .pointsData([])
      .hexBinResolution(cur.res === 2 ? 3 : 4)
      .hexBinPointsData(points);
    return;
  }
  globe.hexBinPointsData([]);
  globe.pointsData(
    points.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      alt: 0.005 + 0.14 * level(p.weight),
      col: colorL(level(p.weight)),
      r: cur.res * 0.22,
    }))
  );
}
function run() {
  cancelAnimationFrame(anim);
  if (lite || view !== 'raised') return apply(1);
  const t0 = performance.now();
  let lastFrame = -1;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / 450),
      frame = Math.min(4, Math.floor(p * 4));
    if (frame > lastFrame || p === 1) {
      lastFrame = frame;
      apply(1 - (1 - p) ** 3);
    }
    if (p < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
function setView(v, quiet) {
  view = v; fadeNext = true;
  document.querySelectorAll('#vseg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
  if (v !== 'raised') globe.pointsData([]);
  prev = new Map();
  if (quiet) { run(); paintHeat(); } else busy('Switching map …', () => { run(); paintHeat(); }, false);
}
function draw() {
  const r = agg(), y = $('#year').value, y0 = M.years[0];
  prev = view === 'raised' && !lite ? new Map(cur.map(q => [q.i, q])) : new Map();
  cur = r.pts; cur.res = r.res; run(); paintHeat();
  $('#count').textContent = fmt(r.total);
  $('#countlabel').textContent = normalizationOn()
    ? 'MODIS-equivalent detections'
    : 'detections shown';
  $('#yl').textContent = $('#cum').checked && +y > y0 ? `${y0}-${y}` : y;
  rk = []; countries.forEach((c, i) => r.cs[i] > 0 && rk.push([i, r.cs[i]])); rk.sort((a, b) => b[1] - a[1]);
  const L = (e, t, col) => ({ lat: countries[e[0]].lat, lng: countries[e[0]].lng, text: t + countries[e[0]].name, color: col });
  globe.labelsData([]);
  hiI = sel < 0 && rk.length > 1 ? rk[0][0] : -1; loI = sel < 0 && rk.length > 1 ? rk[rk.length - 1][0] : -1; updateNames();
  list(); detail();
}
const redraw = () => {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }, 60);
};

/* ---------- loading feedback ---------- */
const nextPaint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
const SKEL = '<div class="skel"><i class="sk c"></i><i class="sk"></i><i class="sk s"></i><i class="sk b"></i></div>';
let busyN = 0;
const CSS_UI = `.sk{display:block;height:14px;border-radius:10px;margin:10px 0;background:linear-gradient(90deg,rgba(255,255,255,.06) 25%,rgba(255,255,255,.16) 50%,rgba(255,255,255,.06) 75%);background-size:200% 100%;animation:shim 1.2s infinite linear}
.sk.c{width:54px;height:54px;border-radius:50%}.sk.s{width:60%}.sk.b{height:70px;border-radius:16px}
.skrow{display:flex;gap:10px;justify-content:center;margin:12px 0}.skrow .sk{width:46px;height:46px;border-radius:50%;margin:0}
@keyframes shim{to{background-position:-200% 0}}
.busy{position:fixed;top:74px;left:50%;transform:translateX(-50%);z-index:6;display:flex;gap:10px;align-items:center;padding:8px 16px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none}
.busy[hidden]{display:none}.busy.on{opacity:1}
.spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.2);border-top-color:#7aa2ff;border-radius:50%;animation:rot .7s linear infinite}
@keyframes rot{to{transform:rotate(360deg)}}
.progress.ind i{width:40%!important;animation:ind 1s ease-in-out infinite alternate}
@keyframes ind{from{margin-left:0}to{margin-left:60%}}
.here{position:fixed;bottom:88px;left:50%;transform:translateX(-50%);z-index:4;display:flex;gap:10px;align-items:baseline;padding:6px 18px;border-radius:999px;color:#fff;font:inherit;font-size:13px;cursor:pointer}
.here b{font-size:15px}.here span{color:#8e8e93;font-size:12px}.here[hidden]{display:none}
::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-button{display:none}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.45);background-clip:padding-box}
@supports not selector(::-webkit-scrollbar){*{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.35) transparent}}
input[type=range]{-webkit-appearance:none;appearance:none;height:5px;border-radius:5px;background:rgba(120,120,128,.4);outline:none;cursor:pointer}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:24px;height:24px;border-radius:50%;background:#fff;border:0;box-shadow:0 1px 5px rgba(0,0,0,.35),0 0 0 .5px rgba(0,0,0,.08)}
input[type=range]::-moz-range-thumb{width:24px;height:24px;border-radius:50%;background:#fff;border:0;box-shadow:0 1px 5px rgba(0,0,0,.35)}
input[type=range]::-moz-range-track{height:5px;border-radius:5px;background:rgba(120,120,128,.4)}`;
function ensureUI() {                                  // makes the loaders work even if index.html / style.css are older
  if (!document.getElementById('fg-css')) { const st = document.createElement('style'); st.id = 'fg-css'; st.textContent = CSS_UI; document.head.appendChild(st); }
  if (!$('#busy')) { const b = document.createElement('div'); b.id = 'busy'; b.className = 'glass busy'; b.hidden = true; b.innerHTML = '<i class="spin"></i><span id="busytxt"></span>'; document.body.appendChild(b); }
  if (!$('#here')) { const b = document.createElement('button'); b.id = 'here'; b.className = 'glass here'; b.hidden = true; b.title = 'Select this country'; document.body.appendChild(b); }
  const lt = $('#lite');
  if (lt && !$('#hop')) {
    let v = 50; try { v = +localStorage.getItem('fg-hop') || 50; } catch (e) { /* ignore */ }
    lt.closest('label').insertAdjacentHTML('afterend', `<label class="row"><span>Heat map opacity: <b id="hopv">${v}</b>%</span><input type="range" id="hop" min="10" max="100" value="${v}"></label>`);
  }
  const ld = $('#loading'), h = ld && ld.querySelector('h1');
  if (h && !ld.querySelector('.skrow')) h.insertAdjacentHTML('afterend', '<div class="skrow"><i class="sk"></i><i class="sk"></i><i class="sk"></i><i class="sk"></i></div>');
}
function busy(text, fn, skel = true) {              // show spinner + skeleton, let the browser paint, then do the heavy work
  const id = ++busyN; let b;
  try { ensureUI(); b = $('#busy'); $('#busytxt').textContent = text; b.hidden = false; b.classList.add('on'); if (skel) $('#detail').innerHTML = SKEL; }
  catch (e) { console.warn(e); return fn(); }       // the loader must never block the action itself
  requestAnimationFrame(() => setTimeout(() => {
    try { fn(); } catch (e) { console.error(e); }
    finally { if (id === busyN) { b.classList.remove('on'); setTimeout(() => { if (id === busyN) b.hidden = true; }, 220); } }
  }, 30));
}

/* ---------- overlays: heat canvas (adjustable opacity) + sharp borders and names + blur/darken mask ---------- */
const hc = document.createElement('canvas'), hx = hc.getContext('2d'), SP = [];
const oc = document.createElement('canvas'), ox = oc.getContext('2d');          // borders + country names, high resolution
const mc = document.createElement('canvas'), mx = mc.getContext('2d');          // mask for the shader (white = outside the selected country)
hc.width = 1024; hc.height = 512; mc.width = 1024; mc.height = 512;
let FEATS = [], heat = null, lab = null, mtex = null, fadeNext = false, fadeRaf = 0, maskSel = -2, maskRaf = 0, oKey = '', BBW = [];
const HOP = () => { const e = document.getElementById('hop'); return (e ? +e.value : 50) / 100; };
function initHeat() {
  if (!T) return;
  try {
    hc.width = lite ? 1024 : 2048; hc.height = hc.width / 2; oc.width = lite ? 2048 : 4096; oc.height = oc.width / 2;   // final size BEFORE the textures exist
    const geo = () => new T.SphereGeometry(101, lite ? 48 : 64, lite ? 32 : 44), aniso = globe.renderer().capabilities.getMaxAnisotropy();
    const tx = new T.CanvasTexture(hc), tl = new T.CanvasTexture(oc); tl.anisotropy = aniso;
    heat = new T.Mesh(geo(), new T.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, opacity: HOP() }));
    lab = new T.Mesh(new T.SphereGeometry(101.4, lite ? 48 : 64, lite ? 32 : 44), new T.MeshBasicMaterial({ map: tl, transparent: true, depthWrite: false }));
    for (const [m, o, t] of [[heat, 2, tx], [lab, 3, tl]]) { m.rotation.y = -Math.PI / 2; m.renderOrder = o; m.userData.tx = t; m.raycast = () => {}; globe.scene().add(m); }
  } catch (e) { console.warn('Overlay layers failed, using plain borders', e); heat = lab = null; }
}
function sprite(k) {
  if (SP[k]) return SP[k];
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const col = colorL(k / 15).replace('rgb', 'rgba'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, col.replace(')', ',.95)')); gr.addColorStop(.35, col.replace(')', ',.6)')); gr.addColorStop(.7, col.replace(')', ',.18)')); gr.addColorStop(1, col.replace(')', ',0)'));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return SP[k] = c;
}
function tracePath(f, W, H, ctx) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of polys) for (const ring of p) { ring.forEach(([x, y], i) => { const px = (x + 180) / 360 * W, py = (90 - y) / 180 * H; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); }
}
function paintMask() {                                  // the shader blurs (mip bias) and darkens wherever the mask is white
  if (!mat || sel === maskSel) return; maskSel = sel;
  const u = mat.uniforms.maskAmt, to = sel >= 0 ? 1 : 0, from = u.value;
  if (sel >= 0 && FEATS[sel]) {
    mx.filter = 'none'; mx.fillStyle = '#fff'; mx.fillRect(0, 0, 1024, 512);
    mx.filter = 'blur(.6px)'; mx.fillStyle = '#000'; mx.beginPath(); tracePath(FEATS[sel], 1024, 512, mx); mx.fill(); mx.filter = 'none';
    mtex.needsUpdate = true;
  }
  cancelAnimationFrame(maskRaf);
  if (lite) { u.value = to; return; }
  const t0 = performance.now(), st = t => { const p = Math.min(1, (t - t0) / 450); u.value = from + (to - from) * p; if (p < 1) maskRaf = requestAnimationFrame(st); };
  maskRaf = requestAnimationFrame(st);
}
function paintOutlines() {                              // crisp borders, drawn once per size / selection (names are DOM text, see updateNames)
  if (!lab || !FEATS.length) return;
  const W = lite ? 2048 : 4096, H = W / 2, key = W + '|' + sel;
  if (key === oKey) return; oKey = key;
  if (!BBW.length) BBW = FEATS.map(f => { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; return Math.max(...polys.map(p => { const xs = p[0].map(c => c[0]); return Math.max(...xs) - Math.min(...xs); })); });
  if (oc.width !== W) { oc.width = W; oc.height = H; lab.userData.tx.dispose(); }
  ox.clearRect(0, 0, W, H); ox.lineJoin = 'round';
  const u = W / 2048;
  ox.lineWidth = u * 1.1; ox.strokeStyle = 'rgba(255,255,255,.55)'; ox.beginPath();
  FEATS.forEach((f, i) => { if (i !== sel) tracePath(f, W, H, ox); }); ox.stroke();
  ox.globalAlpha = 1; lab.userData.tx.needsUpdate = true;
}

/* ---------- country names: ONE size for every country, shown only on the side facing you ---------- */
let hiI = -1, loI = -1, namesRaf = 0, NB = null;
const NAME_PX = 11, FACE_DEG = 42, nameEls = [], nctx = document.createElement('canvas').getContext('2d');
nctx.font = `600 ${NAME_PX}px "Bricolage Grotesque", system-ui, sans-serif`;
const nameW = new Map();
const textW = i => nameW.get(i) ?? (nameW.set(i, nctx.measureText(countries[i].name).width + 6), nameW.get(i));
function nameBoxes() {                                   // each country's biggest piece, in degrees (width, height)
  if (NB) return NB;
  return NB = FEATS.map(f => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = [0, 0];
    for (const p of polys) {
      let x0 = 181, x1 = -181, y0 = 91, y1 = -91;
      for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 - x0 > best[0]) best = [x1 - x0, y1 - y0];
    }
    return best;
  });
}
function updateNames() {
  if (namesRaf) return;
  namesRaf = requestAnimationFrame(() => { namesRaf = 0; drawNames(); });
}
function drawNames() {
  const host = $('#names'); if (!host || !countries.length || !FEATS.length) return;
  if (!nameEls.length) countries.forEach((c, i) => { const s = document.createElement('span'); s.className = 'cn'; s.textContent = c.name; host.appendChild(s); nameEls[i] = s; });
  const p = globe.pointOfView(), rad = Math.PI / 180, bb = nameBoxes();
  const sb = $('#controls').getBoundingClientRect().right, W = innerWidth, H = innerHeight;
  const cand = [];
  for (let i = 0; i < countries.length; i++) {
    const c = countries[i];
    if (sel >= 0 && i !== sel) continue;                 // a country is open: only its name
    const cosd = Math.sin(p.lat * rad) * Math.sin(c.lat * rad) + Math.cos(p.lat * rad) * Math.cos(c.lat * rad) * Math.cos((p.lng - c.lng) * rad);
    if (cosd < Math.cos(FACE_DEG * rad)) continue;       // not facing you
    const o = globe.getScreenCoords(c.lat, c.lng, 0.002); if (!o) continue;
    if (o.x < sb + 8 || o.x > W - 8 || o.y < 8 || o.y > H - 8) continue;   // behind the sidebar or off screen
    const w = textW(i), forced = i === sel || i === hiI || i === loI;
    let room = Infinity;
    if (!forced) {                                       // the name must fit inside the country, so it never touches borders or neighbours
      const hw = bb[i][0] / 2, hh = bb[i][1] / 2;
      const l = globe.getScreenCoords(c.lat, c.lng - hw, 0.002), r = globe.getScreenCoords(c.lat, c.lng + hw, 0.002);
      const t = globe.getScreenCoords(Math.min(89, c.lat + hh), c.lng, 0.002), u = globe.getScreenCoords(Math.max(-89, c.lat - hh), c.lng, 0.002);
      if (!l || !r || !t || !u) continue;
      const pw = Math.hypot(r.x - l.x, r.y - l.y), ph = Math.hypot(t.x - u.x, t.y - u.y);
      if (pw < w * 1.1 || ph < NAME_PX * 1.6) continue;
      room = pw;
    }
    cand.push({ i, x: o.x, y: o.y, w, room, forced });
  }
  cand.sort((a, b) => (b.forced - a.forced) || (b.room - a.room));
  const placed = [], show = new Set();
  for (const q of cand) {
    const h = NAME_PX + 4;
    if (!q.forced && placed.some(r => Math.abs(r.x - q.x) < (r.w + q.w) / 2 + 4 && Math.abs(r.y - q.y) < (r.h + h) / 2 + 2)) continue;
    placed.push({ x: q.x, y: q.y, w: q.w, h }); show.add(q.i);
    const el = nameEls[q.i];
    el.style.transform = `translate(${Math.round(q.x)}px,${Math.round(q.y)}px) translate(-50%,-50%)`;
    el.className = 'cn' + (q.i === sel ? ' sel' : q.i === hiI ? ' hi' : q.i === loI ? ' lo' : '');
    el.title = q.i === hiI ? 'Most burning' : q.i === loI ? 'Least burning' : '';
    el.style.display = 'block';
  }
  nameEls.forEach((el, i) => { if (!show.has(i) && el.style.display !== 'none') el.style.display = 'none'; });
}
const GEO = [];
function geoIndex() {
  if (GEO.length) return;
  FEATS.forEach(f => { const ps = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    GEO.push(ps.map(p => { const r = p[0]; let x0 = 181, y0 = 91, x1 = -181, y1 = -91; for (const [x, y] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { b: [x0, y0, x1, y1], r }; })); });
}
function inRing(r, x, y) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function countryAt(lat, lng) {
  geoIndex();
  for (let i = 0; i < GEO.length; i++) for (const p of GEO[i]) if (lng >= p.b[0] && lng <= p.b[2] && lat >= p.b[1] && lat <= p.b[3] && inRing(p.r, lng, lat)) return i;
  return -1;
}
let hereT = 0;
function updateHere(force) {                          // "you are looking at ..." pill, from the centre of the view
  const now = performance.now(); if (!force && now - hereT < 200) return; hereT = now;
  const el = $('#here'); if (!el || !FEATS.length) return;
  const p = globe.pointOfView(), i = countryAt(p.lat, p.lng), f = (v, a, b) => `${Math.abs(v).toFixed(0)}°${v >= 0 ? a : b}`;
  el.dataset.i = i; el.innerHTML = `<b>${i >= 0 ? countries[i].name : 'Open water'}</b><span>${f(p.lat, 'N', 'S')} ${f(p.lng, 'E', 'W')}</span>`; el.hidden = false;
}
let pathSel = -2, selLine = null;
function setSelPath() {                                // the selected country's border is a real 3D line: always crisp, never blurry
  if (pathSel === sel) return; pathSel = sel;
  if (selLine) { globe.scene().remove(selLine); selLine.traverse(o => o.geometry && o.geometry.dispose()); selLine = null; }
  if (T && sel >= 0 && FEATS[sel]) {
    const g = new T.Group(), ff = FEATS[sel], rings = ff.geometry.type === 'Polygon' ? ff.geometry.coordinates : ff.geometry.coordinates.flat(1);
    for (const r of rings) {
      const pts = [];
      for (const [lng, lat] of r) { const u = (lng + 180) / 360 * 2 * Math.PI, th = (90 - lat) * Math.PI / 180; pts.push(-101.7 * Math.cos(u) * Math.sin(th), 101.7 * Math.cos(th), 101.7 * Math.sin(u) * Math.sin(th)); }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      g.add(new T.LineLoop(geo, new T.LineBasicMaterial({ color: 0xffc757 })));
    }
    g.rotation.y = -Math.PI / 2; g.traverse(o => { o.raycast = () => {}; o.renderOrder = 5; }); selLine = g; globe.scene().add(g);
  }
  const f = FEATS[sel];
  globe.pathsData(sel >= 0 && f ? (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat(1)) : []);
}
function paintHeat() {
  setSelPath(); paintMask(); paintOutlines();
  if (!heat) return;
  const W = lite ? 1024 : 2048, H = W / 2;
  if (hc.width !== W) { hc.width = W; hc.height = H; heat.userData.tx.dispose(); }
  hx.clearRect(0, 0, W, H);
  if (view === 'heat') {
    const d = W / 360 * (cur.res || 2) * 4.2;
    for (const q of cur) {                            // cur is sorted weak to strong, so hot spots end up on top
      const l = level(q.v); if (l < .01) continue;
      hx.globalAlpha = Math.min(1, .3 + l);
      hx.drawImage(sprite(Math.round(l * 15)), (q.lng + 180) / 360 * W - d / 2, (90 - q.lat) / 180 * H - d / 2, d, d);
    }
    hx.globalAlpha = 1;
  }
  heat.userData.tx.needsUpdate = true;
  const m = heat.material, o = HOP(); cancelAnimationFrame(fadeRaf);
  if (!fadeNext || lite) { m.opacity = o; fadeNext = false; return; }
  fadeNext = false; m.opacity = 0; const t0 = performance.now();
  const step = t => { const p = Math.min(1, (t - t0) / 350); m.opacity = p * o; if (p < 1) fadeRaf = requestAnimationFrame(step); };
  fadeRaf = requestAnimationFrame(step);
}

/* ---------- countries ---------- */
function paint() {                                    // polygons only catch clicks when the overlay layers are available
  if (heat && lab) { globe.polygonCapColor(() => 'rgba(0,0,0,0)').polygonStrokeColor(() => 'rgba(0,0,0,0)'); return; }
  globe.polygonCapColor(() => 'rgba(0,0,0,0)').polygonStrokeColor(p => p.__i === sel ? '#ffc757' : 'rgba(255,255,255,.35)');
}
function fadeTo(t) { gf = t; fadeNext = true; if (!(heat && lab)) paint(); }
function pick(i) { busy('Loading ' + countries[i].name + ' …', () => pickNow(i)); }
function clear() { busy('Back to overview …', clearNow); }
function pickNow(i) {
  sel = i; tab = 'stats'; loc = null; globe.ringsData([]); globe.controls().autoRotate = false; fadeTo(1);
  flyTo({ lat: countries[i].lat, lng: countries[i].lng, altitude: 1.8 });
  draw(); materialize($('#detail'), { dx: -14, dy: 0 });
}
function clearNow() { sel = -1; loc = null; globe.ringsData([]); fadeTo(0); draw(); materialize($('#detail'), { dx: 0, dy: 8 }); }

function list() {
  const q = $('#csearch').value.trim().toLowerCase(),
    cs = agg().cs;
  const rows = countries
    .map((c, i) => [i, cs[i]])
    .filter(([i, n]) => n > 0 && countries[i].name.toLowerCase().includes(q))
    .sort((a, b) => b[1] - a[1]);
  $('#clist').innerHTML =
    rows
      .map(
        ([i, n]) =>
          `<button class="ci${i === sel ? ' sel' : ''}" data-i="${i}"><span>${countries[i].name}</span><span class="hint">${fmt(n)}</span></button>`
      )
      .join('') || '<p class="hint">No countries with detections.</p>';
}

/* ---------- panel: overview first, then Statistics / History / Locations ---------- */
const TOP = new Map(),
  TABS = [
    ['stats', 'Statistics'],
    ['hist', 'History'],
    ['loc', 'Locations'],
  ];
const row = (a, b) => `<div class="evt"><span>${a}</span><span>${b}</span></div>`;
const bars = (a, f, cls, attr) => {
  const m = Math.max(...a) || 1;
  return `<div class="bars ${cls}">${a.map((n, i) => `<i ${attr ? `${attr}="${i}"` : ''} class="${n === m ? 'peak' : ''}" style="height:${Math.max(3, (n / m) * 100)}%" title="${f(i)}: ${n.toLocaleString()}"></i>`).join('')}</div>`;
};
function tops() {
  // busiest 1-degree areas of the selected country
  if (TOP.has(sel)) return TOP.get(sel);
  const m = new Map(),
    W = M.nx,
    H = W >> 1;
  const scale = overlapScale(0);
  for (let i = 0; i < N; i++) {
    const cell = CELL[i];
    if (CC[cell] !== sel || (aoi && !cellInAoi(cell))) continue;
    const iy = (cell / W) | 0,
      k = (iy >> 1) * H + ((cell - iy * W) >> 1);
    m.set(k, (m.get(k) || 0) + CNT[i] * (SN[i] ? scale : 1));
  }
  const r = [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => {
      const by = (k / H) | 0;
      return { lat: 90 - by - 0.5, lng: -180 + (k - by * H) + 0.5, n };
    });
  TOP.set(sel, r);
  return r;
}
function locAt(lat, lng) {
  // yearly history of one specific spot
  const by = Math.floor(90 - lat),
    bx = Math.floor(lng + 180),
    W = M.nx,
    off = M.years[0] - M.y0,
    a = new Array(M.years[1] - M.years[0] + 1).fill(0);
  const scale = overlapScale(0);
  for (let i = 0; i < N; i++) {
    const cell = CELL[i],
      iy = (cell / W) | 0;
    if (iy >> 1 === by && (cell - iy * W) >> 1 === bx)
      a[YR[i] - off] += CNT[i] * (SN[i] ? scale : 1);
  }
  loc = { lat: 90 - by - 0.5, lng: -180 + bx + 0.5, a };
  tab = 'loc';
  globe.ringsData([loc]);
  detail();
}
function overview() {
  if (!rk.length) return '<p class="hint">No detections for these filters.</p>';
  const mean = rk.reduce((a, r) => a + r[1], 0) / rk.length,
    hi = rk[0],
    lo = rk[rk.length - 1];
  const t = (l, e, v) =>
    `<button class="tile" ${e ? `data-i="${e[0]}"` : ''}><span class="hint">${l}</span><b>${v}</b><span>${e ? countries[e[0]].name : 'per country'}</span></button>`;
  return `<h3>Overview</h3><div class="tiles">${t('Mean', null, fmt(mean))}${t('Highest', hi, fmt(hi[1]))}${t('Lowest', lo, fmt(lo[1]))}</div><p class="hint">Click a country on the globe (or Highest / Lowest) to see its statistics, history and specific locations.</p>`;
}
function detail() {
  const box = $('#detail');
  if (sel < 0) {
    box.innerHTML = overview();
    return;
  }
  const c = countries[sel],
    metrics = countryMetrics(c),
    y0 = M.years[0],
    tot = metrics.total;
  const back = '<button id="clr" class="btn ghost small inline">Back to overview</button>';
  if (!tot) {
    box.innerHTML = `<p class="name">${c.name}</p><p class="hint">No detections in this dataset.</p>${back}`;
    return;
  }
  const top = Math.max(...metrics.years),
    mt = Math.max(...metrics.months),
    dn = metrics.dayNight[0] + metrics.dayNight[1],
    yaxis = `<div class="axis"><span>${y0}</span><span>${M.years[1]}</span></div>`;
  let body;
  if (tab === 'stats')
    body = `<div class="stats"><div><b>${fmt(tot)}</b>detections</div><div><b>${y0 + metrics.years.indexOf(top)}</b>peak year</div><div><b>${MON[metrics.months.indexOf(mt)]}</b>busiest month</div></div>
    ${row('Shown with current filters', `<b>${fmt(agg().cs[sel])}</b>`)}    ${row(normalizationOn() ? 'MODIS / VIIRS-equivalent' : 'MODIS / VIIRS', `${fmt(metrics.modis)} / ${fmt(metrics.viirs)}`)}
    ${row('Seen by day / night', dn ? `${Math.round((metrics.dayNight[0] / dn) * 100)}% / ${Math.round((metrics.dayNight[1] / dn) * 100)}%` : 'N/A')}
    <p class="hint">Country totals and charts include all confidence levels${normalizationOn() ? '; VIIRS is overlap-scaled.' : '.'}</p>`;
  else if (tab === 'hist')
    body = `<h3>Per year (click a bar)</h3>${bars(metrics.years, (i) => y0 + i, '', 'data-y')}${yaxis}<h3>Seasonality</h3>${bars(metrics.months, (i) => MON[i], 'm')}<div class="axis months">${MON.map((m) => `<span>${m[0]}</span>`).join('')}</div>`;
  else
    body = `<h3>Hotspot areas (about 100 km)</h3>${
      tops()
        .map(
          (p) =>
            `<button class="ci" data-l="${p.lat},${p.lng}"><span>${p.lat.toFixed(1)}, ${p.lng.toFixed(1)}</span><span class="hint">${fmt(p.n)}</span></button>`
        )
        .join('') || '<p class="hint">None.</p>'
    }
    ${loc ? `<h3>Area ${loc.lat.toFixed(1)}, ${loc.lng.toFixed(1)} per year</h3>${bars(loc.a, (i) => y0 + i, '', '')}${yaxis}` : '<p class="hint">Or click anywhere inside the country to inspect that spot.</p>'}`;
  box.innerHTML = `<p class="name">${c.name}</p><div class="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>${body}${back}`;
}

/* ---------- wiring ---------- */
/* ---------- sidebar (layout from 2nd.rar) ---------- */
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
  if (collapsed) { expandedSidebarWidth = $('#controls').style.width; $('#controls').style.width = '58px'; }
  else $('#controls').style.width = expandedSidebarWidth;
  $('#collapse').setAttribute('aria-expanded', !collapsed);
  $('#collapse').setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  setTimeout(updateNames, 0);
};
const resizeHandle = $('#resize-handle');
function resizeSidebar(width) {
  const styles = getComputedStyle($('#controls'));
  const min = Math.max(220, parseFloat(styles.minWidth) || 0), max = parseFloat(styles.maxWidth) || innerWidth;
  $('#controls').style.width = `${Math.max(min, Math.min(max, width))}px`;
  updateNames();
}
resizeHandle.addEventListener('pointerdown', e => {
  if ($('#controls').classList.contains('is-collapsed')) return;
  e.preventDefault();
  const startX = e.clientX, startWidth = $('#controls').getBoundingClientRect().width;
  resizeHandle.setPointerCapture(e.pointerId);
  const move = ev => resizeSidebar(startWidth + ev.clientX - startX);
  const stop = () => { ['pointermove', 'pointerup', 'pointercancel'].forEach((t, k) => resizeHandle.removeEventListener(t, k ? stop : move)); };
  resizeHandle.addEventListener('pointermove', move); resizeHandle.addEventListener('pointerup', stop); resizeHandle.addEventListener('pointercancel', stop);
});
resizeHandle.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); resizeSidebar($('#controls').getBoundingClientRect().width + (e.key === 'ArrowRight' ? 16 : -16)); }
});
$('#clist').onclick = e => { const b = e.target.closest('.ci'); if (b) pick(+b.dataset.i); };
$('#csearch').addEventListener('input', list);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sel >= 0) clear();
});
['#modis', '#viirs', '#conf', '#cum', '#year', '#res'].forEach((s) =>
  $(s).addEventListener('input', redraw)
);
$('#conf').addEventListener('input', updateOverlapStatus);
$('#normalize').addEventListener('change', () => {
  TOP.clear();
  updateOverlapStatus();
  if (loc) locAt(loc.lat, loc.lng);
  redraw();
});
$('#play').onclick = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
    $('#play').textContent = 'Play';
    return;
  }
  $('#play').textContent = 'Pause';
  timer = setInterval(() => {
    const y = $('#year');
    y.value = +y.value >= +y.max ? y.min : +y.value + 1;
    redraw();
  }, 900);
};

$('#detail').onclick = (e) => {
  const t = e.target.closest('[data-i],[data-t],[data-l],[data-y],#clr');
  if (!t) return;
  if (t.id === 'clr') return clear();
  if (t.dataset.i) return pick(+t.dataset.i);
  if (t.dataset.t) { const d = TABS.findIndex(([k]) => k === t.dataset.t) - TABS.findIndex(([k]) => k === tab); tab = t.dataset.t; detail(); return materialize($('#detail'), { dx: Math.sign(d) * 18, dy: 0, from: .99, response: .3 }); }
  if (t.dataset.l) { const [la, lo] = t.dataset.l.split(',').map(Number); flyTo({ lat: la, lng: lo, altitude: 1.1 }); return locAt(la, lo); }
  if (t.dataset.y !== undefined) { $('#year').value = M.years[0] + +t.dataset.y; redraw(); }
};
document.querySelectorAll('#vseg button').forEach(b => b.onclick = () => setView(b.dataset.v));
document.addEventListener('input', e => {
  if (e.target.id !== 'hop') return;
  const v = e.target.value; $('#hopv').textContent = v; try { localStorage.setItem('fg-hop', v); } catch (x) { /* ignore */ }
  if (heat) heat.material.opacity = v / 100;
});
$('#lite').onchange = e => { lite = e.target.checked; try { localStorage.setItem('fg-lite', lite ? '1' : '0'); } catch (x) { /* ignore */ } fit(); if (lite) globe.controls().autoRotate = false; run(); paintHeat(); };
document.addEventListener('visibilitychange', () => document.hidden ? globe.pauseAnimation() : globe.resumeAnimation());
{ const ctl = globe.controls(); let rt = 0;           // render at lower resolution while dragging, restore when idle
  ctl.addEventListener('start', () => { clearTimeout(rt); globe.renderer().setPixelRatio(lite ? .6 : .85); });
  ctl.addEventListener('end', () => { clearTimeout(rt); rt = setTimeout(() => { fit(); paintOutlines(); }, 400); });
  ctl.addEventListener('change', () => { updateHere(); updateNames(); });
  document.addEventListener('click', e => { const h = e.target.closest('#here'); if (h && +h.dataset.i >= 0) pick(+h.dataset.i); }); }
await initEarth();
boot();