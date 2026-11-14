import { spring, materialize, reduced } from './motion.js';
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
const ATMO = { day: '#8db4ff', night: '#3b5bc4', live: '#4a7ff8' };

let ref = 1, timer = null, raf = 0, drawTimer = null, sel = -1, area = null, areaHidden = false, noClickUntil = 0;
let lite = (() => { try { return localStorage.getItem('tf-lite') !== '0'; } catch (e) { return true; } })();   // low-end mode is ON by default; the choice is remembered
let tab = 'stats', loc = null, view = 'heat', gf = 0, prev = new Map(), cur = [], rk = [], anim = 0;
const HEX_LIMIT = 6000, LOW_HEX_LIMIT = 2000, HEAT_LIMIT = 1200, LOW_HEAT_LIMIT = 450;
let light = 'live', mat = null, T = null, sun = { lat: 0, lng: 0 };
let heatFloor = 0, heatRef = 1;

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
  .onPointClick(p => p && Date.now() > noClickUntil && locAt(p.lat, p.lng))
  .polygonAltitude(0.004).polygonSideColor(() => 'rgba(0,0,0,0)').polygonsTransitionDuration(0)
  .onPolygonClick((p, _e, c) => p && Date.now() > noClickUntil && (p.__i === sel && c ? locAt(c.lat, c.lng) : pick(p.__i)));

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
const fmt = value => Math.round(value).toLocaleString();
const color = w => colorL(level(w));
function colorL(l) {
  const value = Number.isFinite(l) ? Math.max(0, Math.min(1, l)) : 0;
  const x = value * (STOPS.length - 1), i = Math.min(Math.floor(x), STOPS.length - 2), f = x - i;
  return `rgb(${STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f))})`;
}
function heatLevel(w) {
  if (!Number.isFinite(w) || w <= 0) return 0;
  if (heatRef <= heatFloor) return 1;
  if (w <= heatFloor) return 0;
  const value = (Math.log1p(w) - Math.log1p(heatFloor)) / (Math.log1p(heatRef) - Math.log1p(heatFloor));
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
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
      mtex = new T.CanvasTexture(mc); mx.fillStyle = '#000'; mx.fillRect(0, 0, mc.width, mc.height); mtex.needsUpdate = true;
      mat = new T.ShaderMaterial({
        uniforms: {
          dayTex: { value: tex(d) }, nightTex: { value: tex(n) }, topoTex: { value: tex(t || d) }, maskTex: { value: mtex }, maskAmt: { value: 0 },
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
  initHeat();
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
$('#sunbtn').onclick = () => { updateSun(); globe.controls().autoRotate = false; flyTo({ lat: sun.lat, lng: sun.lng, altitude: 2.2 }); };
setInterval(() => { if (light === 'live') updateSun(); }, 15000);

/* ---------- prepared dataset (made once by preprocess.py, cached in the browser) ---------- */
let M, N, NC, CELL, YR, SN, CB, CNT, CC, countries = [];
const GM = {}, memo = new Map();

async function getBin() {
  const url = 'dataset/fire.bin?v=' + M.stamp;
  try { const hit = await (await caches.open('teraflare')).match(url); if (hit) return { buf: await hit.arrayBuffer(), cached: true }; } catch (e) { /* no cache here */ }
  const res = await fetch(url); if (!res.ok) throw new Error('fire.bin');
  const len = +res.headers.get('content-length') || M.bytes, rd = res.body.getReader(), parts = []; let got = 0;
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    parts.push(value); got += value.length;
    $('#lbar').style.width = Math.min(100, got / len * 100) + '%';
    $('#ldetail').textContent = `${(got / 1e6).toFixed(0)} of ${(len / 1e6).toFixed(0)} MB (first visit only)`;
  }
  const buf = await new Blob(parts).arrayBuffer();
  try { const c = await caches.open('teraflare'); for (const k of await c.keys()) await c.delete(k); await c.put(url, new Response(buf)); caches.delete('fireglobe'); } catch (e) { /* ignore */ }
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
    M = await mr.json(); N = M.n; NC = M.nx * M.ny; countries = M.countries;
    const r = await getBin(); cached = r.cached;
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
    $('#lmsg').innerHTML = 'Prepared data not found. Put your FIRMS CSVs in <b>/dataset</b>, run <code>python3 preprocess.py</code> once, then serve this folder (for example <code>python3 -m http.server</code>) and reload.';
    $('.progress').hidden = true; return;
  }
  const yr = $('#year'); yr.min = M.years[0]; yr.max = M.years[1]; yr.value = M.years[1];
  $('#lmsg').textContent = 'Building the map …'; $('#lbar').style.width = '100%'; $('.progress').classList.add('ind');
  await nextPaint();                                   // let the skeleton paint before the heavy first draw
  ['#controls', '#timeline'].forEach(s => $(s).hidden = false);
  materialize($('#controls'), { dx: -18, dy: 0 });
  configureOverlap();
  $('#lite').checked = lite; if (lite) $('#res').value = '2'; run(); paintHeat();
  detail(); draw();
  await nextPaint(); $('#loading').hidden = true; updateHere(true); updateNames();
  (window.requestIdleCallback || setTimeout)(() => loadAdmin1().then(() => updateHere(true)));   // region / province names for the location pill
  aboutReady.then(() => { if (location.hash === '#about') go('about'); });
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
  return { years, months, total: years.reduce((sum, n) => sum + n, 0) };
}

function agg() {
  const res = sel >= 0 ? 1 : +$('#res').value, end = +$('#year').value - M.y0, cum = $('#cum').checked, mc = +$('#conf').value;
  const s0 = $('#modis').checked, s1 = $('#viirs').checked, scale = overlapScale(mc);
  const k = [res, sel, end, +cum, mc, +s0, +s1, scale].join();
  let r = memo.get(k); if (r) { ref = r.ref; return r; }
  const map = gmap(res), W = M.nx / res, grid = new Float32Array(W * (M.ny / res));
  const cellCounts = new Float32Array(NC), cs = new Float64Array(countries.length);
  let total = 0;
  for (let i = 0; i < N; i++) {
    const y = YR[i]; if (y > end || (!cum && y !== end) || CB[i] < mc || !(SN[i] ? s1 : s0)) continue;
    const c = CNT[i] * (SN[i] ? scale : 1), cell = CELL[i], o = CC[cell];
    if (o === 255) continue;
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
  ref = mx;
  const heatGrid = new Float32Array(grid.length), heatValues = [];
  const kernel = [1, 2, 1];
  const GH = M.ny / res;
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < W; gx++) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = Math.max(0, Math.min(GH - 1, gy + dy));
      for (let dx = -1; dx <= 1; dx++) {
        const nx = (gx + dx + W) % W;
        sum += grid[ny * W + nx] * kernel[dy + 1] * kernel[dx + 1];
      }
    }
    const average = sum / 16;
    heatGrid[gy * W + gx] = average;
    if (average > 0) heatValues.push(average);
  }
  heatValues.sort((a, b) => a - b);
  const thresholdIndex = Math.min(heatValues.length - 1, Math.floor(heatValues.length * .6));
  const nextHeatFloor = heatValues.length ? heatValues[thresholdIndex] : 0;
  const nextHeatRef = heatValues.length ? heatValues[heatValues.length - 1] : 1;
  const pts = [];
  for (let g = 0; g < grid.length; g++) {
    const v = grid[g]; if (!v) continue;
    const cell = positionCells[g], iy = (cell / M.nx) | 0, ix = cell - iy * M.nx;
    pts.push({ lat: 90 - (iy + .5) * 180 / M.ny, lng: -180 + (ix + .5) * 360 / M.nx, v, hv: heatGrid[g], i: g });
  }
  pts.sort((a, b) => a.v - b.v);
  r = { pts, total, cs, res, ref, heatFloor: nextHeatFloor, heatRef: nextHeatRef };
  memo.set(k, r); if (memo.size > 20) memo.delete(memo.keys().next().value);
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
  if (heat) { globe.heatmapsData([]); return; }   // the canvas overlay draws it
  const all = cur.map(q => ({ lat: q.lat, lng: q.lng, weight: q.v }));
  const c = all.length ? coarsen(all, lite ? LOW_HEAT_LIMIT : HEAT_LIMIT, sel >= 0 ? .5 : lite ? 4 : 2) : null;
  if (c) globe.heatmapBandwidth(Math.max(sel >= 0 ? .8 : 1.5, c.step * .7));
  globe.heatmapsData(c ? [c.pts] : []);
}
function apply() {
  globe.pointsData([]);
  if (sel >= 0) {                                      // a country is open: 3D hexagons of that country on top of the heat map
    const keep = Math.min(hexLimit(), Math.max(1, Math.ceil(cur.length * hexPct))), src = cur.slice(-keep);   // cur is sorted weak to strong
    globe.hexBinResolution(4).hexBinPointsData(src.map(q => ({ lat: q.lat, lng: q.lng, weight: q.v })));
  } else globe.hexBinPointsData([]);                   // overview: heat map only
  applyHeat();
}
const run = apply;
function draw() {
  const r = agg(), y = $('#year').value, y0 = M.years[0];
  heatFloor = r.heatFloor; heatRef = r.heatRef;
  cur = r.pts; cur.res = r.res; run(); paintHeat();
  $('#yl').textContent = $('#cum').checked && +y > y0 ? `${y0}-${y}` : y;
  rk = []; countries.forEach((c, i) => r.cs[i] > 0 && rk.push([i, r.cs[i]])); rk.sort((a, b) => b[1] - a[1]);
  const L = (e, t, col) => ({ lat: countries[e[0]].lat, lng: countries[e[0]].lng, text: t + countries[e[0]].name, color: col });
  globe.labelsData([]);
  hiI = sel < 0 && rk.length > 1 ? rk[0][0] : -1; loI = sel < 0 && rk.length > 1 ? rk[rk.length - 1][0] : -1; updateNames();
  detail();
}
const redraw = () => {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }, 60);
};

