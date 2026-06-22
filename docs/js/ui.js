const $ = (sel, root = document) => root.querySelector(sel);

/** Liga evento só se o elemento existir (evita crash com HTML desatualizado). */
export function on(sel, event, handler, options) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el) {
    console.warn(`[ECU Map Diff] Elemento não encontrado: ${typeof sel === 'string' ? sel : '(node)'}`);
    return null;
  }
  el.addEventListener(event, handler, options);
  return el;
}

export function showToast(message, type = 'info', duration = 3200) {
  const host = $('#toastHost');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast--visible'));
  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 250);
  }, duration);
}

export function updateWorkflowSteps(step) {
  document.querySelectorAll('.step').forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('step--done', n < step);
    el.classList.toggle('step--active', n === step);
  });
}

export function updateTabBadges(regions = 0, diffBytes = 0) {
  const r = $('#tabBadgeRegions');
  const h = $('#tabBadgeHex');
  if (r) {
    r.textContent = regions > 0 ? String(regions) : '';
    r.hidden = regions <= 0;
  }
  if (h) {
    h.textContent = diffBytes > 0 ? '●' : '';
    h.hidden = diffBytes <= 0;
  }
}

export function setEmptyState(visible, message) {
  const el = $('#emptyState');
  if (!el) return;
  el.hidden = !visible;
  if (message) {
    const p = el.querySelector('.empty-state__text');
    if (p) p.textContent = message;
  }
  const tabs = $('.content__main');
  if (tabs) tabs.hidden = visible;
}

export function renderSimilarityBar(pct) {
  const bar = $('#similarityBar');
  const label = $('#similarityLabel');
  if (!bar || !label) return;
  const clamped = Math.max(0, Math.min(100, pct));
  bar.style.width = `${clamped}%`;
  bar.classList.toggle('similarity-bar__fill--warn', clamped < 99);
  bar.classList.toggle('similarity-bar__fill--danger', clamped < 95);
  label.textContent = `${clamped.toFixed(2)}%`;
}

export function highlightRegionRow(regionIndex) {
  document.querySelectorAll('#regionsBody tr').forEach((tr) => {
    tr.classList.toggle('row--selected', Number(tr.dataset.region) === regionIndex);
  });
}

export function setSidebarOpen(open) {
  document.body.classList.toggle('sidebar-open', open);
  const btn = $('#btnSidebar');
  if (btn) btn.setAttribute('aria-expanded', String(open));
}

export function initSidebarToggle() {
  $('#btnSidebar')?.addEventListener('click', () => {
    setSidebarOpen(!document.body.classList.contains('sidebar-open'));
  });
  document.querySelector('.sidebar-backdrop')?.addEventListener('click', () => setSidebarOpen(false));
}

export function initCollapsiblePanels() {
  document.querySelectorAll('[data-collapse]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.panel');
      panel?.classList.toggle('panel--collapsed');
      btn.setAttribute('aria-expanded', String(!panel?.classList.contains('panel--collapsed')));
    });
  });
}

export function saveActiveTab(tabId) {
  try { localStorage.setItem('ecumapdiff_tab', tabId); } catch { /* ignore */ }
}

export function restoreActiveTab(activateTab) {
  try {
    const saved = localStorage.getItem('ecumapdiff_tab') || localStorage.getItem('mrreadebin_tab');
    if (saved) activateTab(saved);
  } catch { /* ignore */ }
}

export function initKeyboardShortcuts(handlers) {
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'n' || e.key === 'N') handlers.onNextDiff?.();
    if (e.key === 'p' || e.key === 'P') handlers.onPrevDiff?.();
    if (e.key === '1') handlers.onTab?.('hex');
    if (e.key === '2') handlers.onTab?.('regions');
    if (e.key === '3') handlers.onTab?.('heatmap');
    if (e.key === '[') handlers.onHexPagePrev?.();
    if (e.key === ']') handlers.onHexPageNext?.();
  });
}

export function setCompareLoading(active, message = 'Comparando arquivos…') {
  document.body.classList.toggle('compare-busy', active);
  const el = $('#compareLoadingText');
  if (el && message) el.textContent = message;
  const host = $('#compareLoading');
  if (host) host.hidden = !active;
}
