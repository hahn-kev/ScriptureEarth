// Home-page world map (markup: src/components/WorldMap.astro, SVG: scripts/gen_map.mjs).
//
// - Fetches the SVG only when the section nears the viewport (poor-connection friendly).
// - Mouse: hover shows a tooltip, a click on a country opens its page.
// - Touch (and mouse clicks on water/gaps): lists the countries near the tap under the
//   map, then scrolls the map to the top so map + list fill the screen. A whole-world map
//   is too small to hit most countries with a finger, so a tap means "countries here".
// - Country names: the site's English name, or Intl.DisplayNames for other UI locales.
// Decisions behind this: .scratch/home-language-map/ (wayfinder map, tickets 04/08/09).

const sec = document.getElementById('world-map');
const grid = document.getElementById('wm-grid');
const wrap = document.getElementById('wm-map');
const list = document.getElementById('wm-list');
const ul = document.getElementById('wm-ul');
const tip = document.getElementById('wm-tip');

// Finger imprecision in screen pixels. ~30 map units on a phone, ~9 on desktop.
const RADIUS_PX = 10;
// Outlines narrower than this (map units) are also found by centroid distance.
const SMALL_UNITS = 40;

let loaded = false;
let lastPointer = 'mouse';
// A "mouse" interaction needs a mouse event AND a device whose primary pointer is fine:
// touch laptops get the right behaviour per input, and phones get the list even when a
// browser reports the tap's pointer type oddly.
const touchFirst = matchMedia('(pointer: coarse)');
const isMouse = (type) => type === 'mouse' && !touchFirst.matches;
let smallEls = null;
let youCode = null;

// --- tap-to-zoom: a touch tap zooms the map (not the page) one level on that spot.
// No panning; taps while zoomed only refresh the list; zoom out via the button or by
// closing the list. The page scrolls the map into place first, then the viewBox is
// tweened (strokes stay crisp and hit-testing follows the zoom automatically).
// PROTOTYPE (to remove before merge): zoom factor, duration and projection (Mercator vs
// Equal Earth) can be changed from the #wm-proto controls, persisted in localStorage;
// ?proj=ee / ?proj=mercator in the URL sets the projection too, for sharing with testers.
const zoomBtn = document.getElementById('wm-zoomout');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const P = { zoom: 3, ms: 260, proj: 'mercator' };
let BASE = null; // full-map viewBox
let view = null; // current viewBox (map units)
let zoomed = false;
let tween = 0;

const protoForm = document.getElementById('wm-proto');
if (protoForm) {
  try { Object.assign(P, JSON.parse(localStorage.getItem('wm-proto') || '{}')); } catch {}
  const q = new URLSearchParams(location.search).get('proj');
  if (q) P.proj = /^(ee|equal)/i.test(q) ? 'ee' : 'mercator';
  if (P.proj !== 'ee') P.proj = 'mercator';
  try { localStorage.setItem('wm-proto', JSON.stringify(P)); } catch {}
  for (const k of Object.keys(P)) {
    const el = protoForm.elements[k];
    if (el) el.value = P[k];
    const out = protoForm.querySelector(`[data-out="${k}"]`);
    if (out) out.textContent = P[k];
  }
  protoForm.addEventListener('input', (e) => {
    const k = e.target.name;
    const v = e.target.type === 'range' ? +e.target.value : e.target.value;
    const projChanged = k === 'proj' && v !== P.proj;
    P[k] = v;
    const out = protoForm.querySelector(`[data-out="${k}"]`);
    if (out) out.textContent = v;
    try { localStorage.setItem('wm-proto', JSON.stringify(P)); } catch {}
    if (projChanged) switchProjection();
  });
}

const ease = (t) => 1 - (1 - t) ** 3;

function setView(v, animate) {
  const svg = wrap.querySelector('svg');
  if (!svg) return;
  const ms = animate && !reduceMotion.matches ? P.ms : 0;
  cancelAnimationFrame(tween);
  const from = { ...view };
  const t0 = performance.now();
  const step = (now) => {
    const t = ms ? Math.min(1, (now - t0) / ms) : 1;
    const k = ease(t);
    const c = ['x', 'y', 'w', 'h'].map((p) => from[p] + (v[p] - from[p]) * k);
    svg.setAttribute('viewBox', c.join(' '));
    view = { x: c[0], y: c[1], w: c[2], h: c[3] };
    if (t < 1) tween = requestAnimationFrame(step);
  };
  tween = requestAnimationFrame(step);
}