/* ---------- loading feedback ---------- */
const nextPaint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
const SKEL = '<div class="skel"><i class="sk t"></i><i class="sk row"></i><div class="skgrid"><i class="sk b"></i><i class="sk b"></i></div><i class="sk"></i><i class="sk s"></i><i class="sk b"></i></div>', SKROWS = '<i class="sk row"></i><i class="sk row"></i><i class="sk row"></i>';
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
::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-button{display:none}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.45);background-clip:padding-box}
@supports not selector(::-webkit-scrollbar){*{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.35) transparent}}
input[type=range]{-webkit-appearance:none;appearance:none;height:5px;border-radius:5px;background:rgba(120,120,128,.4);outline:none;cursor:pointer}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:24px;height:24px;border-radius:50%;background:#fff;border:0;box-shadow:0 1px 5px rgba(0,0,0,.35),0 0 0 .5px rgba(0,0,0,.08)}
input[type=range]::-moz-range-thumb{width:24px;height:24px;border-radius:50%;background:#fff;border:0;box-shadow:0 1px 5px rgba(0,0,0,.35)}
input[type=range]::-moz-range-track{height:5px;border-radius:5px;background:rgba(120,120,128,.4)}`;
function ensureUI() {                                  // makes the loaders work even if index.html / style.css are older
  if (!document.getElementById('tf-css')) { const st = document.createElement('style'); st.id = 'tf-css'; st.textContent = CSS_UI; document.head.appendChild(st); }
  if (!$('#busy')) { const b = document.createElement('div'); b.id = 'busy'; b.className = 'glass busy'; b.hidden = true; b.innerHTML = '<i class="spin"></i><span id="busytxt"></span>'; document.body.appendChild(b); }
  if (!$('#here')) { const b = document.createElement('button'); b.id = 'here'; b.className = 'glass here'; b.hidden = true; b.title = 'Select this country'; document.body.appendChild(b); }
  const lt = $('#lite');
  if (lt && !$('#hop')) {
    let v = 50; try { v = +localStorage.getItem('tf-hop') || 50; } catch (e) { /* ignore */ }
    lt.closest('label').insertAdjacentHTML('afterend', `<label class="row"><span>Heat map opacity: <b id="hopv">${v}</b>%</span><input type="range" id="hop" min="10" max="100" value="${v}"></label>`);
  }
  const ld = $('#loading'), h = ld && ld.querySelector('h1');
  if (h && !ld.querySelector('.skrow')) h.insertAdjacentHTML('afterend', '<div class="skrow"><i class="sk"></i><i class="sk"></i><i class="sk"></i><i class="sk"></i></div>');
}
function busy(text, fn, skel = true) {              // show spinner + skeleton, let the browser paint, then do the heavy work
  const id = ++busyN; let b;
  try { ensureUI(); b = $('#busy'); $('#busytxt').textContent = text; b.hidden = false; b.classList.add('on'); if (skel) { $('#detail').innerHTML = SKEL; $('#status').classList.add('loading'); } }
  catch (e) { console.warn(e); return fn(); }       // the loader must never block the action itself
  requestAnimationFrame(() => setTimeout(() => {
    try { fn(); } catch (e) { console.error(e); }
    finally { if (id === busyN) { $('#status').classList.remove('loading'); b.classList.remove('on'); setTimeout(() => { if (id === busyN) b.hidden = true; }, 220); } }
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
  const W = lite ? 2048 : 4096, H = W / 2, rs = sel >= 0 && A1 ? regionStats(sel) : null, key = W + '|' + sel + '|' + (rs ? 1 : 0);
  if (key === oKey) return; oKey = key;
  if (!BBW.length) BBW = FEATS.map(f => { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; return Math.max(...polys.map(p => { const xs = p[0].map(c => c[0]); return Math.max(...xs) - Math.min(...xs); })); });
  if (oc.width !== W) { oc.width = W; oc.height = H; lab.userData.tx.dispose(); }
  ox.clearRect(0, 0, W, H); ox.lineJoin = 'round';
  const u = W / 2048;
  ox.lineWidth = u * 1.1; ox.strokeStyle = 'rgba(255,255,255,.55)'; ox.beginPath();
  FEATS.forEach((f, i) => { if (i !== sel) tracePath(f, W, H, ox); }); ox.stroke();
  if (rs && rs.ranked.length) {                        // region outlines, colour = how often that region burns
    const top = Math.log1p(rs.ranked[0].n) || 1;
    for (const r of rs.regs) {
      const l = r.n > 0 ? Math.max(.08, Math.log1p(r.n) / top) : 0, col = colorL(l);
      ox.beginPath(); tracePath(r.f, W, H, ox);
      if (l) { ox.fillStyle = col.replace('rgb', 'rgba').replace(')', ',.16)'); ox.fill(); }
      ox.lineWidth = u * (l ? 1.6 : .8); ox.strokeStyle = l ? col : 'rgba(255,255,255,.3)'; ox.stroke();
    }
  }
  ox.globalAlpha = 1; lab.userData.tx.needsUpdate = true;
}

/* ---------- country names: ONE size for every country, shown only on the side facing you ---------- */
let hiI = -1, loI = -1, NB = null, nameDirty = true, laidAt = 0, camKey = '', sbRight = 0, shown = [];
const NAME_PX = 11, FACE_DEG = 42, COS_FACE = Math.cos(42 * Math.PI / 180), nameEls = [], nctx = document.createElement('canvas').getContext('2d');
nctx.font = `600 ${NAME_PX}px ${getComputedStyle(document.body).fontFamily}`;
const nameW = new Map();
if (document.fonts) document.fonts.ready.then(() => { nctx.font = `600 ${NAME_PX}px ${getComputedStyle(document.body).fontFamily}`; nameW.clear(); updateNames(); });
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
function updateNames() { nameDirty = true; }
function layoutNames() {                                 // which names fit and where: throttled while the globe moves
  const host = $('#names'); if (!host || !countries.length || !FEATS.length) return;
  if (!nameEls.length) countries.forEach((c, i) => { const s = document.createElement('span'); s.className = 'cn'; s.textContent = c.name; host.appendChild(s); nameEls[i] = s; });
  const p = globe.pointOfView(), rad = Math.PI / 180, bb = nameBoxes();
  sbRight = $('#controls').getBoundingClientRect().right; const W = innerWidth, H = innerHeight;
  const cand = [];
  for (let i = 0; i < countries.length; i++) {
    const c = countries[i];
    if (sel >= 0 && i !== sel) continue;                 // a country is open: only its name
    const cosd = Math.sin(p.lat * rad) * Math.sin(c.lat * rad) + Math.cos(p.lat * rad) * Math.cos(c.lat * rad) * Math.cos((p.lng - c.lng) * rad);
    if (cosd < COS_FACE) continue;                       // not facing you
    const o = globe.getScreenCoords(c.lat, c.lng, 0.002); if (!o) continue;
    if (o.x < sbRight + 8 || o.x > W - 8 || o.y < 8 || o.y > H - 8) continue;   // behind the sidebar or off screen
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
  const placed = [], show = new Set(); shown = [];
  for (const q of cand) {
    const h = NAME_PX + 4;
    if (!q.forced && placed.some(r => Math.abs(r.x - q.x) < (r.w + q.w) / 2 + 4 && Math.abs(r.y - q.y) < (r.h + h) / 2 + 2)) continue;
    placed.push({ x: q.x, y: q.y, w: q.w, h }); show.add(q.i);
    const el = nameEls[q.i], cls = 'cn' + (q.i === sel ? ' sel' : q.i === hiI ? ' hi' : q.i === loI ? ' lo' : '');
    if (el._c !== cls) { el.className = cls; el._c = cls; }
    el.title = q.i === hiI ? 'Most burning' : q.i === loI ? 'Least burning' : '';
    el.style.display = 'block'; shown.push({ i: q.i, el });
  }
  nameEls.forEach((el, i) => { if (!show.has(i) && el.style.display !== 'none') el.style.display = 'none'; });
}
function moveNames() {                                   // cheap: only projects the names already chosen, every rendered frame
  const p = globe.pointOfView(), r = Math.PI / 180, sl = Math.sin(p.lat * r), cl = Math.cos(p.lat * r);
  for (const s of shown) {
    const c = countries[s.i], cosd = sl * Math.sin(c.lat * r) + cl * Math.cos(c.lat * r) * Math.cos((p.lng - c.lng) * r);
    const o = cosd > COS_FACE - .05 ? globe.getScreenCoords(c.lat, c.lng, 0.002) : null;
    if (!o || o.x < sbRight + 8 || o.x > innerWidth - 8 || o.y < 8 || o.y > innerHeight - 8) { s.el.style.opacity = 0; continue; }
    s.el.style.opacity = Math.max(0, Math.min(1, (cosd - COS_FACE) / .08));
    s.el.style.transform = `translate3d(${o.x.toFixed(1)}px,${o.y.toFixed(1)}px,0) translate(-50%,-50%)`;
  }
}
globe.scene().onAfterRender = () => {                    // runs right after the canvas is drawn, so text and map share one camera
  if (!FEATS.length || !countries.length || tx.busy || tx.view !== 'globe') return;
  const e = globe.camera().matrixWorld.elements, key = `${e[12]},${e[13]},${e[14]},${innerWidth},${innerHeight}`;
  if (key === camKey && !nameDirty) return;
  const moved = key !== camKey, now = performance.now(); camKey = key; if (moved) nameDirty = true;
  if (nameDirty && now - laidAt > (moved ? 120 : 0)) { layoutNames(); laidAt = now; nameDirty = false; }
  moveNames();
};
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
const oceanAt = (la, lo) => la > 66 ? 'Arctic Ocean' : la < -60 ? 'Southern Ocean' : lo >= -70 && lo < 20 ? 'Atlantic Ocean'
  : lo >= 20 && la < 30 && lo < (la < 0 ? 147 : 100) ? 'Indian Ocean' : lo >= 20 && lo < 130 && la >= 30 ? 'Open water' : 'Pacific Ocean';   // rough ocean basins
function placeOf(lat, lng) {                           // [province, region, country index] of a point
  const i = countryAt(lat, lng);
  if (i < 0) return [oceanAt(lat, lng), '', -1];
  const regs = A1 ? regionsOf(i) : [], r = regs.length ? regs[regionIndex(regs, lat, lng)] : null;
  return r ? [[r.name, r.region && r.region !== r.name ? r.region : ''].filter(Boolean).join(', '), countries[i].name, i] : [countries[i].name, '', i];
}
let hereT = 0;
function updateHere(force) {                          // pill under the globe: where the centre of the view is
  const now = performance.now(); if (!force && now - hereT < 200) return; hereT = now;
  const el = $('#here'); if (!el || !FEATS.length) return;
  const p = globe.pointOfView(), [main, sub, i] = placeOf(p.lat, p.lng), html = `<b>${main}</b>${sub ? `<span>${sub}</span>` : ''}`;
  el.dataset.i = i; if (el._h !== html) { el.innerHTML = html; el._h = html; } el.hidden = false;
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
  globe.pathsData(sel >= 0 && f ? (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat(1)) : area && !areaHidden ? area.paths : []);
}
function paintHeat() {
  setSelPath(); paintMask(); paintOutlines();
  if (!heat) return;
  const W = lite ? 1024 : 2048, H = W / 2;
  if (hc.width !== W) { hc.width = W; hc.height = H; heat.userData.tx.dispose(); }
  hx.clearRect(0, 0, W, H);
  {
    const d = W / 360 * (cur.res || 2) * 4.2;
    for (const q of cur) {                            // cur is sorted weak to strong, so hot spots end up on top
      const l = heatLevel(q.hv);
      if (l < .02) continue;
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
  area = null; globe.pathsData([]); sel = i; tab = 'stats'; loc = null; globe.ringsData([]); globe.controls().autoRotate = false; fadeTo(1);
  flyTo({ lat: countries[i].lat, lng: countries[i].lng, altitude: 1.8 });
  draw(); materialize($('#detail'), { dx: -14, dy: 0 });
  loadAdmin1().then(() => { if (sel === i) { oKey = ''; paintHeat(); detail(); } });
}
function clearNow() { sel = -1; loc = null; area = null; globe.pathsData([]); globe.ringsData([]); fadeTo(0); draw(); materialize($('#detail'), { dx: 0, dy: 8 }); }


/* ---------- regions (provinces / states): names, frequency outlines, temperature ---------- */
const A1_URLS = ['assets/admin1.geojson',
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces.geojson',
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson'];
let A1 = null, A1p = null, TEMP = null, CMAP = null, a1Done = false;
const RG = new Map(), RS = new Map();
const normName = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const degC = k => (k - 273.15).toFixed(1) + ' °C';
function loadAdmin1() {                                 // first-level regions (Natural Earth admin-1) + optional temperature summary
  return A1p || (A1p = (async () => {
    for (const u of A1_URLS) { try { const r = await fetch(u); if (r.ok) { A1 = (await r.json()).features; break; } } catch (e) { /* try the next source */ } }
    try { const r = await fetch('dataset/temp.json?v=' + M.stamp); if (r.ok) TEMP = await r.json(); } catch (e) { /* optional */ }
    a1Done = true; return A1;
  })());
}
function a1Country(f) {
  if (f.__c !== undefined) return f.__c;
  if (!CMAP) { CMAP = new Map(); FEATS.forEach((g, i) => { const p = g.properties || {}; [p.ADM0_A3, p.ADMIN, p.NAME, p.NAME_LONG].forEach(k => { const n = normName(k); if (n && !CMAP.has(n)) CMAP.set(n, i); }); }); }
  const p = f.properties || {};
  let i = CMAP.get(normName(p.adm0_a3)); if (i === undefined) i = CMAP.get(normName(p.admin));
  return f.__c = i === undefined ? -1 : i;
}
function bbox(ring) { let x0 = 181, y0 = 91, x1 = -181, y1 = -91; for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; }
function regionsOf(i) {
  if (!A1) return [];                                   // boundaries still loading: do not cache an empty answer
  if (RG.has(i)) return RG.get(i);
  const regs = (A1 || []).filter(f => a1Country(f) === i && f.geometry).map(f => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const parts = polys.map(rings => ({ b: bbox(rings[0]), rings }));
    const big = parts.reduce((a, b) => (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]) > (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]) ? b : a);
    const p = f.properties || {};
    return { name: p.name || p.name_en || p.woe_name || 'Unnamed region', f, parts, lat: (big.b[1] + big.b[3]) / 2, lng: (big.b[0] + big.b[2]) / 2, region: p.region || '', n: 0 };
  });
  RG.set(i, regs); return regs;
}
function regionIndex(regs, lat, lng) {
  for (let k = 0; k < regs.length; k++) for (const p of regs[k].parts)
    if (lng >= p.b[0] && lng <= p.b[2] && lat >= p.b[1] && lat <= p.b[3] && inRing(p.rings[0], lng, lat) && !p.rings.slice(1).some(h => inRing(h, lng, lat))) return k;
  let best = -1, bd = Infinity;                         // coastal cells fall outside the simplified polygons: use the nearest region
  regs.forEach((r, k) => { const d = (r.lat - lat) ** 2 + ((r.lng - lng) * Math.cos(lat * Math.PI / 180)) ** 2; if (d < bd) { bd = d; best = k; } });
  return best;
}
function regionStats(i) {                               // detections per region (all years, current overlap scaling) + yearly history + temperature
  if (RS.has(i)) return RS.get(i);
  const regs = regionsOf(i); if (!regs.length) { if (A1) RS.set(i, null); return null; }
  const W = M.nx, scale = overlapScale(0), off = M.years[0] - M.y0, ny = M.years[1] - M.years[0] + 1, cr = new Map();
  regs.forEach(r => { r.n = 0; r.a = new Array(ny).fill(0); r.tmin = Infinity; r.tmax = -Infinity; r.tsum = 0; r.tn = 0; });
  for (let j = 0; j < N; j++) {
    const cell = CELL[j]; if (CC[cell] !== i) continue;
    let k = cr.get(cell);
    if (k === undefined) { const iy = (cell / W) | 0, ix = cell - iy * W; k = regionIndex(regs, 90 - (iy + .5) * 180 / M.ny, -180 + (ix + .5) * 360 / M.nx); cr.set(cell, k); }
    if (k < 0) continue;
    const c = CNT[j] * (SN[j] ? scale : 1); regs[k].n += c; const y = YR[j] - off; if (y >= 0 && y < ny) regs[k].a[y] += c;
  }
  if (TEMP) for (let t = 0; t < TEMP.cells.length; t++) {
    const id = TEMP.cells[t], iy = (id / TEMP.nx) | 0, lat = 90 - iy - .5, lng = -180 + (id - iy * TEMP.nx) + .5;
    if (CC[Math.floor((90 - lat) * 2) * M.nx + Math.floor((lng + 180) * 2)] !== i) continue;
    const r = regs[regionIndex(regs, lat, lng)]; if (!r) continue;
    r.tmin = Math.min(r.tmin, TEMP.min[t]); r.tmax = Math.max(r.tmax, TEMP.max[t]); r.tsum += TEMP.mean[t] * TEMP.n[t]; r.tn += TEMP.n[t];
  }
  const out = { regs, ranked: regs.filter(r => r.n > 0).sort((a, b) => b.n - a.n) };
  RS.set(i, out); return out;
}
const regionsReady = () => sel >= 0 && !!regionStats(sel);

/* ---------- panel: overview first, then Statistics / History / Locations ---------- */
const TOP = new Map(), TABS = [['stats', 'Statistics'], ['hist', 'History']];
const row = (a, b) => `<div class="evt"><span>${a}</span><span>${b}</span></div>`;
function tops() {                                  // fallback when region boundaries are unavailable: busiest 1-degree areas
  if (TOP.has(sel)) return TOP.get(sel);
  const m = new Map(), W = M.nx, H = W >> 1;
  const scale = overlapScale(0);
  for (let i = 0; i < N; i++) { const cell = CELL[i]; if (CC[cell] !== sel) continue; const iy = (cell / W) | 0, k = (iy >> 1) * H + ((cell - iy * W) >> 1); m.set(k, (m.get(k) || 0) + CNT[i] * (SN[i] ? scale : 1)); }
  const r = [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => { const by = (k / H) | 0; return { lat: 90 - by - .5, lng: -180 + (k - by * H) + .5, n }; });
  TOP.set(sel, r); return r;
}
function locRegion(k) {                                // yearly history of one named region
  const r = regionStats(sel).regs[k];
  loc = { name: r.name, lat: r.lat, lng: r.lng, a: r.a, r }; tab = 'hist'; globe.ringsData([loc]); detail();
}
function locAt(lat, lng) {                             // click on the globe: named region if boundaries are loaded, otherwise the 1-degree spot
  if (regionsReady()) { const k = regionIndex(regionStats(sel).regs, lat, lng); if (k >= 0) return locRegion(k); }
  const by = Math.floor(90 - lat), bx = Math.floor(lng + 180), W = M.nx, off = M.years[0] - M.y0, a = new Array(M.years[1] - M.years[0] + 1).fill(0);
  const scale = overlapScale(0);
  for (let i = 0; i < N; i++) { const cell = CELL[i], iy = (cell / W) | 0; if ((iy >> 1) === by && ((cell - iy * W) >> 1) === bx) a[YR[i] - off] += CNT[i] * (SN[i] ? scale : 1); }
  loc = { name: `${(90 - by - .5).toFixed(1)}, ${(-180 + bx + .5).toFixed(1)}`, lat: 90 - by - .5, lng: -180 + bx + .5, a }; tab = 'hist'; globe.ringsData([loc]); detail();
}
function overview() {
  if (!rk.length) return '<p class="hint">No detections for these filters.</p>';
  const mean = rk.reduce((a, r) => a + r[1], 0) / rk.length, hi = rk[0], lo = rk[rk.length - 1];
  const t = (l, e, v) => `<button class="tile" ${e ? `data-i="${e[0]}"` : ''}><span class="hint">${l}</span><b>${v}</b><span>${e ? countries[e[0]].name : 'per country'}</span></button>`;
  return `<div class="overview"><h3>Overview</h3><div class="tiles">${t('Mean', null, fmt(mean))}${t('Highest', hi, fmt(hi[1]))}${t('Lowest', lo, fmt(lo[1]))}</div></div>`;
}
const CTYPES = [['bar', 'Vertical bars'], ['hbar', 'Horizontal bars'], ['line', 'Line'], ['pie', 'Pie']];
const CT = { year: 'bar', season: 'bar', loc: 'bar' };
let histView = 'year', topN = 1, hexPct = .1;

/* ---------- charts: card look, ease-in-out pop-in. `seen` makes a chart animate only when it is new or changed, not on every redraw ---------- */
const seen = new Map(), fresh = (id, sig) => { const f = seen.get(id) !== sig; seen.set(id, sig); return f; };
const nice = m => { if (!(m > 0)) return 1; const p = 10 ** Math.floor(Math.log10(m)), r = m / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p; };
const sh = n => n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? +(n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k' : n < 10 ? String(+n.toFixed(1)) : String(Math.round(n));
let gidN = 0;
function smooth(p) {                                    // monotone cubic curve: smooth, never dips below a flat run
  const n = p.length, F = v => v.toFixed(1);
  if (n < 3) return 'M' + p.map(q => F(q[0]) + ',' + F(q[1])).join('L');
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${F(p[0][0])},${F(p[0][1])}`;
  for (let i = 0; i < n - 1; i++) { const h = dx[i] / 3; d += `C${F(p[i][0] + h)},${F(p[i][1] + t[i] * h)} ${F(p[i + 1][0] - h)},${F(p[i + 1][1] - t[i + 1] * h)} ${F(p[i + 1][0])},${F(p[i + 1][1])}`; }
  return d;
}
function chart(kind, a, f, attr) {                      // one data series, four looks; attr (data-y) makes a point clickable
  const n = a.length, m = Math.max(...a) || 1, mx = nice(m), at = i => attr ? `${attr}="${i}"` : '', tip = i => `${f(i)}: ${Math.round(a[i]).toLocaleString()}`;
  const step = Math.min(45, Math.round(520 / Math.max(n, 1))), dl = i => `style="--d:${i * step}ms"`, lab = Math.max(1, Math.ceil(n / 6));
  if (kind === 'hbar') return `<div class="hb">${a.map((v, i) => `<div ${at(i)} ${dl(i)} title="${tip(i)}"><span>${f(i)}</span><s><i class="${v === m ? 'peak' : ''}" style="width:${v > 0 ? Math.max(2, v / mx * 100) : 0}%"></i></s><b>${sh(v)}</b></div>`).join('')}</div>`;
  if (kind === 'line') {
    const W = 320, H = 156, L = 34, R = 10, T = 12, B = 24, pw = W - L - R, ph = H - T - B, st = pw / n, X = i => L + (i + .5) * st, Y = v => T + ph - v / mx * ph;
    const pts = a.map((v, i) => [X(i), Y(v)]), d = smooth(pts), id = 'lg' + (gidN++), pk = a.indexOf(m), dots = n <= 12;
    const grid = [0, .5, 1].map(q => `<line class="gl" x1="${L}" x2="${W - R}" y1="${(T + ph - q * ph).toFixed(1)}" y2="${(T + ph - q * ph).toFixed(1)}"/><text class="yl" x="${L - 7}" y="${(T + ph - q * ph + 3.5).toFixed(1)}" text-anchor="end">${sh(mx * q)}</text>`).join('');
    const xl = a.map((v, i) => i % lab === 0 ? `<text class="xt" x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${f(i)}</text>` : '').join('');
    const hits = a.map((v, i) => `<g class="hit" ${at(i)}><rect x="${(L + i * st).toFixed(1)}" y="0" width="${st.toFixed(1)}" height="${H - B + 6}"><title>${tip(i)}</title></rect><circle class="hv" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="4.5"/></g>`).join('');
    const dts = a.map((v, i) => dots || i === pk ? `<circle class="dt${i === pk ? ' pk' : ''}" style="--d:${Math.round(260 + i / Math.max(n - 1, 1) * 760)}ms" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${i === pk ? 4.5 : 3.6}"/>` : '').join('');
    return `<svg class="ln" viewBox="0 0 ${W} ${H}" role="img"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a7ff8" stop-opacity=".5"/><stop offset="1" stop-color="#4a7ff8" stop-opacity="0"/></linearGradient></defs>${grid}${xl}<path class="a" fill="url(#${id})" d="${d}L${X(n - 1).toFixed(1)},${T + ph}L${X(0).toFixed(1)},${T + ph}Z"/><path class="l" pathLength="1" d="${d}"/>${dts}${hits}</svg>`;
  }
  if (kind === 'pie') {
    const tot = a.reduce((q, v) => q + v, 0) || 1, sl = a.map((v, i) => ({ v, i, col: colorL(.15 + .85 * v / m) })).filter(q => q.v > 0), R = 47, r = 3.5, gap = 2.2, Rr = R - r, C = 50;
    let ang = -Math.PI / 2;
    const paths = sl.map((q, k) => {
      const fr = q.v / tot, a1 = ang, a2 = ang + fr * 2 * Math.PI, mid = (a1 + a2) / 2; ang = a2;
      let d;
      if (sl.length === 1 || fr > .9999) d = `M${C},${C - Rr}A${Rr},${Rr} 0 1 1 ${C - .01},${C - Rr}Z`;
      else {                                            // wedge pulled back by r and gap, then stroked with r: rounded corners with an even gap between slices
        const h = fr * Math.PI, off = Math.min((r + gap / 2) / Math.sin(h), Rr * .85), ux = Math.cos(mid), uy = Math.sin(mid), ax = C + off * ux, ay = C + off * uy;
        const hit = ang0 => { const ex = Math.cos(ang0), ey = Math.sin(ang0), b = off * (ux * ex + uy * ey), tt = -b + Math.sqrt(Math.max(0, b * b - off * off + Rr * Rr)); return [ax + tt * ex, ay + tt * ey]; };
        const [x1, y1] = hit(a1), [x2, y2] = hit(a2);
        d = `M${ax.toFixed(2)},${ay.toFixed(2)}L${x1.toFixed(2)},${y1.toFixed(2)}A${Rr},${Rr} 0 ${fr > .5 ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}Z`;
      }
      return `<path ${at(q.i)} style="--d:${k * 70}ms" d="${d}" fill="${q.col}" stroke="${q.col}" stroke-width="${2 * r}" stroke-linejoin="round"><title>${tip(q.i)}</title></path>`;
    }).join('');
    const legend = [...sl].sort((x, y) => y.v - x.v).slice(0, 6).map((q, k) => `<li ${at(q.i)} style="--d:${400 + k * 70}ms"><i style="background:${q.col}"></i><span>${f(q.i)}</span><b>${sh(q.v)}</b><em>${Math.round(q.v / tot * 100)}%</em></li>`).join('');
    return `<div class="pie"><svg viewBox="0 0 100 100" role="img">${paths}</svg><ul>${legend}</ul></div>`;
  }
  const cols = a.map((v, i) => `<div class="col${v === m ? ' pk' : ''}" ${at(i)} ${dl(i)} title="${tip(i)}"><b class="v${v === m ? ' top' : ''}">${v > 0 && (n <= 12 || v === m) ? sh(v) : ''}</b><i class="bar" style="height:${v > 0 ? Math.max(1.5, v / mx * 100) : 0}%"></i></div>`).join('');
  const xl = a.map((v, i) => `<span>${i % lab === 0 ? `<em>${f(i)}</em>` : ''}</span>`).join('');
  return `<div class="vb"><div class="plot">${[0, .5, 1].map(q => `<i class="g" style="bottom:${q * 100}%"><u>${sh(mx * q)}</u></i>`).join('')}<div class="cols">${cols}</div></div><div class="xl">${xl}</div></div>`;
}
const block = (key, title, a, f, attr) => {
  const an = fresh(key, `${sel}|${CT[key]}|${a.length}|${Math.round(a.reduce((q, v) => q + v, 0))}|${loc ? loc.name : ''}`);
  return `<div class="chart${an ? ' anim' : ''}"><div class="chead"><h3>${title}</h3><select data-ct="${key}" aria-label="${title} chart style">${CTYPES.map(([k, l]) => `<option value="${k}"${CT[key] === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>${chart(CT[key], a, f, attr)}</div>`;
};
function detail() {
  renderList(); $('#clr').hidden = sel < 0 && !area;
  const box = $('#detail');
  if (area) { box.innerHTML = areaView(); return; }
  if (sel < 0) { seen.clear(); box.innerHTML = overview(); return; }
  const c = countries[sel], metrics = countryMetrics(c), y0 = M.years[0], tot = metrics.total;
  const back = '';
  if (!tot) { box.innerHTML = `<p class="name">${c.name}</p><p class="hint">No detections in this dataset.</p>${back}`; return; }
  const top = Math.max(...metrics.years), mt = Math.max(...metrics.months);
  let body;
  const rs = regionsReady() ? regionStats(sel) : null, ranked = rs ? rs.ranked : [], nTop = Math.min(topN, ranked.length);
  const avg = rs ? (ranked.length ? tot / ranked.length : 0) : tot / (metrics.years.filter(n => n > 0).length || 1);
  const warm = rs ? rs.regs.filter(r => r.tn > 0) : [], tAll = warm.reduce((q, r) => q + r.tn, 0);
  const hiT = warm.length ? warm.reduce((x, y) => y.tmax > x.tmax ? y : x) : null, loT = warm.length ? warm.reduce((x, y) => y.tmin < x.tmin ? y : x) : null;
  const topPick = `<div class="row">Show top<div class="seg3" role="group" aria-label="Top regions to show">${[1, 2, 3].map(n => `<button type="button" data-n="${n}" aria-pressed="${topN === n}">${n}</button>`).join('')}</div></div>`;
  const regRows = rs ? (ranked.length ? `${topPick}${ranked.slice(0, nTop).map((r, i) => row(nTop > 1 ? `#${i + 1} burning region` : 'Highest burning region', `<b>${r.name}</b> · ${fmt(r.n)}`)).join('')}${row('Lowest burning region', `<b>${ranked[ranked.length - 1].name}</b> · ${fmt(ranked[ranked.length - 1].n)}`)}` : '')
    : A1 ? '<p class="hint">No region boundaries matched this country.</p>' : a1Done ? '<p class="hint">Region names need assets/admin1.geojson (could not be downloaded).</p>' : SKROWS;
  const tempRows = !rs ? '' : warm.length ? `${row('Highest temperature', `<b>${degC(hiT.tmax)}</b> · ${hiT.name}`)}${row('Lowest temperature', `<b>${degC(loT.tmin)}</b> · ${loT.name}`)}${row('Average temperature', `<b>${degC(warm.reduce((q, r) => q + r.tsum, 0) / tAll)}</b>`)}`
    : '<p class="hint">Temperature needs dataset/temp.json: run <code>python run.py --rebuild</code> once.</p>';
  if (tab === 'stats') body = `<div class="stats"><div><b>${fmt(tot)}</b>overall</div><div><b>${fmt(avg)}</b>${rs ? 'average per region' : 'average per year'}</div></div>
    <div class="stats"><div><b>${y0 + metrics.years.indexOf(top)}</b>peak year</div><div><b>${MON[metrics.months.indexOf(mt)]}</b>busiest month</div></div>
    ${regRows}${tempRows}`;
  else {
    const list = rs ? ranked.slice(0, 10).map(r => `<button class="ci" data-r="${rs.regs.indexOf(r)}"><span>${r.name}</span><span class="hint">${fmt(r.n)}</span></button>`).join('')
      : tops().map(p => `<button class="ci" data-l="${p.lat},${p.lng}"><span>${p.lat.toFixed(1)}, ${p.lng.toFixed(1)}</span><span class="hint">${fmt(p.n)}</span></button>`).join('');
    const lt = loc && loc.r && loc.r.tn ? `${row('Temperature high / low', `${degC(loc.r.tmax)} / ${degC(loc.r.tmin)}`)}${row('Average temperature', degC(loc.r.tsum / loc.r.tn))}` : '';
    const hv = (k, l) => `<button type="button" data-v="${k}" aria-pressed="${histView === k}">${l}</button>`;
    body = `<div class="seg3" role="group" aria-label="History view">${hv('year', 'Per year')}${hv('season', 'Seasonality')}${hv('both', 'Both')}</div>
    <div class="hgrid${histView === 'both' ? ' two' : ''}">${histView !== 'season' ? block('year', 'Per year', metrics.years, i => y0 + i, 'data-y') : ''}${histView !== 'year' ? block('season', 'Seasonality', metrics.months, i => MON[i], '') : ''}</div>
    <h3>${rs ? 'Busiest regions' : 'Hotspot areas (about 100 km)'}</h3>${list || '<p class="hint">None.</p>'}
    ${loc ? `${block('loc', `${loc.name} per year`, loc.a, i => y0 + i, '')}${lt}` : ''}`;
  }
  box.innerHTML = `<p class="name">${c.name}</p><div class="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>${body}${back}`;
}

/* ---------- search by country: ranked list under the dashboard, filtered as you type ---------- */
const norm = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function renderList() {
  const box = $('#clist'), inp = $('#csearch'); if (!box || !inp || !countries.length) return;
  const q = norm(inp.value), top = box.scrollTop;
  let items = rk.map(([i, n]) => [i, n]);
  if (q) { const have = new Set(items.map(x => x[0])); countries.forEach((c, i) => { if (!have.has(i)) items.push([i, 0]); }); items = items.filter(([i]) => norm(countries[i].name).includes(q)); items.sort((a, b) => (norm(countries[a[0]].name).startsWith(q) ? 0 : 1) - (norm(countries[b[0]].name).startsWith(q) ? 0 : 1) || b[1] - a[1]); }
  box.innerHTML = items.length ? items.slice(0, 300).map(([i, n]) => `<button type="button" class="ci${i === sel ? ' sel' : ''}" role="listitem" data-i="${i}"><span>${countries[i].name}</span><span class="hint">${n ? fmt(n) : 'none'}</span></button>`).join('') : '<p class="hint">No country matches.</p>';
  box.scrollTop = top;
}
$('#csearch').addEventListener('input', () => { $('#clist').scrollTop = 0; renderList(); });
$('#csearch').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); e.target.value = ''; renderList(); }
  if (e.key === 'Enter') { const b = $('#clist .ci'); if (b) pick(+b.dataset.i); }
});
$('#clr').addEventListener('click', () => clear());
document.querySelectorAll('.acc-h').forEach(b => b.addEventListener('click', () => {
  const sec = b.closest('.acc'), open = !sec.classList.contains('open');
  sec.classList.toggle('open', open); b.setAttribute('aria-expanded', open);
  if (open && sec.id === 'search' && smode === 'country') setTimeout(() => $('#csearch').focus({ preventScroll: true }), 60);
}));
$('#clist').addEventListener('click', e => { const b = e.target.closest('.ci'); if (b) pick(+b.dataset.i); });

