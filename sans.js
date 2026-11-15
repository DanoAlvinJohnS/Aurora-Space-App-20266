/* Easter eggs: a character drifts across the screen now and then. Which one depends on the theme:
     Classic   -> a little spaceship        (drawn right here as an inline SVG)
     Mario     -> Mario riding a rocket zooms across the screen  (needs assets/mario.png)
     Undertale -> Sans tumbles through space (assets/sans.png)
   - flies by itself every 30-60 seconds
   - type "ship", "mario" or "sans" anywhere to summon the current one
   - click it for a line of dialogue
   (This file is still called sans.js so the pages and the build script keep working.) */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* ---------- the spaceship (original art, faces right) ---------- */
  const SHIP = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
    '<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#b9c8f5"/></linearGradient>' +
    '<linearGradient id="f" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#ffd77a"/><stop offset=".5" stop-color="#ff7648"/><stop offset="1" stop-color="#ff7648" stop-opacity="0"/></linearGradient></defs>' +
    '<polygon fill="url(#f)" points="38,40 4,50 38,60"><animate attributeName="points" dur="0.18s" repeatCount="indefinite" values="38,40 4,50 38,60;38,41 16,50 38,59;38,40 2,50 38,60"/></polygon>' +
    '<g fill="#4a7ff8" stroke="#1e3266" stroke-width="2" stroke-linejoin="round">' +
    '<polygon points="66,38 108,6 128,6 112,38"/><polygon points="66,62 108,94 128,94 112,62"/><polygon points="48,38 42,22 62,22 72,38"/></g>' +
    '<path d="M40 42 L62 35 L150 33 Q188 39 196 50 Q188 61 150 67 L62 65 L40 58 Z" fill="url(#b)" stroke="#1e3266" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M66 47 H168 V53 H66 Z" fill="#ff7648"/>' +
    '<ellipse cx="142" cy="46" rx="17" ry="8" fill="#7fd0ff" stroke="#1e3266" stroke-width="2"/><ellipse cx="137" cy="43" rx="7" ry="2.5" fill="#fff" opacity=".7"/>' +
    '<rect x="34" y="40" width="10" height="20" rx="2" fill="#1e3266"/></svg>');

  /* ---------- who appears with which theme ---------- */
  const THEME_CHAR = { classic: 'ship', mario: 'mario', undertale: 'sans' };
  const CHARS = {
    ship:  { src: SHIP, w: 130, cls: 'egg-ship', move: 'cruise', lines: ['Beep boop. Fire detected.', 'Orbiting at 400 km.', 'All systems nominal.', 'Houston, we have a heat map.', 'Scanning for hotspots...', 'Warp drive offline. Vibes online.'] },
    mario: { src: 'assets/mario.png', w: 120, cls: 'egg-mario', move: 'fly', faces: 'right',   // faces: which way the artwork points ('left' or 'right')
              lines: ["Let's-a go!", 'Wahoo!', 'Mamma mia, so much fire!', 'Here we go!', 'Hold on tight!'] },
    sans:  { src: 'assets/sans.png', w: 80, cls: 'egg-sans', move: 'tumble', star: true, lines: ['heh.', "it's a beautiful day outside.", 'you should be burning up right now.', 'geeettttt dunked on!', 'nice globe you got there.', 'i got a fire hot take: this is fine.'] }
  };
  const current = () => { const k = THEME_CHAR[document.documentElement.dataset.theme] || 'ship'; return Object.assign({ key: k }, CHARS[k]); };

  let flying = false;
  const warned = {};

  const css = document.createElement('style');
  css.textContent = `
  .egg{position:fixed;top:0;left:0;z-index:2;height:auto;pointer-events:auto;cursor:pointer;will-change:transform;user-select:none;-webkit-user-drag:none}
  .egg-ship{filter:drop-shadow(0 0 12px rgba(74,127,248,.7))}
  .egg-mario{image-rendering:pixelated;filter:drop-shadow(0 4px 0 rgba(0,0,0,.3))}   /* pixelated = crisp pixel art; delete that part if your picture is smooth artwork */
  .egg-sans{image-rendering:pixelated;filter:drop-shadow(0 0 10px rgba(74,127,248,.85)) drop-shadow(0 0 22px rgba(255,118,72,.45))}
  .egg-say{position:fixed;z-index:6;max-width:210px;padding:8px 12px;border-radius:10px;background:#fff;color:#000;
    font:600 13px/1.3 var(--sf);pointer-events:none;box-shadow:0 4px 20px rgba(0,0,0,.35)}
  .egg-say::after{content:"";position:absolute;bottom:-7px;left:18px;border:7px solid transparent;border-top-color:#fff;border-bottom:0}`;
  document.head.appendChild(css);

  function say(img, ch) {
    const r = img.getBoundingClientRect(), b = document.createElement('div');
    b.className = 'egg-say'; b.textContent = (ch.star ? '* ' : '') + ch.lines[Math.floor(Math.random() * ch.lines.length)];
    document.body.appendChild(b);
    b.style.left = Math.max(8, Math.min(innerWidth - 220, r.left)) + 'px';
    b.style.top = Math.max(8, r.top - b.offsetHeight - 14) + 'px';
    setTimeout(() => b.remove(), 2200);
  }

  /* keyframes for each kind of movement; h = sprite height in px */
  function motion(ch, h) {
    const W = innerWidth, H = innerHeight, w = ch.w, ltr = Math.random() < .5, dir = ltr ? 1 : -1, flip = dir * (ch.faces === 'left' ? -1 : 1);
    const x0 = ltr ? -w * 1.5 : W + w * 1.5, x1 = ltr ? W + w * 1.5 : -w * 1.5, dx = x1 - x0;
    const kf = (p, y, rot) => ({ transform: `translate(${x0 + dx * p}px,${y}px) rotate(${rot}deg) scaleX(${flip})` });
    const out = [];
    if (ch.move === 'fly') {                                  // a fast, almost level dash with a slight wobble
      const y = H * (.15 + Math.random() * .45);
      for (let i = 0; i <= 40; i++) { const p = i / 40; out.push(kf(p, y + Math.sin(p * Math.PI * 4) * 8, 0)); }
      return { frames: out, ms: Math.max(4500, Math.min(7500, (W + 3 * w) / .4)) };
    }
    const y0 = H * (.12 + Math.random() * .6), y1 = H * (.12 + Math.random() * .6);
    if (ch.move === 'cruise') {                               // steady flight with a gentle bob, nose follows the path
      for (let i = 0; i <= 24; i++) {
        const p = i / 24, y = y0 + (y1 - y0) * p + Math.sin(p * Math.PI * 2) * 18;
        const dy = (y1 - y0) + Math.cos(p * Math.PI * 2) * 18 * Math.PI * 2;
        out.push(kf(p, y, dir * Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI));
      }
      return { frames: out, ms: 7000 + Math.random() * 3000 };
    }
    const spin = dir * (18 + Math.random() * 25);            // tumble
    [[0, -spin], [.25, spin * .3], [.5, -spin * .3], [.75, spin * .3], [1, spin]].forEach(([p, rot]) =>
      out.push(kf(p, y0 + (y1 - y0) * p + Math.sin(p * Math.PI * 3) * 22, rot)));
    return { frames: out, ms: 9000 + Math.random() * 4000 };
  }

  function fly() {
    if (flying || document.hidden) return;
    const ch = current();
    flying = true;
    const img = new Image();
    img.className = 'egg ' + ch.cls; img.alt = ''; img.draggable = false; img.style.width = ch.w + 'px';
    img.onerror = () => {
      flying = false;
      if (!warned[ch.key]) { warned[ch.key] = 1; console.warn('Easter egg: could not load ' + ch.src + ' (add the image to the assets folder).'); }
    };
    img.onload = () => {
      document.body.appendChild(img);
      const m = motion(ch, ch.w * img.naturalHeight / img.naturalWidth);
      const anim = img.animate(m.frames, { duration: m.ms, easing: 'linear' });
      img.addEventListener('click', () => say(img, ch));
      anim.onfinish = () => { img.remove(); flying = false; };
    };
    img.src = ch.src;
  }

  const schedule = () => setTimeout(() => { fly(); schedule(); }, 30000 + Math.random() * 30000);
  setTimeout(() => { fly(); schedule(); }, 8000);             // first appearance shortly after load

  let typed = '';
  addEventListener('keydown', e => {
    if (/input|select|textarea/i.test((e.target.tagName || ''))) return;
    typed = (typed + e.key.toLowerCase()).slice(-5);
    if (/(sans|ship|mario)$/.test(typed)) { typed = ''; fly(); }
  });
})();
