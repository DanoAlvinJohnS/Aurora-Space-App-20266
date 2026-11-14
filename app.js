const $ = s => document.querySelector(s);

/* ---------- settings ---------- */
const MAX = 250000;                                   // points kept in memory (thinned evenly beyond this)
const CONF = { l: 15, n: 55, h: 90 };
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CDN = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/';
// Put your own higher-resolution maps in /assets (earth-day.jpg, earth-night.jpg, earth-topology.png)
// and they are used first. Otherwise the CDN versions are used.
const TEX = {
  day:   ['assets/earth-day.jpg', CDN + 'earth-day.jpg', CDN + 'earth-blue-marble.jpg'],
  night: ['assets/earth-night.jpg', CDN + 'earth-night.jpg'],
  topo:  ['assets/earth-topology.png', CDN + 'earth-topology.png'],
};
const STOPS = [[255,224,138],[255,138,26],[214,18,40],[122,0,25]];
const RADIUS_KM = { 3: 63, 4: 24 };                   // approx radius of one column's area per hex resolution
const SAT = { T: 'Terra', A: 'Aqua', N: 'Suomi NPP', '1': 'NOAA-20', '2': 'NOAA-21' };
const ATMO = { day: '#7db4ff', night: '#4d5f9a', live: '#6c9cf5' };

let all = [], step = 1, seen = 0, ref = 1, minY = 2000, maxY = 2025, timer = null;
let light = 'live', mat = null, T = null, sun = { lat: 0, lng: 0 };

/* ---------- globe ---------- */
const globe = Globe()($('#globe'))
  .backgroundImageUrl(CDN + 'night-sky.png')
  .showAtmosphere(true).atmosphereAltitude(0.2).atmosphereColor(ATMO.live)
  .hexBinPointLat(d => d.lat).hexBinPointLng(d => d.lng)
  .hexBinResolution(3).hexMargin(0.2)
  .hexTopColor(h => color(h.sumWeight)).hexSideColor(h => color(h.sumWeight))
  .hexAltitude(h => 0.005 + 0.14 * level(h.sumWeight))
  .hexLabel(h => `<b>${h.sumWeight.toLocaleString()}</b> detections · click for history`)
  .onHexClick(showInfo)
  .ringColor(() => t => `rgba(255,214,150,${1 - t})`)
  .ringMaxRadius(3.5).ringPropagationSpeed(1.6).ringRepeatPeriod(1400);

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

/* ---------- CSV reading (streamed, so very large files are fine) ---------- */
function makeReader(name) {
  const guess = /viirs/i.test(name) ? 'VIIRS' : /modis/i.test(name) ? 'MODIS' : null;
  let ix = {}, viirsCols = false;
  return {
    header(line) {
      const h = line.replace(/^\uFEFF/, '').split(',').map(s => s.trim().toLowerCase()), f = n => h.indexOf(n);
      viirsCols = h.includes('bright_ti4');
      ix = { la: f('latitude'), lo: f('longitude'), dt: f('acq_date'), tm: f('acq_time'), fr: f('frp'), ins: f('instrument'),
        cf: f('confidence'), br: f('brightness') >= 0 ? f('brightness') : f('bright_ti4'), dn: f('daynight'), sat: f('satellite') };
      if (ix.la < 0 || ix.lo < 0 || ix.dt < 0) throw new Error(`${name}: missing latitude, longitude or acq_date columns.`);
    },
    row(line) {
      const r = line.split(','), lat = +r[ix.la], lng = +r[ix.lo], ds = (r[ix.dt] || '').trim();
      const y = +ds.slice(0, 4), m = +ds.slice(5, 7), d = +ds.slice(8, 10);
      if (isNaN(lat) || isNaN(lng) || isNaN(y) || isNaN(m)) return null;
      const insRaw = (r[ix.ins] || '').trim().toUpperCase();
      const ins = insRaw ? (insRaw === 'VIIRS' ? 'VIIRS' : 'MODIS') : (guess || (viirsCols ? 'VIIRS' : 'MODIS'));
      const raw = (r[ix.cf] || '').trim().toLowerCase();
      const c = raw === '' ? 100 : (isNaN(+raw) ? (CONF[raw[0]] ?? 100) : +raw);
      const s = (r[ix.sat] || '').trim();
      return { lat, lng, y, m, dt: y * 10000 + m * 100 + (d || 0), tm: +r[ix.tm] || 0, frp: +r[ix.fr] || 0,
        br: +r[ix.br] || 0, ins, conf: c, dn: (r[ix.dn] || '').trim(), sat: SAT[s] || s };
    },
  };
}

