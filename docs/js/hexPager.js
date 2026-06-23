/** Paginação hex — uma “página” = bloco fixo de linhas renderizadas. */
export const HEX_ROWS_PER_PAGE = 48;

/** Páginas do arquivo completo que intersectam alguma região de diff. */
export function buildDiffPageIndices(regions, cols, fileLen, rowsPerPage = HEX_ROWS_PER_PAGE) {
  if (!regions?.length || cols < 1 || fileLen < 1) return [];
  const fileRows = Math.ceil(fileLen / cols);
  const pages = new Set();
  for (const r of regions) {
    const startRow = Math.floor(r.start / cols);
    const endRow = Math.floor(r.end / cols);
    const startPage = Math.floor(startRow / rowsPerPage);
    const endPage = Math.floor(endRow / rowsPerPage);
    for (let p = startPage; p <= endPage; p++) {
      if (p >= 0 && p * rowsPerPage < fileRows) pages.add(p);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

export function computeHexView(state, { cols = 16, hideEqual = false, diffPagesOnly = false } = {}) {
  const diffRows = state.diffRows || [];
  const diffPages = state.diffPages || [];
  const fileLen = state.decodedA?.length || 0;
  const fileRows = cols > 0 ? Math.ceil(fileLen / cols) : 0;

  if (hideEqual) {
    const totalRows = diffRows.length;
    const totalPages = Math.max(1, Math.ceil(Math.max(totalRows, 1) / HEX_ROWS_PER_PAGE));
    const page = Math.min(Math.max(0, state.hexPage ?? 0), totalPages - 1);
    const startRow = page * HEX_ROWS_PER_PAGE;
    const endRow = Math.min(totalRows, startRow + HEX_ROWS_PER_PAGE);
    return {
      page,
      totalPages,
      filePage: null,
      startRow,
      endRow,
      totalRows,
      hideEqual: true,
      diffPagesOnly: false,
      cols,
      isEmpty: totalRows === 0,
      rowCount: Math.max(0, endRow - startRow),
      _diffRows: diffRows,
    };
  }

  if (diffPagesOnly) {
    const totalPages = Math.max(1, diffPages.length);
    const page = Math.min(Math.max(0, state.hexPage ?? 0), Math.max(0, diffPages.length - 1));
    const filePage = diffPages[page] ?? 0;
    const startRow = filePage * HEX_ROWS_PER_PAGE;
    const endRow = Math.min(fileRows, startRow + HEX_ROWS_PER_PAGE);
    return {
      page,
      totalPages: diffPages.length ? totalPages : 1,
      filePage,
      startRow,
      endRow,
      totalRows: fileRows,
      hideEqual: false,
      diffPagesOnly: true,
      cols,
      isEmpty: diffPages.length === 0,
      rowCount: diffPages.length ? Math.max(0, endRow - startRow) : 0,
      _diffRows: diffRows,
      _diffPages: diffPages,
    };
  }

  const totalPages = Math.max(1, Math.ceil(Math.max(fileRows, 1) / HEX_ROWS_PER_PAGE));
  const page = Math.min(Math.max(0, state.hexPage ?? 0), totalPages - 1);
  const startRow = page * HEX_ROWS_PER_PAGE;
  const endRow = Math.min(fileRows, startRow + HEX_ROWS_PER_PAGE);

  return {
    page,
    totalPages,
    filePage: page,
    startRow,
    endRow,
    totalRows: fileRows,
    hideEqual: false,
    diffPagesOnly: false,
    cols,
    isEmpty: fileRows === 0,
    rowCount: Math.max(0, endRow - startRow),
    _diffRows: diffRows,
  };
}

export function resolveHexRowOffset(view, rowIndex, { alignB = 0, synced = true, side = 'a' } = {}) {
  const { hideEqual, cols, _diffRows } = view;

  if (hideEqual) {
    const offsetA = _diffRows?.[rowIndex];
    if (offsetA == null) return null;
    return { offsetA, offsetB: offsetA + alignB };
  }

  if (side === 'b' && !synced) {
    const offsetB = rowIndex * cols;
    return { offsetA: offsetB - alignB, offsetB };
  }

  const offsetA = rowIndex * cols;
  return { offsetA, offsetB: offsetA + alignB };
}

export function offsetToHexPage(offset, state, { cols = 16, hideEqual = false, diffPagesOnly = false } = {}) {
  let rowIndex;
  if (hideEqual) {
    rowIndex = (state.diffRows || []).findIndex((off) => off >= offset);
    if (rowIndex < 0) rowIndex = Math.max(0, (state.diffRows?.length || 1) - 1);
    return Math.floor(rowIndex / HEX_ROWS_PER_PAGE);
  }

  const filePage = Math.floor(Math.floor(offset / cols) / HEX_ROWS_PER_PAGE);
  if (diffPagesOnly && state.diffPages?.length) {
    let idx = state.diffPages.findIndex((p) => p >= filePage);
    if (idx < 0) idx = state.diffPages.length - 1;
    return idx;
  }
  return filePage;
}

export function getPageOffsetRange(view) {
  if (view.isEmpty || view.rowCount === 0) {
    return { firstA: 0, lastA: 0 };
  }
  const { hideEqual, cols, startRow, endRow, _diffRows } = view;
  const lastRowIdx = Math.max(startRow, endRow - 1);

  if (hideEqual) {
    const firstA = _diffRows[startRow] ?? 0;
    const lastA = _diffRows[lastRowIdx] ?? firstA;
    return { firstA, lastA };
  }

  return { firstA: startRow * cols, lastA: lastRowIdx * cols };
}

export function formatHexEmptyMessage(hideEqual, diffPagesOnly) {
  if (hideEqual) {
    return `<div class="hex-empty">
      <p>Nenhuma linha com diferença nesta visualização.</p>
      <p class="muted">Desmarque <strong>Só linhas com diferença</strong> para ver o arquivo completo por páginas.</p>
    </div>`;
  }
  if (diffPagesOnly) {
    return `<div class="hex-empty">
      <p>Nenhuma página com diferença.</p>
      <p class="muted">Os arquivos são idênticos ou desmarque <strong>Só páginas com diferença</strong>.</p>
    </div>`;
  }
  return `<div class="hex-empty"><p class="muted">Sem linhas hex para exibir.</p></div>`;
}

export function formatHexPagerMeta(view, range, alignB) {
  if (view.isEmpty) return 'Nenhuma linha nesta visualização';
  const { firstA, lastA } = range;
  const lastByte = lastA + view.cols;
  let mode = 'arquivo completo';
  if (view.hideEqual) mode = 'só linhas com diferença';
  else if (view.diffPagesOnly) mode = 'só páginas com diferença';
  const lines = `Linhas ${(view.startRow + 1).toLocaleString('pt-BR')}–${view.endRow.toLocaleString('pt-BR')} de ${view.totalRows.toLocaleString('pt-BR')}`;
  const bytes = `0x${firstA.toString(16).toUpperCase()} – 0x${lastByte.toString(16).toUpperCase()}`;
  const align = alignB ? ` · offset B ${alignB >= 0 ? '+' : ''}${alignB}` : '';
  const filePageHint = view.diffPagesOnly && view.filePage != null
    ? ` · página arquivo #${(view.filePage + 1).toLocaleString('pt-BR')}`
    : '';
  return `${lines} · ${bytes} · ${mode}${filePageHint}${align}`;
}

export function updateHexPagerControls(view) {
  const bar = document.getElementById('hexPagination');
  if (!bar) return;

  const first = bar.querySelector('[data-page="first"]');
  const prev = bar.querySelector('[data-page="prev"]');
  const next = bar.querySelector('[data-page="next"]');
  const last = bar.querySelector('[data-page="last"]');
  const input = bar.querySelector('#hexPageInput');
  const total = bar.querySelector('#hexPageTotal');

  const disabled = view.isEmpty;
  const atStart = view.page <= 0;
  const atEnd = view.page >= view.totalPages - 1;

  if (first) first.disabled = disabled || atStart;
  if (prev) prev.disabled = disabled || atStart;
  if (next) next.disabled = disabled || atEnd;
  if (last) last.disabled = disabled || atEnd;

  if (input) {
    input.disabled = disabled;
    input.min = '1';
    input.max = String(Math.max(1, view.totalPages));
    input.value = String(view.page + 1);
  }
  if (total) total.textContent = `/ ${Math.max(1, view.totalPages).toLocaleString('pt-BR')}`;
}

export function syncDiffPagesOnlyUI(hideEqual) {
  const wrap = document.getElementById('hexDiffPagesOnlyWrap');
  const input = document.getElementById('hexDiffPagesOnly');
  if (!wrap || !input) return;
  const off = !!hideEqual;
  input.disabled = off;
  wrap.classList.toggle('muted', off);
  if (off) input.checked = false;
}

export function initHexPager(onPageChange) {
  const bar = document.getElementById('hexPagination');
  if (!bar || bar.dataset.bound) return;
  bar.dataset.bound = '1';

  const readPage = () => {
    const input = bar.querySelector('#hexPageInput');
    const total = Math.max(1, Number(input?.max) || 1);
    const page = Math.min(total, Math.max(1, Number(input?.value) || 1)) - 1;
    return { page, total };
  };

  bar.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { page, total } = readPage();
      const action = btn.dataset.page;
      if (action === 'first') onPageChange(0);
      else if (action === 'prev') onPageChange(Math.max(0, page - 1));
      else if (action === 'next') onPageChange(Math.min(total - 1, page + 1));
      else if (action === 'last') onPageChange(total - 1);
    });
  });

  const input = bar.querySelector('#hexPageInput');
  if (input) {
    const commit = () => {
      const total = Math.max(1, Number(input.max) || 1);
      const n = Math.min(total, Math.max(1, Number(input.value) || 1));
      onPageChange(n - 1);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });
  }
}
