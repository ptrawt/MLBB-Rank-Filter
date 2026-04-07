'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const TYPES = ['All', 'Tank', 'Fighter', 'Mage', 'Assassin', 'Marksman', 'Support'];
const LANES = ['All', 'Exp Lane', 'Mid Lane', 'Gold Lane', 'Jungle', 'Roam'];
const STORAGE_KEY = 'mlbb-filter-state';
const TIME_LABELS = new Set(['Past 1 day', '1 Day', 'Past 7 days', 'Past 30 days']);

// ── State ────────────────────────────────────────────────────────────────────

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      type: TYPES.includes(saved.type) ? saved.type : 'All',
      lane: LANES.includes(saved.lane) ? saved.lane : 'All',
    };
  } catch {
    return { type: 'All', lane: 'All' };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: state.type, lane: state.lane }));
}

const { type, lane } = loadState();
const state = {
  heroes: {},
  type,
  lane,
  search: '',
  loading: false,
};

let _tableContainer = null;
let _scrollContainer = null;
let _autoLoadGen = 0;

// ── Bootstrap ────────────────────────────────────────────────────────────────

fetch(chrome.runtime.getURL('hero_map.json'))
  .then(r => r.json())
  .then(({ heroes }) => {
    heroes.forEach(h => { state.heroes[h.name] = { types: h.types, lanes: h.lanes }; });
    waitForPage();
  });

// ── DOM readiness ────────────────────────────────────────────────────────────

function waitForPage() {
  const timer = setInterval(() => {
    const anchor = findFilterAnchor();
    if (!anchor) return;
    clearInterval(timer);
    injectFilterBar(anchor);
    observeMutations();
    autoLoad();
  }, 500);

  setTimeout(() => clearInterval(timer), 30_000);
}

function findFilterAnchor() {
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 0 || !TIME_LABELS.has(el.textContent.trim())) continue;

    let node = el.parentElement;
    for (let i = 0; i < 8; i++) {
      if (!node || node === document.body) break;
      if (node.textContent.includes('ALL') || node.textContent.includes('All Ranks')) return node;
      node = node.parentElement;
    }
  }
  return null;
}

// ── Filter bar ───────────────────────────────────────────────────────────────

function buildFilterGroup(label, id, values, activeValue) {
  const group = document.createElement('div');
  group.className = 'mlbb-filter-group';

  const labelEl = document.createElement('span');
  labelEl.className = 'mlbb-filter-label';
  labelEl.textContent = label;
  group.appendChild(labelEl);

  const btns = document.createElement('div');
  btns.className = 'mlbb-filter-btns';
  btns.id = id;

  for (const val of values) {
    const btn = document.createElement('button');
    btn.className = 'mlbb-btn' + (val === activeValue ? ' active' : '');
    btn.dataset.value = val;
    btn.textContent = val;
    btns.appendChild(btn);
  }

  group.appendChild(btns);
  return group;
}

function injectFilterBar(anchor) {
  if (document.getElementById('mlbb-filter-bar')) return;

  const bar = document.createElement('div');
  bar.id = 'mlbb-filter-bar';

  bar.appendChild(buildFilterGroup('Type', 'mlbb-type-btns', TYPES, state.type));
  bar.appendChild(buildFilterGroup('Lane', 'mlbb-lane-btns', LANES, state.lane));

  const rightGroup = document.createElement('div');
  rightGroup.className = 'mlbb-filter-group';
  rightGroup.style.cssText = 'margin-left:auto;gap:16px';

  const countEl = document.createElement('span');
  countEl.id = 'mlbb-count';
  countEl.className = 'mlbb-count';

  const searchEl = document.createElement('input');
  searchEl.id = 'mlbb-search';
  searchEl.className = 'mlbb-search';
  searchEl.type = 'text';
  searchEl.placeholder = 'Search hero...';

  const clearBtn = document.createElement('button');
  clearBtn.id = 'mlbb-clear';
  clearBtn.className = 'mlbb-btn mlbb-btn-clear';
  clearBtn.title = 'Clear filters';
  clearBtn.textContent = '✕';

  rightGroup.append(countEl, searchEl, clearBtn);
  bar.appendChild(rightGroup);

  anchor.insertAdjacentElement('afterend', bar);

  bar.addEventListener('click', e => {
    const btn = e.target.closest('.mlbb-filter-btns .mlbb-btn');
    if (!btn) return;

    const val = btn.dataset.value;
    const group = btn.closest('.mlbb-filter-btns');

    if (group.id === 'mlbb-type-btns') state.type = val;
    else state.lane = val;

    group.querySelectorAll('.mlbb-btn').forEach(b => b.classList.toggle('active', b === btn));
    saveState();
    applyFilters();
  });

  searchEl.addEventListener('input', e => {
    state.search = e.target.value.trim().toLowerCase();
    applyFilters();
  });

  clearBtn.addEventListener('click', () => {
    state.type = 'All';
    state.lane = 'All';
    state.search = '';
    searchEl.value = '';
    bar.querySelectorAll('.mlbb-filter-btns .mlbb-btn').forEach(b => b.classList.toggle('active', b.dataset.value === 'All'));
    saveState();
    applyFilters();
  });
}

