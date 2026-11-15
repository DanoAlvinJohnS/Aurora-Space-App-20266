/* theme.js - lets people choose the look of the interface.
   Load it in <head> (no defer) so the saved theme is applied before the first paint.
     - the choice is saved in localStorage ("tf-theme") and shared between tabs
     - a round palette button is added to the nav on every page that has one
     - a "tf:theme" event tells app.js to restyle the globe (atmosphere, sky, outline)
   The colours themselves live in style.css (Classic, the defaults) and themes.css (the others). */
(function () {
  'use strict';
  var KEY = 'tf-theme';
  var THEMES = [
    { id: 'classic', name: 'Classic', note: 'The original blue and orange on graphite' },
    { id: 'mario',   name: 'Mario',   note: 'Pixel-art sky, bricks and coin-block buttons' },
    { id: 'undertale', name: 'Undertale', note: 'Black boxes, white borders and a red SOUL' }
  ];
  var root = document.documentElement, btn = null, menu = null;

  var FONTS = {                                     // pixel fonts are only downloaded for the looks that use them
    mario: 'https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400..700&family=Press+Start+2P&display=swap',
    undertale: 'https://fonts.googleapis.com/css2?family=DotGothic16&display=swap'
  };
  function loadFonts(id) {
    var lid = 'tf-fonts-' + id;
    if (!FONTS[id] || document.getElementById(lid)) return;
    var l = document.createElement('link'); l.id = lid; l.rel = 'stylesheet'; l.href = FONTS[id]; document.head.appendChild(l);
  }
  function valid(id) { return THEMES.some(function (t) { return t.id === id; }); }
  function saved() { try { var v = localStorage.getItem(KEY); if (valid(v)) return v; } catch (e) { /* storage blocked */ } return 'classic'; }

  function sync() {
    var id = root.getAttribute('data-theme');
    if (menu) [].forEach.call(menu.querySelectorAll('.theme-opt'), function (b) { b.setAttribute('aria-checked', b.dataset.id === id ? 'true' : 'false'); });
    if (btn) { var t = THEMES.filter(function (x) { return x.id === id; })[0]; btn.title = 'Change look (now ' + (t ? t.name : id) + ')'; }
  }

  function set(id, persist) {
    if (!valid(id)) id = 'classic';
    root.setAttribute('data-theme', id);
    loadFonts(id);
    if (persist) { try { localStorage.setItem(KEY, id); } catch (e) { /* storage blocked */ } }
    sync();
    window.dispatchEvent(new CustomEvent('tf:theme', { detail: { id: id } }));
  }

  function build() {
    var nav = document.querySelector('nav.nav');
    if (!nav || document.getElementById('theme')) return;

    var wrap = document.createElement('span');       // a span, not a div: ".nav div" in style.css styles the link pill
    wrap.className = 'theme'; wrap.id = 'theme';

    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'theme-btn'; btn.id = 'theme-btn';
    btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'theme-menu');
    btn.setAttribute('aria-label', 'Change look');
    btn.innerHTML = '<i aria-hidden="true"></i>';

    menu = document.createElement('ul');
    menu.className = 'theme-menu'; menu.id = 'theme-menu'; menu.hidden = true;
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Interface look');
    menu.innerHTML = '<li role="presentation" class="theme-cap">Interface look</li>';
    THEMES.forEach(function (t) {
      var li = document.createElement('li'), b = document.createElement('button');
      li.setAttribute('role', 'none');
      b.type = 'button'; b.className = 'theme-opt'; b.dataset.id = t.id; b.setAttribute('role', 'menuitemradio');
      b.innerHTML = '<span class="theme-sw" data-t="' + t.id + '" aria-hidden="true"></span><span><b>' + t.name + '</b><small>' + t.note + '</small></span><span class="ck" aria-hidden="true"></span>';
      b.addEventListener('click', function () { set(t.id, true); close(true); });
      li.appendChild(b); menu.appendChild(li);
    });

    wrap.appendChild(btn); wrap.appendChild(menu); nav.appendChild(wrap);
    sync();

    function open() {
      menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
      (menu.querySelector('[aria-checked="true"]') || menu.querySelector('.theme-opt')).focus();
    }
    function close(refocus) {
      if (menu.hidden) return;
      menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus();
    }
    btn.addEventListener('click', function () { if (menu.hidden) open(); else close(true); });
    document.addEventListener('pointerdown', function (e) { if (!wrap.contains(e.target)) close(false); }, true);
    document.addEventListener('keydown', function (e) {
      if (menu.hidden) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }   // app.js also uses Escape to clear the selected country
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      var items = [].slice.call(menu.querySelectorAll('.theme-opt')), i = items.indexOf(document.activeElement);
      i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[i].focus();
    });
  }

  set(saved(), false);                               // apply right away, before anything is painted
  window.addEventListener('storage', function (e) { if (e.key === KEY) set(saved(), false); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
