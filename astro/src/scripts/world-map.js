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

function load() {
  if (loaded) return;
  loaded = true;
  fetch(wrap.dataset.mapUrl)
    .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
    .then((svg) => {
      wrap.innerHTML = svg;
      // Highlight the visitor's guessed country (geo-suggest.js renders it as a link).
      const a = document.querySelector('#geo-suggest a[href^="/country/"]');
      youCode = a ? a.getAttribute('href').split('/')[2] : null;
      if (youCode) wrap.querySelector(`#${CSS.escape(youCode)}`)?.classList.add('is-you');
    })
    .catch(() => { sec.hidden = true; });
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
  const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
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
  list.hidden = false;
  sec.classList.add('is-open');
  ul.scrollTop = 0;
  // Map to the top of the screen (under the sticky header); on phones the list fills the rest.
  const hdr = document.querySelector('header.site')?.getBoundingClientRect().height || 0;
  sec.style.setProperty('--wm-hdr', `${hdr}px`);
  grid.style.scrollMarginTop = `${hdr + 8}px`;
  grid.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function closeList() {
  list.hidden = true;
  sec.classList.remove('is-open');
  clearNear();
}

document.getElementById('wm-close').addEventListener('click', closeList);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !list.hidden) closeList(); });

wrap.addEventListener('click', (e) => {
  const hit = countryOf(e.target);
  if (isMouse(lastPointer) && hit) { location.href = `/country/${codeOf(hit)}/`; return; }
  const items = near(e.clientX, e.clientY);
  if (items.length) openList(items);
  else closeList();
});
