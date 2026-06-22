/** Paginação hex — uma “página” = bloco fixo de linhas renderizadas. */
export const HEX_ROWS_PER_PAGE = 48;

export function computeHexView(state, { cols = 16, hideEqual = false } = {}) {
  const diffRows = state.diffRows || [];
  const fileLen = state.decodedA?.length || 0;
  const fileRows = cols > 0 ? Math.ceil(fileLen / cols) : 0;
  const totalRows = hideEqual ? diffRows.length : fileRows;
  const totalPages = Math.max(1, Math.ceil(Math.max(totalRows, 1) / HEX_ROWS_PER_PAGE));
  const page = Math.min(Math.max(0, state.hexPage ?? 0), totalPages - 1);
  const startRow = page * HEX_ROWS_PER_PAGE;
  const endRow = Math.min(totalRows, startRow + HEX_ROWS_PER_PAGE);

  return {
    page,
    totalPages,
    startRow,
    endRow,
    totalRows,
    hideEqual,
    cols,
    isEmpty: totalRows === 0,
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

export function offsetToHexPage(offset, state, { cols = 16, hideEqual = false } = {}) {
  let rowIndex;
  if (hideEqual) {
    rowIndex = (state.diffRows || []).findIndex((off) => off >= offset);
    if (rowIndex < 0) rowIndex = Math.max(0, (state.diffRows?.length || 1) - 1);
  } else {
    rowIndex = Math.floor(offset / cols);
  }
  return Math.floor(rowIndex / HEX_ROWS_PER_PAGE);
}

export function getPageOffsetRange(view, state) {
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

export function formatHexEmptyMessage(hideEqual) {
  if (hideEqual) {
    return `<div class="hex-empty">
      <p>Nenhuma linha com diferença nesta visualização.</p>
      <p class="muted">Desmarque <strong>Só linhas com diferença</strong> para navegar o arquivo completo por páginas.</p>
    </div>`;
  }
  return `<div class="hex-empty"><p class="muted">Sem linhas hex para exibir.</p></div>`;
}

export function formatHexPagerMeta(view, range, alignB) {
  if (view.isEmpty) return 'Nenhuma linha nesta visualização';
  const { firstA, lastA } = range;
  const lastByte = lastA + view.cols;
  const mode = view.hideEqual ? 'só diferenças' : 'arquivo completo';
  const lines = `Linhas ${(view.startRow + 1).toLocaleString('pt-BR')}–${view.endRow.toLocaleString('pt-BR')} de ${view.totalRows.toLocaleString('pt-BR')}`;
  const bytes = `0x${firstA.toString(16).toUpperCase()} – 0x${lastByte.toString(16).toUpperCase()}`;
  const align = alignB ? ` · offset B ${alignB >= 0 ? '+' : ''}${alignB}` : '';
  return `${lines} · ${bytes} · ${mode}${align}`;
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
    input.max = String(view.totalPages);
    input.value = String(view.page + 1);
  }
  if (total) total.textContent = `/ ${view.totalPages.toLocaleString('pt-BR')}`;
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
