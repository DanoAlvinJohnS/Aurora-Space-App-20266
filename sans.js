/* Easter egg: Sans drifts across space now and then.
   - flies by himself every 30-60 seconds
   - type "sans" anywhere to summon him
   - click him for a line of dialogue                                           */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const SIZE = 80;                                   // sprite size in px
  const LINES = ['heh.', "it's a beautiful day outside.", 'you should be burning up right now.', 'geeettttt dunked on!', 'nice globe you got there.', 'i got a fire hot take: this is fine.'];
  let flying = false;

  const css = document.createElement('style');
  css.textContent = `
  .sans{position:fixed;top:0;left:0;z-index:2;width:${SIZE}px;height:auto;pointer-events:auto;cursor:pointer;
    image-rendering:pixelated;will-change:transform;filter:drop-shadow(0 0 10px rgba(168,85,247,.85)) drop-shadow(0 0 22px rgba(124,58,237,.5))}
  .sans-say{position:fixed;z-index:6;max-width:210px;padding:8px 12px;border-radius:10px;background:#fff;color:#000;
    font:600 13px/1.3 var(--sf);pointer-events:none;box-shadow:0 0 18px rgba(168,85,247,.6)}
  .sans-say::after{content:"";position:absolute;bottom:-7px;left:18px;border:7px solid transparent;border-top-color:#fff;border-bottom:0}`;
  document.head.appendChild(css);/* Easter egg: Sans drifts across space now and then.
   - flies by himself every 30-60 seconds
   - type "sans" anywhere to summon him
   - click him for a line of dialogue                                           */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const SIZE = 80;                                   // sprite size in px
  const LINES = ['heh.', "it's a beautiful day outside.", 'you should be burning up right now.', 'geeettttt dunked on!', 'nice globe you got there.', 'i got a fire hot take: this is fine.'];
  let flying = false;

  const css = document.createElement('style');
  css.textContent = `
  .sans{position:fixed;top:0;left:0;z-index:2;width:${SIZE}px;height:auto;pointer-events:auto;cursor:pointer;
    image-rendering:pixelated;will-change:transform;filter:drop-shadow(0 0 10px rgba(74,127,248,.85)) drop-shadow(0 0 22px rgba(255,118,72,.45))}
  .sans-say{position:fixed;z-index:6;max-width:210px;padding:8px 12px;border-radius:10px;background:#fff;color:#000;
    font:600 13px/1.3 var(--sf);pointer-events:none;box-shadow:0 4px 20px rgba(0,0,0,.35)}
  .sans-say::after{content:"";position:absolute;bottom:-7px;left:18px;border:7px solid transparent;border-top-color:#fff;border-bottom:0}`;
  document.head.appendChild(css);

  function say(sans) {
    const r = sans.getBoundingClientRect(), b = document.createElement('div');
    b.className = 'sans-say'; b.textContent = LINES[Math.floor(Math.random() * LINES.length)];
    document.body.appendChild(b);
    b.style.left = Math.max(8, Math.min(innerWidth - 220, r.left)) + 'px';
    b.style.top = Math.max(8, r.top - b.offsetHeight - 14) + 'px';
    setTimeout(() => b.remove(), 2200);
  }

  function fly() {
    if (flying || document.hidden) return;
    flying = true;
    const img = document.createElement('img');
    img.src = 'assets/sans.png'; img.alt = ''; img.className = 'sans'; img.draggable = false;
    document.body.appendChild(img);

    const ltr = Math.random() < .5, W = innerWidth, H = innerHeight;
    const x0 = ltr ? -SIZE * 1.5 : W + SIZE * 1.5, x1 = ltr ? W + SIZE * 1.5 : -SIZE * 1.5;
    const y0 = H * (.12 + Math.random() * .6), y1 = H * (.12 + Math.random() * .6);
    const flip = ltr ? 1 : -1, spin = (ltr ? 1 : -1) * (18 + Math.random() * 25);
    const frame = (p, rot) => {
      const x = x0 + (x1 - x0) * p, y = y0 + (y1 - y0) * p + Math.sin(p * Math.PI * 3) * 22;
      return { transform: `translate(${x}px,${y}px) rotate(${rot}deg) scaleX(${flip})` };
    };
    const anim = img.animate([frame(0, -spin), frame(.25, spin * .3), frame(.5, -spin * .3), frame(.75, spin * .3), frame(1, spin)],
      { duration: 9000 + Math.random() * 4000, easing: 'linear' });
    img.addEventListener('click', () => say(img));
    anim.onfinish = () => { img.remove(); flying = false; };
  }

  const schedule = () => setTimeout(() => { fly(); schedule(); }, 30000 + Math.random() * 30000);
  setTimeout(() => { fly(); schedule(); }, 8000);     // first appearance shortly after load

  let typed = '';
  addEventListener('keydown', e => {
    if (/input|select|textarea/i.test((e.target.tagName || ''))) return;
    typed = (typed + e.key.toLowerCase()).slice(-4);
    if (typed === 'sans') fly();
  });
})();


  function say(sans) {
    const r = sans.getBoundingClientRect(), b = document.createElement('div');
    b.className = 'sans-say'; b.textContent = LINES[Math.floor(Math.random() * LINES.length)];
    document.body.appendChild(b);
    b.style.left = Math.max(8, Math.min(innerWidth - 220, r.left)) + 'px';
    b.style.top = Math.max(8, r.top - b.offsetHeight - 14) + 'px';
    setTimeout(() => b.remove(), 2200);
  }

  function fly() {
    if (flying || document.hidden) return;
    flying = true;
    const img = document.createElement('img');
    img.src = 'assets/sans.png'; img.alt = ''; img.className = 'sans'; img.draggable = false;
    document.body.appendChild(img);

    const ltr = Math.random() < .5, W = innerWidth, H = innerHeight;
    const x0 = ltr ? -SIZE * 1.5 : W + SIZE * 1.5, x1 = ltr ? W + SIZE * 1.5 : -SIZE * 1.5;
    const y0 = H * (.12 + Math.random() * .6), y1 = H * (.12 + Math.random() * .6);
    const flip = ltr ? 1 : -1, spin = (ltr ? 1 : -1) * (18 + Math.random() * 25);
    const frame = (p, rot) => {
      const x = x0 + (x1 - x0) * p, y = y0 + (y1 - y0) * p + Math.sin(p * Math.PI * 3) * 22;
      return { transform: `translate(${x}px,${y}px) rotate(${rot}deg) scaleX(${flip})` };
    };
    const anim = img.animate([frame(0, -spin), frame(.25, spin * .3), frame(.5, -spin * .3), frame(.75, spin * .3), frame(1, spin)],
      { duration: 9000 + Math.random() * 4000, easing: 'linear' });
    img.addEventListener('click', () => say(img));
    anim.onfinish = () => { img.remove(); flying = false; };
  }

  const schedule = () => setTimeout(() => { fly(); schedule(); }, 30000 + Math.random() * 30000);
  setTimeout(() => { fly(); schedule(); }, 8000);     // first appearance shortly after load

  let typed = '';
  addEventListener('keydown', e => {
    if (/input|select|textarea/i.test((e.target.tagName || ''))) return;
    typed = (typed + e.key.toLowerCase()).slice(-4);
    if (typed === 'sans') fly();
  });
})();
