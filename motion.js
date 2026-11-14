/* motion.js – tiny spring engine (no dependencies)
   Springs use Apple's parameters: `response` (seconds, ~ time to settle) and `damping` (1 = critically damped, no bounce).
   They are interruptible: start a new one from the live value and pass the old one's velocity.            */

export const reduced = { v: false };                       // true when the user asked for reduced motion (kept live)
if (typeof matchMedia === 'function') {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  reduced.v = mq.matches;
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(e => { reduced.v = e.matches; });
}

/** Animate a vector of numbers from `from` to `to`. Returns { stop(), velocity(), position() }. */
export function spring(from, to, o, onUpdate, onDone) {
  const n = from.length, x = from.slice(), v = (o.velocity || new Array(n).fill(0)).slice();
  const w = 2 * Math.PI / (o.response || .4), k = w * w, c = 2 * (o.damping == null ? 1 : o.damping) * w;
  const eps = o.eps || .001;
  let raf = 0, last = 0, alive = true;
  onUpdate(x, v);                                           // paint the first frame immediately (no flash)
  const step = now => {
    if (!alive) return;
    const dt = last ? Math.min(.032, (now - last) / 1000) : 1 / 60; last = now;
    const sub = Math.max(1, Math.ceil(dt / .004)), h = dt / sub;
    for (let s = 0; s < sub; s++) for (let j = 0; j < n; j++) { v[j] += (k * (to[j] - x[j]) - c * v[j]) * h; x[j] += v[j] * h; }
    const rest = x.every((xj, j) => Math.abs(to[j] - xj) < eps && Math.abs(v[j]) < eps * 10);
    if (rest) { alive = false; onUpdate(to.slice(), v.fill(0)); if (onDone) onDone(); return; }
    onUpdate(x, v);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { stop() { alive = false; cancelAnimationFrame(raf); }, velocity: () => v.slice(), position: () => x.slice() };
}

/** "Materialize" an element: fades + scales + slides in from an offset, springing to rest.
    Uses the individual `translate` / `scale` properties so it never fights an element's own `transform`. */
export function materialize(el, { dx = 0, dy = 10, from = .975, response = .38 } = {}) {
  if (!el) return;
  if (el._mat) el._mat.stop();
  const rm = reduced.v;                                    // reduced motion: quick crossfade only
  el._mat = spring([0, rm ? 0 : dx, rm ? 0 : dy, rm ? 1 : from], [1, 0, 0, 1], { response: rm ? .2 : response, damping: 1, eps: .002 },
    ([o, x, y, s]) => { el.style.opacity = o; if (!rm) { el.style.translate = `${x}px ${y}px`; el.style.scale = s; } },
    () => { el.style.opacity = el.style.translate = el.style.scale = ''; el._mat = null; });
}