function zoomAt(mx, my) {
  if (!BASE || zoomed) return;
  const w = BASE.w / P.zoom;
  const h = BASE.h / P.zoom;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  zoomed = true;
  zoomBtn.hidden = false;
  setView({ x: clamp(mx - w / 2, 0, BASE.w - w), y: clamp(my - h / 2, 0, BASE.h - h), w, h }, true);
}

function zoomOut() {
  if (!zoomed) return;
  zoomed = false;
  zoomBtn.hidden = true;
  setView({ ...BASE }, true);
}

zoomBtn.addEventListener('click', zoomOut);

// Resolves once the page has stopped scrolling (smooth scrollIntoView has no promise).
function afterScroll() {
  return new Promise((resolve) => {
    let last = scrollY;
    let still = 0;
    const t0 = performance.now();
    const tick = () => {
      const now = performance.now();
      if (scrollY === last) still++; else { still = 0; last = scrollY; }
      // 4 still frames after the scroll had a chance to start, or give up after 900 ms.
      if ((still >= 4 && now - t0 > 120) || now - t0 > 900) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const ee = () => P.proj === 'ee';
wrap.style.aspectRatio = ee() ? wrap.dataset.aspectEe : wrap.dataset.aspect;

function load() {
  if (loaded) return;
  loaded = true;
  fetch(ee() ? wrap.dataset.mapUrlEe : wrap.dataset.mapUrl)
    .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
    .then((svg) => {
      wrap.innerHTML = svg;
      smallEls = null;
      const vb = wrap.querySelector('svg').viewBox.baseVal;
      BASE = { x: 0, y: 0, w: vb.width, h: vb.height };
      view = { ...BASE };
      // Highlight the visitor's guessed country (geo-suggest.js renders it as a link).
      const a = document.querySelector('#geo-suggest a[href^="/country/"]');
      youCode = a ? a.getAttribute('href').split('/')[2] : null;
      if (youCode) wrap.querySelector(`#${CSS.escape(youCode)}`)?.classList.add('is-you');
    })
    .catch(() => { sec.hidden = true; });
}

// PROTOTYPE: swap to the other projection's map in place.
function switchProjection() {
  closeList();
  cancelAnimationFrame(tween);
  zoomed = false;
  zoomBtn.hidden = true;
  wrap.style.aspectRatio = ee() ? wrap.dataset.aspectEe : wrap.dataset.aspect;
  if (!loaded) return; // not fetched yet: load() will pick the chosen map
  loaded = false;
  load();
}

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
  }, { rootMargin: '300px' });
  io.observe(sec);
} else {
  load();
}

// --- names
let dn = null;
let dnLang = '';
function nameOf(el) {
  const code = el.id.replace(/-pt$/, '');
  const eng = el.querySelector('title')?.textContent || code;
  if ((window.__seLoc || 'eng') === 'eng') return eng;
  const lang = document.documentElement.lang;
  try {
    if (lang !== dnLang) { dn = new Intl.DisplayNames([lang], { type: 'region' }); dnLang = lang; }
    const n = dn.of(code);
    return n && n !== code ? n : eng;
  } catch {
    return eng;
  }
}

const countryOf = (target) => {
  const el = target?.closest?.('#wm-map [data-n]');
  return el && el.dataset.n !== '0' ? el : null;
};
const codeOf = (el) => el.id.replace(/-pt$/, '');

// --- hover tooltip (mouse only)
wrap.addEventListener('pointermove', (e) => {
  if (!isMouse(e.pointerType)) return;
  const el = countryOf(e.target);
  if (!el) { tip.hidden = true; return; }
  tip.textContent = `${nameOf(el)} · ${el.dataset.n}`;
  tip.hidden = false;
  tip.style.left = `${e.clientX}px`;
  tip.style.top = `${e.clientY}px`;
});
wrap.addEventListener('pointerleave', () => { tip.hidden = true; });
wrap.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; });

// --- tap → countries near it
// (1) whatever is under the finger and on two rings around it — catches big countries
//     wherever they are touched; (2) small countries (circles, slivers) whose centroid is
//     within the radius — catches islands the rings miss.
function indexSmall() {
  smallEls = [];
  for (const el of wrap.querySelectorAll('[data-cx]')) {
    if (el.tagName === 'circle') { smallEls.push(el); continue; }
    const b = el.getBBox();
    if (Math.max(b.width, b.height) < SMALL_UNITS) smallEls.push(el);
  }
}

