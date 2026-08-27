const grid = document.getElementById('grid');
const count = document.getElementById('count');
const facets = document.getElementById('facets');
if (!grid || !count || !facets) throw new Error('browse markup missing');

const cards = [...grid.children];
let facet = 'all';

function apply() {
  let n = 0;
  for (const c of cards) {
    const ok = facet === 'all' || (` ${c.dataset.r} `).includes(` ${facet} `);
    c.hidden = !ok;
    if (ok) n++;
  }
  count.textContent = n.toLocaleString();
}

facets.addEventListener('click', (e) => {
  const b = e.target.closest('.facet');
  if (!b) return;
  facet = b.dataset.r;
  facets.querySelectorAll('.facet').forEach((f) => f.classList.toggle('on', f === b));
  apply();
});
