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

let ref = 1, timer = null, raf = 0, sel = -1;
let light = 'live', mat = null, T = null, sun = { lat: 0, lng: 0 };

/* ---------- globe: one merged mesh for all columns, country polygons on top ---------- */
const globe = Globe()($('#globe'))
  .backgroundImageUrl(CDN + 'night-sky.png')
  .showAtmosphere(true).atmosphereAltitude(0.2).atmosphereColor(ATMO.live)
  .pointLat('lat').pointLng('lng').pointAltitude('alt').pointColor('col').pointRadius('r')
  .pointResolution(4).pointsMerge(true)
  .polygonAltitude(0.004).polygonSideColor(() => 'rgba(0,0,0,0)').polygonsTransitionDuration(0)
  .onPolygonClick(p => p && pick(p.__i));

globe.controls().autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
globe.controls().autoRotateSpeed = 0.4;
const fit = () => { globe.renderer().setPixelRatio(Math.min(devicePixelRatio || 1, 2)); globe.width(innerWidth).height(innerHeight); };
addEventListener('resize', fit); fit();

function level(w) { return Math.min(1, Math.log(1 + w) / Math.log(1 + ref)); }
function color(w) {
  const x = level(w) * (STOPS.length - 1), i = Math.min(Math.floor(x), STOPS.length - 2), f = x - i;
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
  const f = (v, a, b) => `${Math.abs(v).toFixed(0)}°${v >= 0 ? a : b}`;
  $('#clock').textContent = `${now.toISOString().slice(11, 16)} UTC · sun is overhead near ${f(sun.lat, 'N', 'S')}, ${f(sun.lng, 'E', 'W')}`;
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
    paint(); globe.polygonsData(gj.features);
  } catch (e) {
    console.warn(e);
    $('#lmsg').innerHTML = 'Prepared data not found. Put your FIRMS CSVs in <b>/dataset</b>, run <code>python3 preprocess.py</code> once, then serve this folder (for example <code>python3 -m http.server</code>) and reload.';
    $('.progress').hidden = true; return;
  }
  const yr = $('#year'); yr.min = M.years[0]; yr.max = M.years[1]; yr.value = M.years[1];
  $('#meta').textContent = `${M.rows.toLocaleString()} detections, ${cached ? 'loaded from cache' : 'downloaded'} in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  $('#loading').hidden = true;
  ['#status', '#controls', '#timeline'].forEach(s => $(s).hidden = false);
  detail(); draw();
}

/* ---------- aggregation: one pass over the summary, memoised per setting ---------- */
const gmap = res => GM[res] || (GM[res] = (() => {
  const W = M.nx / res, a = new Uint32Array(NC);
  for (let c = 0; c < NC; c++) { const iy = (c / M.nx) | 0, ix = c - iy * M.nx; a[c] = ((iy / res) | 0) * W + ((ix / res) | 0); }
  return a;
})());

function agg() {
  const res = +$('#res').value, end = +$('#year').value - M.y0, cum = $('#cum').checked, mc = +$('#conf').value;
  const s0 = $('#modis').checked, s1 = $('#viirs').checked, k = [res, end, +cum, mc, +s0, +s1].join();
  let r = memo.get(k); if (r) return r;
  const map = gmap(res), W = M.nx / res, grid = new Float32Array(W * (M.ny / res)), cs = new Float64Array(countries.length);
  let total = 0;
  for (let i = 0; i < N; i++) {
    const y = YR[i]; if (y > end || (!cum && y !== end) || CB[i] < mc || !(SN[i] ? s1 : s0)) continue;
    const c = CNT[i], cell = CELL[i], o = CC[cell];
    grid[map[cell]] += c; total += c; if (o !== 255) cs[o] += c;
  }
  let mx = 1; for (let g = 0; g < grid.length; g++) if (grid[g] > mx) mx = grid[g];
  ref = mx; const pts = [];
  for (let g = 0; g < grid.length; g++) {
    const v = grid[g]; if (!v) continue;
    const gy = (g / W) | 0, gx = g - gy * W;
    pts.push({ lat: 90 - (gy + .5) * res / 2, lng: -180 + (gx + .5) * res / 2, alt: 0.005 + 0.14 * level(v), col: color(v), r: res * 0.22 });
  }
  r = { pts, total, cs }; memo.set(k, r); if (memo.size > 40) memo.delete(memo.keys().next().value);
  return r;
}

function draw() {
  const r = agg(), y = $('#year').value, y0 = M.years[0];
  globe.pointsData(r.pts);
  $('#count').textContent = r.total.toLocaleString();
  $('#yl').textContent = $('#cum').checked && +y > y0 ? `${y0}–${y}` : y;
  list(); if (sel >= 0) $('#now').textContent = r.cs[sel].toLocaleString();
}
const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };

/* ---------- countries ---------- */
function paint() {
  globe.polygonCapColor(p => p.__i === sel ? 'rgba(255,138,26,.4)' : 'rgba(0,0,0,0)')
    .polygonStrokeColor(p => p.__i === sel ? '#ffb366' : 'rgba(255,255,255,.18)');
}
function pick(i) {
  sel = i; globe.controls().autoRotate = false; paint();
  globe.pointOfView({ lat: countries[i].lat, lng: countries[i].lng, altitude: 1.8 }, 1000);
  detail(); draw();
}
function clear() { sel = -1; paint(); detail(); draw(); }

function list() {
  const q = $('#csearch').value.trim().toLowerCase(), cs = agg().cs;
  const rows = countries.map((c, i) => [i, cs[i]]).filter(([i, n]) => n > 0 && countries[i].name.toLowerCase().includes(q)).sort((a, b) => b[1] - a[1]);
  $('#clist').innerHTML = rows.map(([i, n]) => `<button class="ci${i === sel ? ' sel' : ''}" data-i="${i}"><span>${countries[i].name}</span><span class="hint">${n.toLocaleString()}</span></button>`).join('') || '<p class="hint">No countries with detections.</p>';
}

function detail() {
  const box = $('#detail');
  if (sel < 0) { box.innerHTML = '<h3>Country</h3><p class="hint">Click a country on the globe or in the list to highlight it and see its fire history here.</p>'; return; }
  const c = countries[sel], y0 = M.years[0], tot = c.y.reduce((a, b) => a + b, 0);
  if (!tot) { box.innerHTML = `<p class="name">${c.name}</p><p class="hint">No detections in this dataset.</p><button id="clr" class="btn ghost small inline">Clear</button>`; $('#clr').onclick = clear; return; }
  const top = Math.max(...c.y), mt = Math.max(...c.m), dn = c.dn[0] + c.dn[1], vi = c.s[1] / tot;
  const row = (a, b) => `<div class="evt"><span>${a}</span><span>${b}</span></div>`;
  box.innerHTML = `
    <p class="name">${c.name}</p>
    <div class="stats"><div><b>${tot.toLocaleString()}</b>detections</div><div><b>${y0 + c.y.indexOf(top)}</b>peak year</div><div><b>${MON[c.m.indexOf(mt)]}</b>busiest month</div></div>
    <h3>Per year</h3>
    <div class="bars">${c.y.map((n, i) => `<i class="${n === top ? 'peak' : ''}" style="height:${Math.max(3, n / top * 100)}%" title="${y0 + i}: ${n.toLocaleString()}"></i>`).join('')}</div>
    <div class="axis"><span>${y0}</span><span>${M.years[1]}</span></div>
    <h3>Seasonality</h3>
    <div class="bars m">${c.m.map((n, i) => `<i style="height:${Math.max(3, n / mt * 100)}%" title="${MON[i]}: ${n.toLocaleString()}"></i>`).join('')}</div>
    <div class="axis months">${MON.map(m => `<span>${m[0]}</span>`).join('')}</div>
    <h3>Details</h3>
    ${row('Shown with current filters', '<b id="now">…</b>')}
    ${row('MODIS / VIIRS', `${c.s[0].toLocaleString()} / ${c.s[1].toLocaleString()}`)}
    ${row('Seen by day / night', dn ? `${Math.round(c.dn[0] / dn * 100)}% / ${Math.round(c.dn[1] / dn * 100)}%` : '–')}
    <p class="hint">Charts and details cover all sensors and confidence levels.</p>
    <button id="clr" class="btn ghost small inline">Clear selection</button>`;
  $('#clr').onclick = clear; $('#now').textContent = agg().cs[sel].toLocaleString();
}

/* ---------- wiring ---------- */
$('#clist').onclick = e => { const b = e.target.closest('.ci'); if (b) pick(+b.dataset.i); };
$('#csearch').addEventListener('input', list);
addEventListener('keydown', e => { if (e.key === 'Escape' && sel >= 0) clear(); });
['#modis', '#viirs', '#conf', '#cum', '#year', '#res'].forEach(s => $(s).addEventListener('input', redraw));
$('#play').onclick = () => {
  if (timer) { clearInterval(timer); timer = null; $('#play').textContent = 'Play'; return; }
  $('#play').textContent = 'Pause';
  timer = setInterval(() => { const y = $('#year'); y.value = +y.value >= +y.max ? y.min : +y.value + 1; redraw(); }, 900);
};

await initEarth();
boot();
    