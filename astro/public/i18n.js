/* THROWAWAY — client-side i18n localizer (tickets 13/14). Baked English is source of truth;
   this swaps chrome (data-i18n) + names (data-i18n-name) in place from per-locale JSON, caching
   catalogs in localStorage so repeat visits apply synchronously with no English flash. Plain JS.
   Exposes window.__seApplyI18n(root) so dynamically-rendered nodes (search results) get localized. */
(function () {
  var LOCS = { eng: 'en', spa: 'es', rus: 'ru', arb: 'ar' };
  var orig = new WeakMap();
  function baked(n, attr) {
    var key = attr || 'text', m = orig.get(n) || {};
    if (!(key in m)) { m[key] = attr ? n.getAttribute(attr) : n.textContent; orig.set(n, m); }
    return m[key];
  }
  function cacheGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

  function apply(chrome, names, root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (n) {
      n.textContent = (chrome && chrome[n.getAttribute('data-i18n')]) || baked(n);
    });
    root.querySelectorAll('[data-i18n-ph]').forEach(function (n) {
      n.setAttribute('placeholder', (chrome && chrome[n.getAttribute('data-i18n-ph')]) || baked(n, 'placeholder'));
    });
    root.querySelectorAll('[data-i18n-name]').forEach(function (n) {
      n.textContent = (names && names[n.getAttribute('data-i18n-name')]) || baked(n);
    });
    document.documentElement.removeAttribute('data-i18n-pending');
  }
  function toEnglish(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = baked(n); });
    root.querySelectorAll('[data-i18n-ph]').forEach(function (n) { n.setAttribute('placeholder', baked(n, 'placeholder')); });
    root.querySelectorAll('[data-i18n-name]').forEach(function (n) { n.textContent = baked(n); });
    document.documentElement.removeAttribute('data-i18n-pending');
  }

  function localize(loc, root) {
    if (loc === 'eng') { toEnglish(root); return; }
    var c = cacheGet('se-chrome-' + loc), nm = cacheGet('se-names-' + loc);
    if (c && nm) { apply(c, nm, root); return; }
    Promise.all([
      fetch('/i18n/chrome.' + loc + '.json').then(function (r) { return r.json(); }),
      fetch('/i18n/names.' + loc + '.json').then(function (r) { return r.json(); })
    ]).then(function (a) {
      try { localStorage.setItem('se-chrome-' + loc, JSON.stringify(a[0])); localStorage.setItem('se-names-' + loc, JSON.stringify(a[1])); } catch (e) {}
      apply(a[0], a[1], root);
    }).catch(function () { document.documentElement.removeAttribute('data-i18n-pending'); });
  }

  // Re-apply the CURRENT locale to a freshly-rendered subtree (search results, etc.).
  window.__seApplyI18n = function (root) {
    var loc = window.__seLoc || 'eng';
    if (loc === 'eng') return;                       // baked English already correct
    var c = cacheGet('se-chrome-' + loc), nm = cacheGet('se-names-' + loc);
    if (c && nm) apply(c, nm, root || document);     // catalogs are cached after initial localize
    else localize(loc, root || document);            // fall back to fetch if not cached yet
  };

  localize(window.__seLoc || 'eng');

  var sel = document.getElementById('locale-picker');
  if (sel) {
    sel.value = window.__seLoc || 'eng';
    sel.addEventListener('change', function () {
      var nl = sel.value;
      localStorage.setItem('se-loc', nl); window.__seLoc = nl;
      var el = document.documentElement; el.lang = LOCS[nl] || 'en'; el.dir = (nl === 'arb') ? 'rtl' : 'ltr';
      localize(nl);
    });
  }
})();