function near(x, y) {
  const svg = wrap.querySelector('svg');
  if (!svg) return [];
  if (!smallEls) indexSmall();
  const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM().inverse());
  const scale = svg.getScreenCTM().a; // screen px per map unit, including any zoom
  const r = RADIUS_PX / scale;
  const found = new Map();
  const add = (el, d) => {
    if (!el) return;
    const code = codeOf(el);
    const prev = found.get(code);
    if (!prev || d < prev.d) found.set(code, { code, el, d });
  };
  add(countryOf(document.elementFromPoint(x, y)), 0);
  for (const f of [1 / 3, 2 / 3, 1]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(countryOf(document.elementFromPoint(x + Math.cos(a) * RADIUS_PX * f, y + Math.sin(a) * RADIUS_PX * f)), r * f);
    }
  }
  for (const el of smallEls) {
    if (el.dataset.n === '0') continue;
    const d = Math.hypot(+el.dataset.cx - p.x, +el.dataset.cy - p.y);
    if (d <= r) add(el, d);
  }
  const out = [...found.values()].sort((a, b) => a.d - b.d);
  const yi = out.findIndex((o) => o.code === youCode);
  if (yi > 0) out.unshift(out.splice(yi, 1)[0]);
  return out;
}

function clearNear() {
  wrap.querySelectorAll('.is-near').forEach((e) => e.classList.remove('is-near'));
}

function openList(items) {
  clearNear();
  ul.textContent = '';
  for (const it of items) {
    it.el.classList.add('is-near');
    const li = document.createElement('li');
    if (it.code === youCode) li.className = 'you';
    const a = document.createElement('a');
    a.href = `/country/${it.code}/`;
    const name = document.createElement('span');
    name.textContent = nameOf(it.el);
    const n = document.createElement('span');
    n.className = 'n tnum';
    n.textContent = it.el.dataset.n;
    a.append(name, n);
    li.append(a);
    ul.append(li);
  }
  sizeOpen();
  list.hidden = false;
  sec.classList.add('is-open');
  ul.scrollTop = 0;
  // Pinch-zoomed page: the scroll and the fill-the-screen height are in layout-viewport
  // units and fight the zoomed view, so leave the page where it is and just show the list.
  const pinched = (window.visualViewport?.scale ?? 1) > 1.01;
  sec.classList.toggle('is-pinched', pinched);
  if (pinched) return Promise.resolve();
  // Map to the top of the screen (under the sticky header); on phones the list fills the rest.
  const hdr = document.querySelector('header.site')?.getBoundingClientRect().height || 0;
  const distance = Math.abs(grid.getBoundingClientRect().top - (hdr + 8));
  grid.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  return distance < 4 ? Promise.resolve() : afterScroll();
}

// Inputs for the phone "map + list fill the screen" height (CSS in WorldMap.astro): the
// sticky header's height, and the map column's own height so a landscape phone, where
// the map alone is taller than the screen, still leaves room for the list.
function sizeOpen() {
  const hdr = document.querySelector('header.site')?.getBoundingClientRect().height || 0;
  sec.style.setProperty('--wm-hdr', `${hdr}px`);
  sec.style.setProperty('--wm-col-h', `${sec.querySelector('.wm-col').getBoundingClientRect().height}px`);
  grid.style.scrollMarginTop = `${hdr + 8}px`;
}
addEventListener('resize', () => { if (!list.hidden) sizeOpen(); });

function closeList() {
  list.hidden = true;
  sec.classList.remove('is-open');
  clearNear();
  zoomOut();
}

document.getElementById('wm-close').addEventListener('click', closeList);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !list.hidden) closeList(); });

wrap.addEventListener('click', async (e) => {
  const hit = countryOf(e.target);
  const mouse = isMouse(lastPointer);
  if (mouse && hit) { location.href = `/country/${codeOf(hit)}/`; return; }
  const items = near(e.clientX, e.clientY);
  if (!items.length) {
    // Ocean with nothing near: close the list, but a near-miss never throws away a zoom.
    if (!zoomed) closeList();
    return;
  }
  // Remember where the tap landed on the map before the page scroll moves it.
  const svg = wrap.querySelector('svg');
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const scrolled = openList(items);
  if (mouse || zoomed) return; // no zoom for mouse; taps while zoomed only refresh the list
  await scrolled; // scroll the map into place first, then zoom
  zoomAt(p.x, p.y);
});