async function streamFile(url, name, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const rd = makeReader(name), dec = new TextDecoder();
  let buf = '', first = true;
  const handle = line => {
    if (!line) return;
    if (first) { rd.header(line); first = false; return; }
    if (++seen % step) return;                           // evenly thin once the dataset is huge
    const p = rd.row(line); if (!p) return;
    all.push(p);
    if (all.length > MAX) { all = all.filter((_, i) => !(i & 1)); step *= 2; }
  };
  const reader = res.body.getReader(); let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.length; onBytes(bytes);
    buf += dec.decode(value, { stream: true });
    let a = 0, b;
    while ((b = buf.indexOf('\n', a)) >= 0) { handle(buf.slice(a, b).replace(/\r$/, '')); a = b + 1; }
    buf = buf.slice(a);
  }
  buf += dec.decode(); if (buf.trim()) handle(buf.replace(/\r$/, ''));
}

async function discover() {
  try {                                                  // 1) optional dataset/manifest.json
    const r = await fetch('dataset/manifest.json', { cache: 'no-store' });
    if (r.ok && !/html/.test(r.headers.get('content-type') || '')) {
      const j = await r.json(), list = Array.isArray(j) ? j : (j.files || []);
      return list.map(f => new URL(encodeURI('dataset/' + String(f).replace(/^\/+/, '').replace(/^dataset\//, '')), location.href).href);
    }
  } catch (e) { /* no manifest */ }
  const out = [];                                        // 2) read the server's folder listing
  const walk = async (dirUrl, depth) => {
    let r; try { r = await fetch(dirUrl, { cache: 'no-store' }); } catch (e) { return; }
    if (!r.ok || !/html/.test(r.headers.get('content-type') || '')) return;
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html'), base = new URL(dirUrl, location.href);
    for (const a of doc.querySelectorAll('a[href]')) {
      let u; try { u = new URL(a.getAttribute('href'), base); } catch (e) { continue; }
      if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname) || u.pathname === base.pathname) continue;
      if (u.pathname.endsWith('/')) { if (depth < 2) await walk(u.href, depth + 1); }
      else if (/\.csv$/i.test(u.pathname)) out.push(u.href);
    }
  };
  await walk('dataset/', 0);
  return [...new Set(out)].sort();
}

/* ---------- app flow ---------- */
const niceName = u => decodeURIComponent(u.split('/').pop());

async function boot() {
  $('#loading').hidden = false;
  const files = await discover();
  if (!files.length) {
    $('#loading').hidden = true; $('#drop').hidden = false;
    $('#dropmsg').innerHTML = 'No CSV files were found in <b>/dataset</b>. Put your FIRMS files there and reload, or drop one here. (Open the site through a local server, for example <code>python3 -m http.server</code>, so the browser may read that folder.)';
    return;
  }
  const errs = [];
  for (let i = 0; i < files.length; i++) {
    const name = niceName(files[i]);
    $('#lmsg').textContent = `Reading file ${i + 1} of ${files.length}`;
    $('#ldetail').textContent = name;
    try {
      await streamFile(files[i], name, b => {
        $('#lbar').style.width = ((i + Math.min(0.99, b / 2e8)) / files.length * 100) + '%';
        $('#ldetail').textContent = `${name} · ${(b / 1e6).toFixed(0)} MB · ${all.length.toLocaleString()} points kept`;
      });
    } catch (e) { errs.push(e.message); console.warn(e); }
    $('#lbar').style.width = ((i + 1) / files.length * 100) + '%';
  }
  $('#loading').hidden = true;
  if (!all.length) {
    $('#drop').hidden = false; $('#err').textContent = errs[0] || 'No valid rows found in /dataset.'; return;
  }
  ready();
  if (errs.length) console.warn('Some files were skipped:', errs);
}

function ready() {
  minY = Infinity; maxY = -Infinity;
  for (const p of all) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const yr = $('#year'); yr.min = minY; yr.max = maxY; yr.value = maxY;
  $('#drop').hidden = true;
  ['#controls', '#timeline'].forEach(s => $(s).hidden = false);
  $('#sample').hidden = step === 1;
  $('#sample').textContent = `Large dataset: showing an even 1-in-${step} sample so the globe stays smooth.`;
  draw();
}

async function loadUploads(files) {
  $('#err').textContent = '';
  try {
    for (const f of files) {
      const rd = makeReader(f.name); let first = true;
      for (const line of (await f.text()).split(/\r?\n/)) {
        if (!line) continue;
        if (first) { rd.header(line); first = false; continue; }
        if (++seen % step) continue;
        const p = rd.row(line); if (!p) continue;
        all.push(p); if (all.length > MAX) { all = all.filter((_, i) => !(i & 1)); step *= 2; }
      }
    }
  } catch (e) { $('#drop').hidden = false; $('#err').textContent = e.message; return; }
  if (!all.length) { $('#drop').hidden = false; $('#err').textContent = 'No valid rows found in this file.'; return; }
  $('#info').hidden = true; ready();
}

function filtered() {
  const end = +$('#year').value, cum = $('#cum').checked, mc = +$('#conf').value;
  const on = { MODIS: $('#modis').checked, VIIRS: $('#viirs').checked };
  return all.filter(p => on[p.ins] && p.conf >= mc && p.y <= end && (cum || p.y === end));
}

function draw() {
  const d = filtered(), cells = new Map();
  d.forEach(p => { const k = Math.floor(p.lat) + ',' + Math.floor(p.lng); cells.set(k, (cells.get(k) || 0) + 1); });
  ref = Math.max(1, ...cells.values());
  globe.hexBinResolution(+$('#res').value).hexBinPointsData(d);
  $('#count').textContent = d.length.toLocaleString();
  const y = $('#year').value;
  $('#yl').textContent = $('#cum').checked && +y > minY ? `${minY}–${y}` : y;
}

/* ---------- wildfire history for a clicked area ---------- */
const pad = n => String(n).padStart(2, '0');
const fmtDate = dt => `${dt % 100} ${MON[Math.floor(dt / 100) % 100 - 1]} ${Math.floor(dt / 10000)}`;
const fmtTime = tm => `${pad(Math.floor(tm / 100))}:${pad(tm % 100)} UTC`;
const fmtCoord = (v, a, b) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? a : b}`;

function showInfo(h) {
  globe.controls().autoRotate = false;
  const c = h.center || { lat: h.points[0].lat, lng: h.points[0].lng };
  const mc = +$('#conf').value, on = { MODIS: $('#modis').checked, VIIRS: $('#viirs').checked };
  const r = RADIUS_KM[$('#res').value] / 111.32, cosL = Math.cos(c.lat * Math.PI / 180);
  const pts = [];
  for (const p of all) {                                 // whole history, regardless of the year slider
    if (!on[p.ins] || p.conf < mc) continue;
    const dy = p.lat - c.lat; if (Math.abs(dy) > r) continue;
    const dx = (((p.lng - c.lng + 540) % 360) - 180) * cosL;
    if (dx * dx + dy * dy <= r * r) pts.push(p);
  }
  globe.ringsData([{ lat: c.lat, lng: c.lng }]);
  globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: 1.3 }, 1100);
  if (!pts.length) { $('#infobody').innerHTML = '<h2>No detections</h2>'; $('#info').hidden = false; return; }

  const byY = {}, byM = Array(12).fill(0), byD = new Map(), ins = { MODIS: 0, VIIRS: 0 }, dn = { D: 0, N: 0 };
  let frpSum = 0, frpMax = -1, frpAt = null, brSum = 0, brN = 0, hi = 0, first = Infinity, last = 0;
  for (const p of pts) {
    byY[p.y] = (byY[p.y] || 0) + 1; byM[p.m - 1]++; ins[p.ins]++;
    if (p.dn === 'D' || p.dn === 'N') dn[p.dn]++;
    const e = byD.get(p.dt) || [0, 0]; e[0]++; if (p.frp > e[1]) e[1] = p.frp; byD.set(p.dt, e);
    frpSum += p.frp; if (p.frp > frpMax) { frpMax = p.frp; frpAt = p; }
    if (p.br) { brSum += p.br; brN++; }
    if (p.conf >= 80) hi++;
    if (p.dt < first) first = p.dt; if (p.dt > last) last = p.dt;
  }
  const years = []; for (let y = minY; y <= maxY; y++) years.push(byY[y] || 0);
  const top = Math.max(...years, 1), peakY = minY + years.indexOf(top);
  const mTop = Math.max(...byM, 1), peakM = byM.indexOf(mTop);
  const season = byM.map((n, i) => [n, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).filter(x => x[0] > 0).map(x => MON[x[1]]).join(', ');
  const active = years.filter(n => n > 0).length;
  const days = [...byD].sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).slice(0, 5);
  const strong = [...pts].sort((a, b) => b.frp - a.frp).slice(0, 4);
  const recent = [...pts].sort((a, b) => b.dt - a.dt || b.tm - a.tm).slice(0, 6);
  let trend = '';
  if (maxY - minY >= 9) {
    const rec = years.slice(-5).reduce((s, n) => s + n, 0), bef = years.slice(-10, -5).reduce((s, n) => s + n, 0);
    if (bef > 0) { const pc = Math.round((rec - bef) / bef * 100); trend = `<p class="hint">Last 5 years: ${pc >= 0 ? '+' : ''}${pc}% detections compared with the 5 years before.</p>`; }
  }
  const dnTot = dn.D + dn.N, sampled = step > 1 ? `<p class="hint">Counts come from a 1-in-${step} sample of the dataset.</p>` : '';
  const evt = (a, b, c2) => `<div class="evt"><span>${a}</span><span>${b}</span><span class="hint">${c2}</span></div>`;

  $('#infobody').innerHTML = `
    <h2>Fire history</h2>
    <p class="hint">Area around ${fmtCoord(c.lat, 'N', 'S')}, ${fmtCoord(c.lng, 'E', 'W')} · all years, about ${RADIUS_KM[$('#res').value]} km radius</p>
    <div class="stats">
      <div><b>${pts.length.toLocaleString()}</b>detections</div>
      <div><b>${peakY}</b>peak year</div>
      <div><b>${MON[peakM]}</b>busiest month</div>
    </div>
    <p>First recorded ${fmtDate(first)}, latest ${fmtDate(last)}. Fire seen in <b>${active}</b> of ${years.length} years. Main fire season: <b>${season}</b>.</p>
    ${trend}
    <h3>Detections per year</h3>
    <div class="bars">${years.map((n, i) => `<i class="${minY + i === peakY ? 'peak' : ''}" style="height:${Math.max(3, n / top * 100)}%" title="${minY + i}: ${n.toLocaleString()}"></i>`).join('')}</div>
    <div class="axis"><span>${minY}</span><span>${maxY}</span></div>
    <h3>Seasonality</h3>
    <div class="bars m">${byM.map((n, i) => `<i style="height:${Math.max(3, n / mTop * 100)}%" title="${MON[i]}: ${n.toLocaleString()}"></i>`).join('')}</div>
    <div class="axis months">${MON.map(m => `<span>${m[0]}</span>`).join('')}</div>
    <h3>Biggest burning days</h3>
    ${days.map(([dt, [n, f]]) => evt(fmtDate(dt), `${n.toLocaleString()} hits`, f ? `up to ${f.toFixed(0)} MW` : '')).join('')}
    <h3>Most intense detections</h3>
    ${strong.map(p => evt(fmtDate(p.dt), `${p.frp.toFixed(0)} MW`, `${p.ins}${p.sat ? ' · ' + p.sat : ''}`)).join('')}
    <h3>Most recent detections</h3>
    ${recent.map(p => evt(fmtDate(p.dt), p.tm ? fmtTime(p.tm) : '', `${p.ins} · ${p.conf}% conf`)).join('')}
    <h3>Details</h3>
    <div class="evt"><span>Average power</span><span>${(frpSum / pts.length).toFixed(1)} MW</span></div>
    <div class="evt"><span>Strongest</span><span>${frpMax.toFixed(0)} MW</span><span class="hint">${fmtDate(frpAt.dt)}</span></div>
    ${brN ? `<div class="evt"><span>Average brightness</span><span>${(brSum / brN).toFixed(0)} K</span></div>` : ''}
    <div class="evt"><span>High confidence</span><span>${Math.round(hi / pts.length * 100)}%</span></div>
    <div class="evt"><span>MODIS / VIIRS</span><span>${ins.MODIS.toLocaleString()} / ${ins.VIIRS.toLocaleString()}</span></div>
    ${dnTot ? `<div class="evt"><span>Seen by day / night</span><span>${Math.round(dn.D / dnTot * 100)}% / ${Math.round(dn.N / dnTot * 100)}%</span></div>` : ''}
    ${sampled}`;
  $('#info').hidden = false; $('#info').scrollTop = 0;
}

/* ---------- wiring ---------- */
$('#pick').onclick = $('#again').onclick = () => $('#file').click();
$('#file').onchange = e => e.target.files.length && loadUploads([...e.target.files]);
addEventListener('dragover', e => { e.preventDefault(); $('#drop').classList.add('over'); });
addEventListener('dragleave', () => $('#drop').classList.remove('over'));
addEventListener('drop', e => { e.preventDefault(); $('#drop').classList.remove('over'); if (e.dataTransfer.files.length) loadUploads([...e.dataTransfer.files]); });
const closeInfo = () => { $('#info').hidden = true; globe.ringsData([]); };
$('#close').onclick = closeInfo;
addEventListener('keydown', e => { if (e.key === 'Escape') closeInfo(); });
['#modis', '#viirs', '#conf', '#cum', '#year', '#res'].forEach(s => $(s).addEventListener('input', () => { draw(); }));
$('#play').onclick = () => {
  if (timer) { clearInterval(timer); timer = null; $('#play').textContent = 'Play'; return; }
  $('#play').textContent = 'Pause';
  timer = setInterval(() => { const y = $('#year'); y.value = +y.value >= maxY ? minY : +y.value + 1; draw(); }, 900);
};

await initEarth();
boot();