/* ---------- search by GeoJSON file or drawn rectangle: analyse any area ---------- */
let smode = 'country', drawing = false, drag = null;
const AREA_MAX_BYTES = 25e6;
function pip(rings, x, y) {                              // even-odd test over outer ring + holes
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function areaMask(a) {                                   // which 0.5-degree data cells have their centre inside the area
  const W = M.nx, H = M.ny, dx = 360 / W, dy = 180 / H, m = new Uint8Array(NC);
  let cells = 0, km2 = 0;
  const mark = (iy, ix) => { m[iy * W + ix] = 1; cells++; km2 += dx * dy * 111.32 * 111.32 * Math.cos((90 - (iy + .5) * dy) * Math.PI / 180); };
  if (a.rect) {
    const [la0, la1, lo, w] = a.rect;
    for (let iy = Math.max(0, Math.floor((90 - la1) / dy)); iy <= Math.min(H - 1, Math.floor((90 - la0) / dy)); iy++) {
      const la = 90 - (iy + .5) * dy; if (la < la0 || la > la1) continue;
      for (let ix = 0; ix < W; ix++) if ((((-180 + (ix + .5) * dx - lo) % 360) + 360) % 360 <= w) mark(iy, ix);
    }
  } else for (const poly of a.polys) {
    const [x0, y0, x1, y1] = bbox(poly[0]);
    const ix0 = Math.max(0, Math.floor((x0 + 180) / dx)), ix1 = Math.min(W - 1, Math.floor((x1 + 180) / dx));
    for (let iy = Math.max(0, Math.floor((90 - y1) / dy)); iy <= Math.min(H - 1, Math.floor((90 - y0) / dy)); iy++) {
      const la = 90 - (iy + .5) * dy;
      for (let ix = ix0; ix <= ix1; ix++) if (!m[iy * W + ix] && pip(poly, -180 + (ix + .5) * dx, la)) mark(iy, ix);
    }
  }
  return { m, cells, km2 };
}
function analyseArea(a) {                                // detections per year inside the area (all years, current overlap scaling) + temperature
  const scale = overlapScale(0), key = scale + '|' + (TEMP ? 1 : 0);
  if (a.key === key) return a.res;
  const mk = a.mk || (a.mk = areaMask(a)), m = mk.m;
  const off = M.years[0] - M.y0, ny = M.years[1] - M.years[0] + 1, years = new Array(ny).fill(0);
  let total = 0;
  if (mk.cells) for (let j = 0; j < N; j++) {
    if (!m[CELL[j]]) continue;
    const c = CNT[j] * (SN[j] ? scale : 1); total += c;
    const y = YR[j] - off; if (y >= 0 && y < ny) years[y] += c;
  }
  let tmin = Infinity, tmax = -Infinity, tsum = 0, tn = 0;
  if (TEMP && mk.cells) for (let t = 0; t < TEMP.cells.length; t++) {
    const id = TEMP.cells[t], iy = (id / TEMP.nx) | 0, lat = 90 - iy - .5, lng = -180 + (id - iy * TEMP.nx) + .5;
    if (!m[Math.floor((90 - lat) * 2) * M.nx + Math.floor((lng + 180) * 2)]) continue;
    tmin = Math.min(tmin, TEMP.min[t]); tmax = Math.max(tmax, TEMP.max[t]); tsum += TEMP.mean[t] * TEMP.n[t]; tn += TEMP.n[t];
  }
  a.key = key; return a.res = { total, years, cells: mk.cells, km2: mk.km2, tmin, tmax, tmean: tn ? tsum / tn : 0, tn };
}
function areaView() {
  const r = analyseArea(area), y0 = M.years[0];
  if (!r.total) return `<p class="name">${area.name}</p><p class="hint">No detections in this area.</p>`;
  const top = Math.max(...r.years), avg = r.total / r.years.length;
  const temp = r.tn ? `${row('Highest temperature', `<b>${degC(r.tmax)}</b>`)}${row('Lowest temperature', `<b>${degC(r.tmin)}</b>`)}${row('Average temperature', `<b>${degC(r.tmean)}</b>`)}` : '';
  return `<p class="name">${area.name}</p>
    <div class="stats"><div><b>${fmt(r.total)}</b>overall</div><div><b>${fmt(avg)}</b>average per year</div></div>
    <div class="stats"><div><b>${y0 + r.years.indexOf(top)}</b>peak year</div><div><b>${fmt(r.km2)}</b>km² analysed</div></div>
    ${temp}${block('loc', 'Per year', r.years, i => y0 + i, '')}`;
}
function restorePaths() {
  const f = FEATS[sel];
  globe.pathsData(sel >= 0 && f ? (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat(1)) : area && !areaHidden ? area.paths : []);
}
function areaMsg(kind, text) { const el = $(kind === 'geo' ? '#gmsg' : '#rmsg'); el.textContent = text || ''; el.hidden = !text; }
function setArea(a) {
  busy('Analysing area …', () => {
    const had = sel >= 0;
    a.mk = areaMask(a);
    if (!a.mk.cells) { areaMsg(a.kind, 'That area is smaller than one data cell (about 55 km). Try a larger one.'); restorePaths(); return; }
    areaMsg(a.kind, '');
    area = a; areaHidden = false; sel = -1; loc = null; globe.ringsData([]); globe.pathsData(a.paths); globe.controls().autoRotate = false;
    if (had) { fadeTo(0); draw(); }
    detail(); materialize($('#detail'), { dx: -14, dy: 0 });
    flyTo({ lat: a.lat, lng: a.lng, altitude: Math.min(2.5, Math.max(.6, a.span / 40 + .4)) });
    loadAdmin1().then(() => { if (area === a) { a.key = ''; detail(); } });      // temperature table arrives with the region data
  });
}
function geoPolys(g, out = []) {
  if (!g || typeof g !== 'object') return out;
  if (g.type === 'FeatureCollection') (g.features || []).forEach(f => geoPolys(f, out));
  else if (g.type === 'Feature') geoPolys(g.geometry, out);
  else if (g.type === 'GeometryCollection') (g.geometries || []).forEach(x => geoPolys(x, out));
  else if (g.type === 'Polygon') out.push(g.coordinates);
  else if (g.type === 'MultiPolygon') (g.coordinates || []).forEach(p => out.push(p));
  return out;
}
async function loadGeoFile(file) {
  if (!file) return;
  if (file.size > AREA_MAX_BYTES) return areaMsg('geo', 'That file is too large (25 MB at most).');
  let polys;
  try { polys = geoPolys(JSON.parse(await file.text())); } catch (e) { return areaMsg('geo', 'That file is not valid GeoJSON.'); }
  polys = polys.map(p => (p || []).filter(r => Array.isArray(r) && r.length >= 3 && r.every(q => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])))).filter(p => p.length);
  if (!polys.length) return areaMsg('geo', 'No polygons found. Use a file with Polygon or MultiPolygon shapes.');
  const bb = polys.map(p => bbox(p[0])), x0 = Math.min(...bb.map(b => b[0])), y0 = Math.min(...bb.map(b => b[1])), x1 = Math.max(...bb.map(b => b[2])), y1 = Math.max(...bb.map(b => b[3]));
  if (x0 < -180 || x1 > 180 || y0 < -90 || y1 > 90) return areaMsg('geo', 'Coordinates must be longitude and latitude (WGS84).');
  const paths = []; polys.forEach(p => p.forEach(r => { const st = Math.max(1, Math.ceil(r.length / 1500)); const q = r.filter((_, i) => i % st === 0); q.push(r[0]); paths.push(q); }));
  setArea({ kind: 'geo', name: file.name.replace(/\.(geo)?json$/i, ''), polys, paths, lat: (y0 + y1) / 2, lng: (x0 + x1) / 2, span: Math.max(y1 - y0, x1 - x0) });
}
$('#gfile').addEventListener('change', e => { loadGeoFile(e.target.files[0]); e.target.value = ''; });
const dropEl = $('#drop');
['dragenter', 'dragover'].forEach(t => dropEl.addEventListener(t, e => { e.preventDefault(); dropEl.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => dropEl.addEventListener(t, e => { e.preventDefault(); dropEl.classList.remove('over'); }));
dropEl.addEventListener('drop', e => loadGeoFile(e.dataTransfer.files[0]));

function screenToGeo(ev) {                               // pointer position -> latitude / longitude on the globe, or null when it misses
  const cv = globe.renderer().domElement, r = cv.getBoundingClientRect(), cam = globe.camera();
  const nx = (ev.clientX - r.left) / r.width * 2 - 1, ny = -((ev.clientY - r.top) / r.height * 2 - 1);
  const V = cam.position.constructor, o = cam.position.clone(), d = new V(nx, ny, .5).unproject(cam).sub(o).normalize();
  const R = globe.getGlobeRadius(), b = o.dot(d), disc = b * b - (o.dot(o) - R * R);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc); if (t < 0) return null;
  const p = o.add(d.multiplyScalar(t)), g = globe.toGeoCoords({ x: p.x, y: p.y, z: p.z });
  return g ? { lat: g.lat, lng: g.lng } : null;
}
const wrapLng = x => ((x + 180) % 360 + 360) % 360 - 180;
function rectOf(a, b) {
  const dl = ((b.lng - a.lng + 540) % 360 + 360) % 360 - 180;
  return [Math.min(a.lat, b.lat), Math.max(a.lat, b.lat), dl >= 0 ? a.lng : a.lng + dl, Math.abs(dl)];
}
function rectRing([la0, la1, lo, w]) {
  const n = Math.max(2, Math.ceil(w)), k = Math.max(2, Math.ceil(la1 - la0)), p = [];
  for (let i = 0; i <= n; i++) p.push([wrapLng(lo + w * i / n), la0]);
  for (let i = 1; i <= k; i++) p.push([wrapLng(lo + w), la0 + (la1 - la0) * i / k]);
  for (let i = 1; i <= n; i++) p.push([wrapLng(lo + w - w * i / n), la1]);
  for (let i = 1; i <= k; i++) p.push([wrapLng(lo), la1 - (la1 - la0) * i / k]);
  return p;
}
function setDrawing(on) {
  drawing = on; drag = null;
  const b = $('#rbtn'); b.setAttribute('aria-pressed', on); b.textContent = on ? 'Cancel drawing' : 'Draw a rectangle';
  $('#globe').classList.toggle('drawing', on);
  globe.controls().enabled = !on;
  if (on) { globe.controls().autoRotate = false; areaMsg('rect', 'Drag on the globe to outline an area.'); }
  else { areaMsg('rect', ''); restorePaths(); }
}
$('#rbtn').addEventListener('click', () => setDrawing(!drawing));
$('#globe').addEventListener('pointerdown', e => {
  if (!drawing || e.button) return;
  const g = screenToGeo(e); if (!g) return;
  e.preventDefault(); e.stopPropagation(); drag = { a: g, b: g };
}, { capture: true });
addEventListener('pointermove', e => {
  if (!drag) return;
  const g = screenToGeo(e); if (!g) return;
  drag.b = g; globe.pathsData([rectRing(rectOf(drag.a, drag.b))]);
});
addEventListener('pointerup', e => {
  if (!drag) return;
  const d = drag; drag = null; noClickUntil = Date.now() + 400;
  const g = screenToGeo(e); if (g) d.b = g;
  const rect = rectOf(d.a, d.b);
  if (rect[1] - rect[0] < .3 || rect[3] < .3) { restorePaths(); return areaMsg('rect', 'Drag a larger area on the globe.'); }
  setDrawing(false);
  setArea({ kind: 'rect', name: 'Selected region', rect, paths: [rectRing(rect)], lat: (rect[0] + rect[1]) / 2, lng: wrapLng(rect[2] + rect[3] / 2), span: Math.max(rect[1] - rect[0], rect[3]) });
});
addEventListener('keydown', e => { if (e.key === 'Escape' && drawing) setDrawing(false); });
$('#smode').addEventListener('click', e => {
  const b = e.target.closest('[data-m]'); if (!b || b.dataset.m === smode) return;
  if (drawing) setDrawing(false);
  smode = b.dataset.m;
  $('#smode').querySelectorAll('[data-m]').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('#pane-country').hidden = smode !== 'country'; $('#pane-geo').hidden = smode !== 'geo'; $('#pane-rect').hidden = smode !== 'rect';
  if (smode === 'country') setTimeout(() => $('#csearch').focus({ preventScroll: true }), 60);
});

/* ---------- wiring ---------- */
/* ---------- sidebar (layout from 2nd.rar) ---------- */
function activateSidebarTab(name) {
  const dashboard = name === 'dashboard';
  $('#dashboard-tab').setAttribute('aria-selected', dashboard);
  $('#explore-tab').setAttribute('aria-selected', !dashboard);
  $('#dashboard-panel').hidden = !dashboard;
  $('#explore-panel').hidden = dashboard;
  $('#side-title').textContent = dashboard ? 'Dashboard' : 'Explore';
}
document.querySelectorAll('.sidebar-tabs [role="tab"]').forEach(button => {
  button.onclick = () => activateSidebarTab(button.id === 'dashboard-tab' ? 'dashboard' : 'explore');
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
addEventListener('keydown', e => { if (e.key === 'Escape' && sel >= 0 && tx.view === 'globe' && !tx.busy) clear(); });
['#modis', '#viirs', '#conf', '#cum', '#year', '#res'].forEach(s => $(s).addEventListener('input', redraw));
$('#conf').addEventListener('input', updateOverlapStatus);
$('#normalize').addEventListener('change', () => {
  TOP.clear(); RS.clear(); oKey = '';
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
  const t = e.target.closest('[data-i],[data-t],[data-l],[data-y],[data-r],[data-v],[data-n],#clr'); if (!t) return;
  if (t.id === 'clr') return clear();
  if (t.dataset.i) return pick(+t.dataset.i);
  if (t.dataset.t) { const d = TABS.findIndex(([k]) => k === t.dataset.t) - TABS.findIndex(([k]) => k === tab); tab = t.dataset.t; seen.clear(); detail(); return materialize($('#detail'), { dx: Math.sign(d) * 18, dy: 0, from: .99, response: .3 }); }
  if (t.dataset.v) { histView = t.dataset.v; seen.clear(); return detail(); }
  if (t.dataset.n) { topN = +t.dataset.n; return detail(); }
  if (t.dataset.r !== undefined) { const k = +t.dataset.r, r = regionStats(sel).regs[k]; flyTo({ lat: r.lat, lng: r.lng, altitude: 1.1 }); return locRegion(k); }
  if (t.dataset.l) { const [la, lo] = t.dataset.l.split(',').map(Number); flyTo({ lat: la, lng: lo, altitude: 1.1 }); return locAt(la, lo); }
  if (t.dataset.y !== undefined) { $('#year').value = M.years[0] + +t.dataset.y; redraw(); }
};
$('#detail').addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.ct; if (k) { CT[k] = e.target.value; detail(); } });
$('#hexpct').addEventListener('click', e => {
  const b = e.target.closest('button[data-p]'); if (!b) return;
  hexPct = +b.dataset.p / 100; $('#hexpct').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); run();
});
document.addEventListener('input', e => {
  if (e.target.id !== 'hop') return;
  const v = e.target.value; $('#hopv').textContent = v; try { localStorage.setItem('tf-hop', v); } catch (x) { /* ignore */ }
  if (heat) heat.material.opacity = v / 100;
});
$('#lite').onchange = e => { lite = e.target.checked; try { localStorage.setItem('tf-lite', lite ? '1' : '0'); } catch (x) { /* ignore */ } fit(); if (lite) globe.controls().autoRotate = false; run(); paintHeat(); };
document.addEventListener('visibilitychange', () => document.hidden ? globe.pauseAnimation() : globe.resumeAnimation());
{ const ctl = globe.controls(); let rt = 0;           // render at lower resolution while dragging, restore when idle
  ctl.addEventListener('start', () => { clearTimeout(rt); globe.renderer().setPixelRatio(lite ? .6 : .85); });
  ctl.addEventListener('end', () => { updateNames(); clearTimeout(rt); rt = setTimeout(() => { fit(); paintOutlines(); }, 400); });
  ctl.addEventListener('change', () => { if (tx.view === 'globe' && !tx.busy) updateHere(); });
  document.addEventListener('click', e => { const h = e.target.closest('#here'); if (h && +h.dataset.i >= 0) pick(+h.dataset.i); }); }
new ResizeObserver(() => { document.documentElement.style.setProperty('--sbw', ($('#controls').hidden ? 0 : $('#controls').getBoundingClientRect().right) + 'px'); updateNames(); }).observe($('#controls'));

/* ---------- Globe <-> About: about.html is fetched once, cached and kept in the page; only the two nav buttons trigger the move ---------- */
const tx = { view: 'globe', busy: false, pov: null, rot: false, keep: null };
const AB = $('#about-view'), NAV = document.querySelectorAll('.nav a[data-view]'), LEFT = () => [$('#controls'), $('#timeline')], RIGHT = () => [$('#hotspot-legend')];
async function preloadAbout() {
  let html = '';
  try {
    const c = await caches.open('teraflare-pages'), hit = await c.match('about.html');
    const fresh = fetch('about.html', { cache: 'no-cache' }).then(r => { if (!r.ok) return ''; c.put('about.html', r.clone()); return r.text(); }).catch(() => '');
    html = hit ? await hit.text() : await fresh;                    // cached copy is instant; the network copy refreshes it for next time
  } catch (e) { try { html = await (await fetch('about.html')).text(); } catch (x) { /* about stays a normal link */ } }
  const main = new DOMParser().parseFromString(html, 'text/html').querySelector('main.page');
  if (main) { AB.replaceChildren(document.importNode(main, true)); AB.dataset.ready = '1'; }
}
const aboutReady = preloadAbout();
const EASE = 'cubic-bezier(.65,0,.35,1)';                // ease in and out; these moves always play, also in low-end mode and with reduced motion
async function slideOut(el, cls, ms) {
  if (!el || el.hidden) return;
  const a = el.animate({ translate: ['0 0', cls === 'away-l' ? '-100vw 0' : '100vw 0'], opacity: [1, 0] }, { duration: ms, easing: EASE, fill: 'forwards' });
  await a.finished.catch(() => {}); el.classList.add(cls); a.cancel();
}
async function slideIn(el, cls, ms) {
  if (!el) return; el.classList.remove(cls);
  if (el.hidden) return;
  await el.animate({ translate: [cls === 'away-l' ? '-100vw 0' : '100vw 0', '0 0'], opacity: [0, 1] }, { duration: ms, easing: EASE }).finished.catch(() => {});
}
/* About: the globe turns slowly left to right behind the page; the selected country is un-highlighted meanwhile and comes back (with the camera) on return */
const SPIN = 4;                                          // degrees per second
let spinOn = false, spinRaf = 0;
function startSpin() {
  if (spinOn) return; spinOn = true; let last = 0, v = 0;
  const step = n => {
    if (!spinOn) return;
    const dt = last ? Math.min(.05, (n - last) / 1000) : 0; last = n; v = Math.min(1, v + dt / 1.4);
    const p = globe.pointOfView(), e = v * v * (3 - 2 * v);
    globe.pointOfView({ lat: p.lat, lng: p.lng - SPIN * e * dt, altitude: p.altitude }, 0);   // centre moves west, so the surface moves left to right
    spinRaf = requestAnimationFrame(step);
  };
  spinRaf = requestAnimationFrame(step);
}
function stopSpin() { spinOn = false; cancelAnimationFrame(spinRaf); }
const flyEase = (t, ms) => new Promise(res => {          // slow ease-in-out camera move, shortest way round the planet
  const p0 = globe.pointOfView(), dl = (((t.lng - p0.lng + 540) % 360) + 360) % 360 - 180, dla = t.lat - p0.lat, da = t.altitude - p0.altitude, t0 = performance.now();
  const st = n => { const p = Math.min(1, (n - t0) / ms), e = p < .5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2; globe.pointOfView({ lat: p0.lat + dla * e, lng: p0.lng + dl * e, altitude: p0.altitude + da * e }, 0); p < 1 ? requestAnimationFrame(st) : res(); };
  requestAnimationFrame(st);
});
function suspendSel() {                                  // globe back to its default look while About is open
  tx.keep = { sel, loc, area }; if (area) { areaHidden = true; globe.pathsData([]); }
  if (sel < 0) return;
  sel = -1; loc = null; globe.ringsData([]); fadeTo(0); draw();
}
function restoreSel() {
  const k = tx.keep; tx.keep = null; if (!k) return;
  if (k.area) { areaHidden = false; globe.pathsData(k.area.paths); }
  if (k.sel < 0) return;
  sel = k.sel; loc = k.loc; globe.ringsData(loc ? [loc] : []); fadeTo(1); draw();
}
async function showAbout() {                             // sidebar + play bar go left, legend goes right, About rises from the bottom
  tx.busy = true; document.body.classList.add('tx', 'in-about');
  const ctl = globe.controls(); tx.rot = ctl.autoRotate; tx.pov = globe.pointOfView(); if (cam) { cam.stop(); cam = null; }
  ctl.autoRotate = false; startSpin();
  globe.renderer().setPixelRatio(lite ? .6 : .85);       // lighter frames while things move
  await Promise.all([...LEFT().map(el => slideOut(el, 'away-l', 560)), ...RIGHT().map(el => slideOut(el, 'away-r', 560))]);
  suspendSel();
  ctl.enabled = false; $('#globe').style.pointerEvents = 'none';
  AB.classList.add('on'); AB.scrollTop = 0; AB.removeAttribute('aria-hidden');
  await AB.animate({ translate: ['0 100%', '0 0'], opacity: [0, 1] }, { duration: 850, easing: EASE }).finished.catch(() => {});
  fit(); tx.view = 'about'; tx.busy = false; document.body.classList.remove('tx');
}
async function showGlobe() {                             // the same steps backwards; the camera returns to the selected country, or to where it was before About
  tx.busy = true; document.body.classList.add('tx');
  const ctl = globe.controls(); globe.renderer().setPixelRatio(lite ? .6 : .85);
  const a = AB.animate({ translate: ['0 0', '0 100%'], opacity: [1, 0] }, { duration: 700, easing: EASE, fill: 'forwards' });
  await a.finished.catch(() => {}); AB.classList.remove('on'); a.cancel();
  AB.setAttribute('aria-hidden', 'true'); document.body.classList.remove('in-about');
  stopSpin();
  const k = tx.keep, tgt = k && k.sel >= 0 ? { lat: countries[k.sel].lat, lng: countries[k.sel].lng, altitude: 1.8 } : tx.pov;
  restoreSel();
  await Promise.all([flyEase(tgt, 1400), ...RIGHT().map(el => slideIn(el, 'away-r', 600)), ...LEFT().map(el => slideIn(el, 'away-l', 640))]);
  ctl.enabled = true; $('#globe').style.pointerEvents = ''; ctl.autoRotateSpeed = .4; ctl.autoRotate = tx.rot; fit();
  tx.view = 'globe'; tx.busy = false; document.body.classList.remove('tx'); updateNames(); updateHere(true);
}
async function go(view) {
  if (tx.busy || tx.view === view) return;
  if (view === 'about' && !AB.dataset.ready) { await preloadAbout(); if (!AB.dataset.ready) return; }
  NAV.forEach(a => a.classList.toggle('active', a.dataset.view === view));
  return view === 'about' ? showAbout() : showGlobe();
}
document.querySelector('.nav').addEventListener('click', e => {
  const a = e.target.closest('a[data-view]'); if (!a) return;
  e.preventDefault(); go(a.dataset.view);
});
await initEarth();
boot();