// ── Filtering ────────────────────────────────────────────────────────────────

function findTableContainer() {
  if (_tableContainer && document.contains(_tableContainer)) return _tableContainer;
  const names = Object.keys(state.heroes);
  for (const el of document.querySelectorAll('[class]')) {
    let hits = 0;
    for (const name of names) {
      if (el.textContent.includes(name) && ++hits >= 5) {
        _tableContainer = el;
        return el;
      }
    }
  }
  return document.body;
}

function findHeroRow(nameEl) {
  let node = nameEl.parentElement;
  for (let i = 0; i < 12; i++) {
    if (!node || node === document.body) return null;
    if ((node.textContent.match(/\d+\.\d+%/g) ?? []).length >= 2) return node;
    node = node.parentElement;
  }
  return null;
}

function isHeroVisible(name) {
  const { types, lanes } = state.heroes[name];
  return (
    (state.type === 'All' || types.includes(state.type)) &&
    (state.lane === 'All' || lanes.includes(state.lane)) &&
    (!state.search || name.toLowerCase().includes(state.search))
  );
}

function applyFilters() {
  const container = findTableContainer();
  const seen = new Set();

  for (const el of container.querySelectorAll('*')) {
    if (el.children.length > 0 || el.closest('#mlbb-filter-bar')) continue;

    const name = el.textContent.trim();
    if (!state.heroes[name]) continue;

    const row = findHeroRow(el);
    if (!row || seen.has(row)) continue;
    seen.add(row);

    row.style.display = isHeroVisible(name) ? '' : 'none';
  }

  const total = seen.size;
  const shown = [...seen].filter(r => r.style.display !== 'none').length;
  const countEl = document.getElementById('mlbb-count');
  if (countEl) countEl.textContent = `${shown} / ${total}`;
}

// ── Mutation observer ────────────────────────────────────────────────────────

function observeMutations() {
  let debounce;
  new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!document.getElementById('mlbb-filter-bar')) {
        const anchor = findFilterAnchor();
        if (anchor) injectFilterBar(anchor);
      }
      if (state.loading) return;

      const loaded = countLoadedHeroes();
      const total = Object.keys(state.heroes).length;
      if (loaded < total * 0.5) {
        _tableContainer = null;
        _scrollContainer = null;
        autoLoad();
      } else {
        applyFilters();
      }
    }, 400);
  }).observe(document.body, { childList: true, subtree: true });
}

// ── Auto-load all heroes ─────────────────────────────────────────────────────

function findScrollContainer() {
  if (_scrollContainer && document.contains(_scrollContainer)) return _scrollContainer;
  let best = null;
  for (const el of document.querySelectorAll('*')) {
    if (el === document.body || el === document.documentElement) continue;
    if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 200) best = el;
  }
  _scrollContainer = best ?? document.documentElement;
  return _scrollContainer;
}

function countLoadedHeroes() {
  const container = _tableContainer ?? document.body;
  const names = new Set(Object.keys(state.heroes));
  let count = 0;
  for (const el of container.querySelectorAll('*')) {
    if (el.children.length === 0 && names.has(el.textContent.trim())) count++;
  }
  return count;
}

function setCountText(text) {
  const el = document.getElementById('mlbb-count');
  if (el) el.textContent = text;
}

async function autoLoad() {
  const gen = ++_autoLoadGen;
  state.loading = true;
  setCountText('Loading...');
  const container = findScrollContainer();
  let prev = 0;
  let stable = 0;

  while (stable < 3) {
    container.scrollTop = container.scrollHeight;
    await new Promise(r => setTimeout(r, 500));
    if (gen !== _autoLoadGen) return;
    const count = countLoadedHeroes();
    stable = count > prev ? 0 : stable + 1;
    prev = count;
  }

  state.loading = false;
  container.scrollTop = 0;
  applyFilters();
}
