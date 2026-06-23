import {
  parseMetadata,
  renderMetadata,
  renderSections,
  extractStrings,
  md5Hex,
  enrichMetadata,
} from './ecuParser.js';
import {
  decodeBuffer,
  formatHexLine,
} from './decrypt.js';
import {
  analyzeRegion,
  analyzeRegionLight,
  buildDiffRowsFromRegions,
  buildHeatmapBuckets,
  exportReport,
  getDiffCount,
} from './diffEngine.js';
import { scanDiffAsync } from './diffCompare.js';
import {
  HEX_ROWS_PER_PAGE,
  computeHexView,
  resolveHexRowOffset,
  offsetToHexPage,
  getPageOffsetRange,
  formatHexEmptyMessage,
  formatHexPagerMeta,
  updateHexPagerControls,
  syncDiffPagesOnlyUI,
  buildDiffPageIndices,
  initHexPager,
} from './hexPager.js';
import {
  loadAiSettings,
  saveAiSettings,
  clearAiSettings,
  isAiConfigured,
  getProviderConfig,
} from './aiSettings.js';
import {
  buildAnalysisPayload,
  requestAiAnalysis,
  renderMarkdownLite,
} from './aiSuggest.js';
import {
  applyDecodedByteEdit,
  parseByteHex,
  countRawDiff,
  isOffsetEdited,
  downloadBuffer,
  buildEditedFilename,
  cloneBuffer,
  revertRawBuffer,
  applyDiffRangeAToB,
  applyDiffRangeBToA,
  applyDiffRegionAToB,
  applyDiffRegionBToA,
} from './fileEdit.js';
import {
  showToast,
  updateWorkflowSteps,
  updateTabBadges,
  setEmptyState,
  renderSimilarityBar,
  highlightRegionRow,
  setSidebarOpen,
  initSidebarToggle,
  initCollapsiblePanels,
  saveActiveTab,
  restoreActiveTab,
  initKeyboardShortcuts,
  on,
  setCompareLoading,
} from './ui.js';
import { assetUrl } from './config.js';
import {
  loadMappackFile,
  resolveMappackAddresses,
  saveMappackToStorage,
  loadMappackFromStorage,
  clearMappackStorage,
  renderMappackInfo,
  renderMapsTable,
  findMapsForRegion,
  findMapsAtOffset,
  formatMapShort,
} from './mappack.js';

const state = {
  rawA: null,
  rawB: null,
  decodedA: null,
  decodedB: null,
  metaA: null,
  metaB: null,
  diffResult: null,
  regions: [],
  diffRows: [],
  diffPages: [],
  selectedRegion: null,
  hexOffset: 0,
  hexScrollLock: false,
  aiSettings: loadAiSettings(),
  aiLoading: false,
  baseRawA: null,
  baseRawB: null,
  hexEditTarget: null,
  hexSelection: null,
  mappack: null,
  comparing: false,
  stringsReadyA: false,
  stringsReadyB: false,
  hexPage: 0,
  regionsPage: 0,
};

const HEX_ROW_HEIGHT = 20;
const REGIONS_PAGE_SIZE = 100;
const LARGE_FILE = 512 * 1024;
const REGION_BATCH = 200;
const $ = (sel) => document.querySelector(sel);

function activateTab(tabId) {
  const tab = document.querySelector(`.tab[data-tab="${tabId}"]`);
  if (!tab) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  tab.classList.add('active');
  const panel = $(`#tab-${tabId}`);
  panel?.classList.add('active');
  saveActiveTab(tabId);
  if (tabId === 'hex') requestAnimationFrame(() => renderHex());
  else if (tabId === 'strings') ensureStringsRendered();
  else if (tabId === 'sections') ensureSectionsRendered();
  else if (tabId === 'heatmap' && state.diffResult) requestAnimationFrame(renderHeatmap);
  setSidebarOpen(false);
}

function updateFileActions() {
  const hasAny = !!(state.rawA || state.rawB);
  const hasBoth = !!(state.rawA && state.rawB);
  $('#btnSwap').disabled = !hasBoth;
  $('#btnClear').disabled = !hasAny;
  setEmptyState(!hasAny);
  updateWorkflowSteps(hasBoth ? 3 : hasAny ? 2 : 1);
}

function clearFiles() {
  state.rawA = state.rawB = null;
  state.baseRawA = state.baseRawB = null;
  state.decodedA = state.decodedB = null;
  state.metaA = state.metaB = null;
  state.diffResult = null;
  state.regions = [];
  state.diffRows = [];
  state.diffPages = [];
  state.selectedRegion = null;
  state.stringsReadyA = false;
  state.stringsReadyB = false;
  state.hexPage = 0;
  state.regionsPage = 0;
  state.comparing = false;
  setCompareLoading(false);

  ['A', 'B'].forEach((slot) => {
    $(`#info${slot}`).innerHTML = 'Nenhum arquivo';
    $(`#info${slot}`).classList.add('muted');
    $(`#meta${slot}`).innerHTML = `<h3>${slot === 'A' ? 'Original (A)' : 'Modificado (B)'}</h3><p class="muted">Carregue um arquivo</p>`;
    $(`#strings${slot}`).textContent = '';
    $(`#sections${slot}`).innerHTML = '';
    $(`#drop${slot}`).classList.remove('dropzone--loaded');
    $(`#file${slot}`).value = '';
  });

  $('#summaryPanel').hidden = true;
  $('#btnExport').disabled = true;
  $('#regionsBody').innerHTML = '<tr><td colspan="8" class="muted center">Nenhuma região</td></tr>';
  $('#hexContentA').innerHTML = '';
  $('#hexContentB').innerHTML = '';
  $('#wordDiffDetail').hidden = true;
  updateEditStatus();
  updateTabBadges(0, 0);
  updateFileActions();
  updateAiButtons();
  showToast('Arquivos removidos', 'info');
}

function swapFiles() {
  if (!state.rawA || !state.rawB) return;
  const tmp = {
    raw: state.rawA, base: state.baseRawA, decoded: state.decodedA, meta: state.metaA,
    info: $('#infoA').innerHTML, drop: $('#dropA').classList.contains('dropzone--loaded'),
  };
  state.rawA = state.rawB;
  state.baseRawA = state.baseRawB;
  state.decodedA = state.decodedB;
  state.metaA = state.metaB;
  state.rawB = tmp.raw;
  state.baseRawB = tmp.base;
  state.decodedB = tmp.decoded;
  state.metaB = tmp.meta;

  $('#infoA').innerHTML = $('#infoB').innerHTML;
  $('#metaA').innerHTML = `<h3>Original (A)</h3>${renderMetadata(state.metaA)}`;
  $('#stringsA').textContent = formatStrings(state.rawA);
  $('#sectionsA').innerHTML = renderSections(state.metaA.sections);
  $('#dropA').classList.toggle('dropzone--loaded', $('#dropB').classList.contains('dropzone--loaded'));

  $('#infoB').innerHTML = tmp.info;
  $('#metaB').innerHTML = `<h3>Modificado (B)</h3>${renderMetadata(state.metaB)}`;
  $('#stringsB').textContent = formatStrings(state.rawB);
  $('#sectionsB').innerHTML = renderSections(state.metaB.sections);
  $('#dropB').classList.toggle('dropzone--loaded', tmp.drop);

  runCompare(true);
  showToast('Arquivos A e B trocados', 'success');
}

function setFileInfo(el, name, size) {
  el.innerHTML = `<strong>${escapeHtml(name)}</strong><br>${(size / 1024 / 1024).toFixed(2)} MB`;
  el.classList.remove('muted');
}

async function loadFile(file, slot) {
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  await assignBuffer(slot, buf, file.name);
}

async function assignBuffer(slot, buffer, name) {
  const meta = parseMetadata(buffer, name);
  scheduleMetadataEnrichment(slot, buffer, meta);

  if (slot === 'A') {
    state.rawA = buffer;
    state.baseRawA = null;
    state.metaA = meta;
    state.stringsReadyA = buffer.length <= LARGE_FILE;
    setFileInfo($('#infoA'), name, buffer.length);
    $('#metaA').innerHTML = `<h3>Original (A)</h3>${renderMetadata(meta)}`;
    if (state.stringsReadyA) $('#stringsA').textContent = formatStrings(buffer);
    else $('#stringsA').textContent = 'Abra a aba Strings para carregar.';
    $('#sectionsA').innerHTML = meta.sections.length
      ? renderSections(meta.sections)
      : '<p class="muted">Análise de seções em segundo plano…</p>';
    $('#dropA').classList.add('dropzone--loaded');
  } else {
    state.rawB = buffer;
    state.baseRawB = null;
    state.metaB = meta;
    state.stringsReadyB = buffer.length <= LARGE_FILE;
    setFileInfo($('#infoB'), name, buffer.length);
    $('#metaB').innerHTML = `<h3>Modificado (B)</h3>${renderMetadata(meta)}`;
    if (state.stringsReadyB) $('#stringsB').textContent = formatStrings(buffer);
    else $('#stringsB').textContent = 'Abra a aba Strings para carregar.';
    $('#sectionsB').innerHTML = meta.sections.length
      ? renderSections(meta.sections)
      : '<p class="muted">Análise de seções em segundo plano…</p>';
    $('#dropB').classList.add('dropzone--loaded');
  }

  updateDecode();
  updateFileActions();
  refreshMappackResolution();

  if (state.rawA && state.rawB) {
    await runCompare();
  } else {
    showToast(`Arquivo ${slot} carregado`, 'success');
  }
}

function scheduleMetadataEnrichment(slot, buffer, meta) {
  const run = async () => {
    enrichMetadata(meta, buffer);
    const sectionsEl = $(`#sections${slot}`);
    if (sectionsEl && meta.sections.length) {
      sectionsEl.innerHTML = renderSections(meta.sections);
    }
    meta.md5 = await md5Hex(buffer);
    const metaEl = slot === 'A' ? $('#metaA') : $('#metaB');
    const m = slot === 'A' ? state.metaA : state.metaB;
    if (metaEl && m) {
      metaEl.innerHTML = `<h3>${slot === 'A' ? 'Original (A)' : 'Modificado (B)'}</h3>${renderMetadata(m)}`;
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => { run(); }, { timeout: 2500 });
  else setTimeout(run, 50);
}

function ensureStringsRendered() {
  if (state.rawA && !state.stringsReadyA) {
    $('#stringsA').textContent = formatStrings(state.rawA);
    state.stringsReadyA = true;
  }
  if (state.rawB && !state.stringsReadyB) {
    $('#stringsB').textContent = formatStrings(state.rawB);
    state.stringsReadyB = true;
  }
}

function ensureSectionsRendered() {
  if (state.metaA && !state.metaA._enriched && state.rawA) {
    enrichMetadata(state.metaA, state.rawA);
    $('#sectionsA').innerHTML = renderSections(state.metaA.sections);
  }
  if (state.metaB && !state.metaB._enriched && state.rawB) {
    enrichMetadata(state.metaB, state.rawB);
    $('#sectionsB').innerHTML = renderSections(state.metaB.sections);
  }
}

function getDecodeMode() {
  return $('#decodeMode').value;
}

function getXorKey() {
  return $('#xorKey').value;
}

function updateDecode() {
  const mode = getDecodeMode();
  if (state.rawA) state.decodedA = decodeBuffer(state.rawA, mode, getXorKey());
  if (state.rawB) state.decodedB = decodeBuffer(state.rawB, mode, getXorKey());
  if (state.diffResult && !state.comparing) runCompare(true);
}

async function yieldToMain() {
  await new Promise((r) => setTimeout(r, 0));
}

async function runCompare(silent = false) {
  if (!state.decodedA || !state.decodedB || state.comparing) return;

  const savedHexOffset = state.hexOffset;
  const savedRegionsPage = state.regionsPage;

  state.comparing = true;
  if (!silent) setCompareLoading(true, 'Comparando arquivos…');
  await new Promise((r) => requestAnimationFrame(r));

  try {
    const scanned = await scanDiffAsync(state.decodedA, state.decodedB, (pct) => {
      if (!silent) {
        setCompareLoading(true, `Comparando… ${Math.round(pct * 100)}%`);
      }
    });
    state.diffResult = scanned;

    const rawRegions = scanned.regions;
    state.regions = rawRegions.map((r) =>
      analyzeRegionLight(r, state.metaA?.sections || [])
    );

    if (scanned.regionsTruncated) {
      showToast('Muitas diferenças — regiões agrupadas para performance', 'info', 4500);
    }

    // Só sugere o filtro na comparação inicial — não reativa ao editar/recomparar
    if (!silent && state.decodedA.length > LARGE_FILE) {
      const hideEq = $('#hexHideEqual');
      if (hideEq) hideEq.checked = true;
    }

    if (!silent) {
      state.hexPage = 0;
      state.regionsPage = 0;
    }

    rebuildDiffRows();
    renderSummary();
    renderRegionsTable();
    updateAiButtons();
    updateTabBadges(state.regions.length, getDiffCount(state.diffResult));
    $('#btnExport').disabled = false;
    $('#summaryPanel').hidden = false;
    updateEditStatus();

    const total = getDiffCount(state.diffResult);
    const sim = (1 - total / Math.min(state.diffResult.lenA, state.diffResult.lenB)) * 100;
    renderSimilarityBar(sim);
    updateWorkflowSteps(3);

    if (silent) {
      state.regionsPage = Math.min(
        savedRegionsPage,
        Math.max(0, Math.ceil(getFilteredRegions().length / REGIONS_PAGE_SIZE) - 1)
      );
      const opts = getHexViewOptions();
      state.hexPage = offsetToHexPage(savedHexOffset, state, opts);
      const view = computeHexView(state, opts);
      if (view.totalPages > 0) {
        state.hexPage = Math.min(state.hexPage, view.totalPages - 1);
      }
      state.hexOffset = savedHexOffset;
    }

    await yieldToMain();
    renderHex();
    updateApplyButtons();

    if (!silent) {
      if (total > 0) {
        activateTab('hex');
        showToast(`${state.regions.length} regiões · ${total.toLocaleString('pt-BR')} bytes diferentes`, 'success');
      } else {
        activateTab('metadata');
        showToast('Arquivos idênticos', 'info');
      }
    }
  } finally {
    state.comparing = false;
    setCompareLoading(false);
  }
}

function renderSummary() {
  const { sizeMismatch, lenA, lenB } = state.diffResult;
  const total = getDiffCount(state.diffResult);
  const sim = (1 - total / Math.min(lenA, lenB)) * 100;
  const swMatch = state.metaA.swVersion === state.metaB.swVersion;

  $('#diffStats').innerHTML = `
    <dt>Bytes diferentes</dt><dd>${total.toLocaleString('pt-BR')}</dd>
    <dt>Regiões</dt><dd>${state.regions.length}</dd>
    <dt>Similaridade</dt><dd>${sim.toFixed(4)}%</dd>
    <dt>Tamanhos</dt><dd>A=${lenA} / B=${lenB}${sizeMismatch ? ' ⚠ diferentes' : ''}</dd>
    <dt>SW compatível</dt><dd>${swMatch ? 'Sim (' + state.metaA.swVersion + ')' : 'Não — A=' + state.metaA.swVersion + ', B=' + state.metaB.swVersion}</dd>
  `;
}

function getFilteredRegions() {
  const filter = $('#regionFilter')?.value.trim().toLowerCase() || '';
  const onlyCal = $('#onlyCalibration')?.checked;
  return state.regions.filter((r) => {
    if (onlyCal && r.type !== 'calibration') return false;
    if (filter) {
      const hex = r.start.toString(16);
      if (!hex.includes(filter.replace('0x', ''))) return false;
    }
    return true;
  });
}

function renderRegionsPager(totalPages, totalRows) {
  const pager = $('#regionsPager');
  const label = $('#regionsPagerLabel');
  if (!pager) return;

  if (totalPages <= 1) {
    pager.hidden = true;
    return;
  }

  pager.hidden = false;
  const page = state.regionsPage + 1;
  if (label) {
    label.textContent = `Página ${page} / ${totalPages} · ${totalRows.toLocaleString('pt-BR')} regiões`;
  }

  pager.querySelectorAll('[data-reg-page]').forEach((btn) => {
    btn.disabled = false;
  });
  const atStart = state.regionsPage <= 0;
  const atEnd = state.regionsPage >= totalPages - 1;
  pager.querySelector('[data-reg-page="first"]')?.toggleAttribute('disabled', atStart);
  pager.querySelector('[data-reg-page="prev"]')?.toggleAttribute('disabled', atStart);
  pager.querySelector('[data-reg-page="next"]')?.toggleAttribute('disabled', atEnd);
  pager.querySelector('[data-reg-page="last"]')?.toggleAttribute('disabled', atEnd);

  if (pager.dataset.bound) return;
  pager.dataset.bound = '1';
  pager.querySelectorAll('[data-reg-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.regPage;
      const pages = Math.ceil(getFilteredRegions().length / REGIONS_PAGE_SIZE);
      if (action === 'first') state.regionsPage = 0;
      else if (action === 'prev') state.regionsPage = Math.max(0, state.regionsPage - 1);
      else if (action === 'next') state.regionsPage = Math.min(pages - 1, state.regionsPage + 1);
      else if (action === 'last') state.regionsPage = pages - 1;
      renderRegionsTable();
    });
  });
}

function renderRegionsTable() {
  const tbody = $('#regionsBody');
  const filtered = getFilteredRegions();
  state.regionsPage = Math.min(state.regionsPage, Math.max(0, Math.ceil(filtered.length / REGIONS_PAGE_SIZE) - 1));

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted center">Nenhuma região encontrada</td></tr>';
    renderRegionsPager(0, 0);
    return;
  }

  const totalPages = Math.ceil(filtered.length / REGIONS_PAGE_SIZE);
  const start = state.regionsPage * REGIONS_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + REGIONS_PAGE_SIZE);

  tbody.innerHTML = pageRows
    .map((r, idx) => {
      const globalIdx = state.regions.indexOf(r);
      const tagClass =
        r.type === 'calibration' ? 'cal' : r.type === 'text' ? 'text' : r.type === 'empty' ? 'empty' : r.type === 'entropy' ? 'entropy' : 'code';
      const maps = state.mappack ? findMapsForRegion(state.mappack, r.start, r.end) : [];
      const mapCell = maps.length
        ? maps.slice(0, 2).map((m) => `<span class="tag tag--cal" title="${escapeHtml(m.description || '')}">${escapeHtml(m.name)}</span>`).join(' ')
            + (maps.length > 2 ? ` <span class="muted">+${maps.length - 2}</span>` : '')
        : '<span class="muted">—</span>';
      const deltaCell = r._light
        ? '<span class="muted">…</span>'
        : `${r.avgDelta.toFixed(1)}${r.uniformDelta ? ' ∆' : ''}`;
      return `<tr data-region="${globalIdx}">
        <td>${start + idx + 1}</td>
        <td class="mono">0x${r.start.toString(16).toUpperCase()}</td>
        <td class="mono">${r.length} B</td>
        <td><span class="tag tag--${tagClass}">${r.type}</span></td>
        <td>${r.length}</td>
        <td class="mono">${deltaCell}</td>
        <td class="map-cell">${mapCell}</td>
        <td class="actions actions--wide">
          <button type="button" class="btn btn--sm jump-region">Hex</button>
          <button type="button" class="btn btn--sm btn--ghost apply-a2b" title="Desfazer: A→B">↩A→B</button>
          <button type="button" class="btn btn--sm btn--ghost apply-b2a" title="Aplicar B→A">B→A</button>
          <button type="button" class="btn btn--sm btn--ghost jump-ai" ${isAiConfigured(state.aiSettings) ? '' : 'title="Configure a IA primeiro"'}>IA</button>
        </td>
      </tr>`;
    })
    .join('');

  renderRegionsPager(totalPages, filtered.length);

  tbody.querySelectorAll('.jump-region').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      jumpToRegion(state.regions[Number(row.dataset.region)]);
    });
  });

  tbody.querySelectorAll('.apply-a2b').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      applyRegionAToB(state.regions[Number(row.dataset.region)]);
    });
  });

  tbody.querySelectorAll('.apply-b2a').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      applyRegionBToA(state.regions[Number(row.dataset.region)]);
    });
  });

  tbody.querySelectorAll('.jump-ai').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      const region = state.regions[Number(row.dataset.region)];
      jumpToRegion(region);
      if (isAiConfigured(state.aiSettings)) runAiAnalysis(true);
      else openSettingsDialog();
    });
  });
}

function ensureRegionAnalyzed(region) {
  if (!region?._light) return region;
  const full = analyzeRegion(region, state.decodedA, state.decodedB, state.metaA?.sections || []);
  const idx = state.regions.indexOf(region);
  if (idx >= 0) state.regions[idx] = full;
  if (state.selectedRegion === region) state.selectedRegion = full;
  return full;
}

function jumpToRegion(region) {
  state.selectedRegion = region;
  state.hexOffset = region.start & ~0xf;
  const idx = state.regions.indexOf(region);
  activateTab('hex');
  scrollHexToOffset(state.hexOffset);
  renderRegionDetail(region);
  highlightRegionRow(idx);
  updateAiButtons();
}

function renderRegionDetail(region) {
  const panel = $('#wordDiffDetail');
  const pre = $('#wordDiffPre');
  if (!region || !panel) {
    if (panel) panel.hidden = true;
    return;
  }
  panel.hidden = false;
  updateApplyButtons();

  const full = ensureRegionAnalyzed(region);
  const header = `Região 0x${region.start.toString(16).toUpperCase()}–0x${region.end.toString(16).toUpperCase()} (${region.length} bytes)\n`;

  if (full.wordChanges?.length) {
    const lines = full.wordChanges.map(
      (w) =>
        `0x${w.offset.toString(16).toUpperCase()}: ${w.a} (0x${w.a.toString(16).toUpperCase()}) → ${w.b} (0x${w.b.toString(16).toUpperCase()})  Δ=${w.delta >= 0 ? '+' : ''}${w.delta}`
    );
    pre.textContent = header + '\n' + lines.join('\n');
  } else {
    pre.textContent = `${header}\n↩ A→B restaura o original nesta região.\nB→A aplica a versão modificada em A.`;
  }
}

function getPageDiffByteRange(view) {
  if (view.isEmpty || view.rowCount === 0 || !state.decodedA) return null;
  const { startRow, endRow, hideEqual, cols } = view;
  let startA;
  let endA;
  if (hideEqual) {
    startA = state.diffRows[startRow];
    const lastRow = Math.max(startRow, endRow - 1);
    endA = (state.diffRows[lastRow] ?? startA) + cols - 1;
  } else {
    startA = startRow * cols;
    endA = endRow * cols - 1;
  }
  if (startA == null || startA < 0) return null;
  endA = Math.min(endA, state.decodedA.length - 1);
  return { startA, endA };
}

function ensureEditSnapshot(side) {
  if (side === 'A' && state.rawA && !state.baseRawA) state.baseRawA = cloneBuffer(state.rawA);
  if (side === 'B' && state.rawB && !state.baseRawB) state.baseRawB = cloneBuffer(state.rawB);
}

function finishApply(count, label) {
  if (count <= 0) {
    showToast('Nenhum byte diferente neste alcance', 'info');
    return 0;
  }
  updateDecode();
  updateEditStatus();
  updateApplyButtons();
  if (state.selectedRegion) renderRegionDetail(state.selectedRegion);
  showToast(`${count.toLocaleString('pt-BR')} byte(s): ${label}`, 'success');
  return count;
}

function applyPageAToB() {
  const range = getPageDiffByteRange(getHexView());
  if (!range) return;
  ensureEditSnapshot('B');
  const n = applyDiffRangeAToB(
    range.startA, range.endA, state.decodedA, state.decodedB, state.rawB,
    getHexAlignB(), getDecodeMode(), getXorKey()
  );
  finishApply(n, 'original A→B (página)');
}

function applyPageBToA() {
  const range = getPageDiffByteRange(getHexView());
  if (!range) return;
  ensureEditSnapshot('A');
  const n = applyDiffRangeBToA(
    range.startA, range.endA, state.decodedA, state.decodedB, state.rawA,
    getHexAlignB(), getDecodeMode(), getXorKey()
  );
  finishApply(n, 'modificado B→A (página)');
}

function applyRegionAToB(region) {
  if (!region) return;
  ensureEditSnapshot('B');
  const n = applyDiffRegionAToB(
    region, state.decodedA, state.decodedB, state.rawB,
    getHexAlignB(), getDecodeMode(), getXorKey()
  );
  finishApply(n, `A→B 0x${region.start.toString(16).toUpperCase()}`);
}

function applyRegionBToA(region) {
  if (!region) return;
  ensureEditSnapshot('A');
  const n = applyDiffRegionBToA(
    region, state.decodedA, state.decodedB, state.rawA,
    getHexAlignB(), getDecodeMode(), getXorKey()
  );
  finishApply(n, `B→A 0x${region.start.toString(16).toUpperCase()}`);
}

function applyAllDiffsAToB() {
  if (!state.regions.length) return;
  ensureEditSnapshot('B');
  let total = 0;
  for (const r of state.regions) {
    total += applyDiffRegionAToB(
      r, state.decodedA, state.decodedB, state.rawB,
      getHexAlignB(), getDecodeMode(), getXorKey()
    );
  }
  finishApply(total, 'original A→B (tudo)');
}

function updateApplyButtons() {
  const hasDiff = getDiffCount(state.diffResult) > 0;
  const can = hasDiff && state.rawA && state.rawB && !state.comparing;
  ['btnApplyPageAtoB', 'btnApplyPageBtoA', 'btnApplyAllAtoB', 'btnApplyRegionAtoB', 'btnApplyRegionBtoA'].forEach((id) => {
    const el = $(`#${id}`);
    if (el) el.disabled = !can;
  });
}

function updateHexMapLabels(offsetA, offsetB) {
  const labelA = $('#hexMapLabelA');
  const labelB = $('#hexMapLabelB');
  if (!state.mappack) {
    if (labelA) labelA.textContent = '';
    if (labelB) labelB.textContent = '';
    return;
  }
  const mapsA = findMapsAtOffset(state.mappack, offsetA);
  const mapsB = findMapsAtOffset(state.mappack, offsetB);
  if (labelA) labelA.textContent = mapsA[0] ? formatMapShort(mapsA[0]) : '';
  if (labelB) labelB.textContent = mapsB[0] ? formatMapShort(mapsB[0]) : '';
}

function renderMappackUI() {
  const info = $('#mappackInfo');
  const wrap = $('#mappackTableWrap');
  if (!state.mappack) {
    if (info) {
      info.innerHTML = 'Nenhum mappack';
      info.classList.add('muted');
    }
    if (wrap) wrap.innerHTML = '<p class="muted center" style="padding:1rem">Carregue um mappack .json</p>';
    $('#btnClearMappack').disabled = true;
    $('#dropMappack')?.classList.remove('dropzone--loaded');
    return;
  }
  if (info) {
    info.innerHTML = renderMappackInfo(state.mappack);
    info.classList.remove('muted');
  }
  if (wrap) {
    wrap.innerHTML = renderMapsTable(state.mappack, $('#mappackFilter')?.value || '');
    wrap.querySelectorAll('.jump-map').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        const start = Number(row.dataset.mapStart);
        if (start >= 0) {
          activateTab('hex');
          scrollHexToOffset(start);
        }
      });
    });
  }
  $('#btnClearMappack').disabled = false;
  $('#dropMappack')?.classList.add('dropzone--loaded');
}

function refreshMappackResolution() {
  if (!state.mappack) return;
  const ref = state.rawA || state.rawB;
  if (ref) state.mappack = resolveMappackAddresses(state.mappack, ref);
  renderMappackUI();
  if (state.regions.length) renderRegionsTable();
}

async function assignMappack(mappack, label) {
  state.mappack = mappack;
  saveMappackToStorage(mappack);
  refreshMappackResolution();
  showToast(`Mappack: ${label || mappack.name}`, 'success');
}

function initMappack() {
  const zone = $('#dropMappack');
  const input = $('#fileMappack');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const mp = await loadMappackFile(file);
      await assignMappack(mp, file.name);
    } catch (err) {
      showToast(err.message || 'Erro ao carregar mappack', 'error');
    }
  });

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dropzone--hover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dropzone--hover'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('dropzone--hover');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      const mp = await loadMappackFile(file);
      await assignMappack(mp, file.name);
    } catch (err) {
      showToast(err.message || 'Erro ao carregar mappack', 'error');
    }
  });

  $('#btnClearMappack')?.addEventListener('click', () => {
    state.mappack = null;
    clearMappackStorage();
    renderMappackUI();
    renderRegionsTable();
    updateHexMapLabels(0, 0);
    showToast('Mappack removido', 'info');
  });

  $('#mappackFilter')?.addEventListener('input', renderMappackUI);

  $('#btnLoadExampleMappack')?.addEventListener('click', async () => {
    try {
      const res = await fetch(assetUrl('mappacks/example-med17.json'));
      if (!res.ok) throw new Error('Não foi possível carregar o exemplo');
      const mp = await loadMappackFile(new File([await res.blob()], 'example-med17.json'));
      await assignMappack(mp, 'Exemplo MED17');
    } catch (err) {
      showToast(err.message || 'Erro ao carregar exemplo', 'error');
    }
  });

  const saved = loadMappackFromStorage();
  if (saved) {
    state.mappack = saved;
    refreshMappackResolution();
  } else {
    renderMappackUI();
  }
}

function parseHexInput(value) {
  const v = value.trim().replace(/^0x/i, '');
  return Math.max(0, parseInt(v, 16) || parseInt(v, 10) || 0);
}

function getHexAlignB() {
  return parseHexInput($('#hexAlignB')?.value || '0');
}

function getHexCols() {
  return Number($('#hexCols').value);
}

function hexOptionsForSide(side) {
  const editable = side === 'a' ? !!$('#hexEditA')?.checked : !!$('#hexEditB')?.checked;
  return {
    editable,
    isEdited: (offset) => {
      if (side === 'a') return isOffsetEdited(state.baseRawA, state.rawA, offset);
      return isOffsetEdited(state.baseRawB, state.rawB, offset);
    },
  };
}

function getTotalEditCount() {
  return countRawDiff(state.baseRawA, state.rawA) + countRawDiff(state.baseRawB, state.rawB);
}

function updateEditStatus() {
  const n = getTotalEditCount();
  const el = $('#editStatus');
  if (el) el.textContent = n ? `${n} byte${n !== 1 ? 's' : ''} editado${n !== 1 ? 's' : ''}` : '';
  const has = n > 0;
  $('#btnRevertEdits').disabled = !has;
  $('#btnDownloadEdited').disabled = !has;
}

function commitByteEdit(side, offset, decodedByte) {
  const raw = side === 'A' ? state.rawA : side === 'B' ? state.rawB : null;
  if (!raw) return false;
  if (side === 'A' && !state.baseRawA) state.baseRawA = cloneBuffer(state.rawA);
  if (side === 'B' && !state.baseRawB) state.baseRawB = cloneBuffer(state.rawB);
  if (!applyDecodedByteEdit(raw, offset, decodedByte, getDecodeMode(), getXorKey())) return false;
  updateDecode();
  if (!(state.rawA && state.rawB)) {
    renderHex();
    updateEditStatus();
  }
  updateApplyButtons();
  return true;
}

function commitBulkByteEdit(side, offsets, decodedByte) {
  const sideU = side.toUpperCase();
  const raw = sideU === 'A' ? state.rawA : sideU === 'B' ? state.rawB : null;
  const decoded = sideU === 'A' ? state.decodedA : state.decodedB;
  if (!raw || !decoded || !offsets?.length) return 0;
  if (sideU === 'A' && !state.baseRawA) state.baseRawA = cloneBuffer(state.rawA);
  if (sideU === 'B' && !state.baseRawB) state.baseRawB = cloneBuffer(state.rawB);

  const mode = getDecodeMode();
  const xorKey = getXorKey();
  let count = 0;
  for (const offset of offsets) {
    if (offset < 0 || offset >= decoded.length) continue;
    if (decoded[offset] === decodedByte) continue;
    if (applyDecodedByteEdit(raw, offset, decodedByte, mode, xorKey)) count++;
  }
  if (count <= 0) return 0;

  updateDecode();
  if (!(state.rawA && state.rawB)) {
    renderHex();
    updateEditStatus();
  }
  updateApplyButtons();
  return count;
}

function clearHexSelection() {
  state.hexSelection = null;
  document.querySelectorAll('.hex-byte--selected').forEach((el) => el.classList.remove('hex-byte--selected'));
  const bulk = $('#hexBulkEdit');
  if (bulk) bulk.hidden = true;
  const bulkInput = $('#hexBulkInput');
  if (bulkInput) bulkInput.value = '';
}

function updateHexSelectionHighlight() {
  document.querySelectorAll('.hex-byte--selected').forEach((el) => el.classList.remove('hex-byte--selected'));
  const sel = state.hexSelection;
  if (!sel?.offsets?.length) return;
  for (const off of sel.offsets) {
    document.querySelector(`.hex-byte[data-side="${sel.side}"][data-offset="${off}"]`)?.classList.add('hex-byte--selected');
  }
}

function updateHexBulkUI() {
  const sel = state.hexSelection;
  const bulk = $('#hexBulkEdit');
  const countEl = $('#hexBulkCount');
  if (!bulk || !countEl) return;

  const n = sel?.offsets?.length ?? 0;
  if (n <= 0) {
    bulk.hidden = true;
    return;
  }

  bulk.hidden = false;
  const sideLabel = sel.side === 'a' ? 'A' : 'B';
  countEl.textContent = `${n} byte${n !== 1 ? 's' : ''} · painel ${sideLabel}`;
}

function toggleHexByteSelection(side, offset) {
  let sel = state.hexSelection;
  if (!sel || sel.side !== side) {
    state.hexSelection = { side, offsets: [offset], anchor: offset };
  } else {
    const idx = sel.offsets.indexOf(offset);
    if (idx >= 0) sel.offsets.splice(idx, 1);
    else {
      sel.offsets.push(offset);
      sel.offsets.sort((a, b) => a - b);
    }
    sel.anchor = offset;
    if (!sel.offsets.length) {
      clearHexSelection();
      return;
    }
  }
  updateHexSelectionHighlight();
  updateHexBulkUI();
}

function rangeHexByteSelection(side, anchor, offset) {
  const lo = Math.min(anchor, offset);
  const hi = Math.max(anchor, offset);
  const offsets = [];
  for (let o = lo; o <= hi; o++) offsets.push(o);
  state.hexSelection = { side, offsets, anchor };
  updateHexSelectionHighlight();
  updateHexBulkUI();
}

function submitHexBulkEdit() {
  const sel = state.hexSelection;
  if (!sel?.offsets?.length) return;
  const val = parseByteHex($('#hexBulkInput')?.value || '');
  if (val === null) {
    showToast('Valor hex inválido (00–FF)', 'error');
    return;
  }
  const side = sel.side === 'a' ? 'A' : 'B';
  const n = commitBulkByteEdit(side, sel.offsets, val);
  if (n <= 0) {
    showToast('Nenhum byte alterado (já tinham esse valor)', 'info');
    return;
  }
  showToast(
    `${n.toLocaleString('pt-BR')} byte(s) → ${val.toString(16).toUpperCase().padStart(2, '0')}`,
    'success'
  );
  clearHexSelection();
}

function copyByteAtoB(offsetA) {
  if (!state.decodedA || !state.rawB) return;
  const offsetB = offsetA + getHexAlignB();
  if (offsetB < 0 || offsetB >= state.decodedB.length) {
    showToast('Fora do alcance do arquivo B', 'error');
    return;
  }
  if (state.decodedA[offsetA] === state.decodedB[offsetB]) return;
  const val = state.decodedA[offsetA];
  if (commitByteEdit('B', offsetB, val)) {
    showToast(`A→B em 0x${offsetB.toString(16).toUpperCase()}`, 'success');
  }
}

function copyByteBtoA(offsetB) {
  if (!state.decodedB || !state.rawA) return;
  const offsetA = offsetB - getHexAlignB();
  if (offsetA < 0 || offsetA >= state.decodedA.length) {
    showToast('Fora do alcance do arquivo A', 'error');
    return;
  }
  if (state.decodedA[offsetA] === state.decodedB[offsetB]) return;
  const val = state.decodedB[offsetB];
  if (commitByteEdit('A', offsetA, val)) {
    showToast(`B→A em 0x${offsetA.toString(16).toUpperCase()}`, 'success');
  }
}

function revertAllEdits() {
  if (state.rawA && state.baseRawA) revertRawBuffer(state.rawA, state.baseRawA);
  if (state.rawB && state.baseRawB) revertRawBuffer(state.rawB, state.baseRawB);
  closeHexEditor();
  clearHexSelection();
  updateDecode();
  if (state.rawA && state.rawB) runCompare(true);
  else renderHex();
  updateEditStatus();
  updateApplyButtons();
  showToast('Edições revertidas', 'info');
}

function downloadEditedFile() {
  const editsB = countRawDiff(state.baseRawB, state.rawB);
  const editsA = countRawDiff(state.baseRawA, state.rawA);
  if (editsB === 0 && editsA === 0) return;

  const useA = editsB === 0 && editsA > 0;
  const raw = useA ? state.rawA : state.rawB;
  const meta = useA ? state.metaA : state.metaB;
  const name = buildEditedFilename(meta?.fileName || `ecu_${useA ? 'A' : 'B'}.bin`);
  downloadBuffer(raw, name);
  showToast(`Download: ${name}`, 'success');
}

function closeHexEditor() {
  const editor = $('#hexEditor');
  editor?.setAttribute('hidden', '');
  document.querySelectorAll('.hex-byte--active').forEach((el) => el.classList.remove('hex-byte--active'));
  state.hexEditTarget = null;
}

function openHexEditor(byteEl, side, offset) {
  const editor = $('#hexEditor');
  const input = $('#hexEditorInput');
  if (!editor || !input) return;

  closeHexEditor();
  state.hexEditTarget = { side: side.toUpperCase(), offset, byteEl };
  byteEl.classList.add('hex-byte--active');

  const rect = byteEl.getBoundingClientRect();
  editor.style.left = `${Math.min(rect.left, window.innerWidth - 120)}px`;
  editor.style.top = `${rect.bottom + 6}px`;
  editor.removeAttribute('hidden');
  input.value = byteEl.textContent.trim();
  input.focus();
  input.select();
}

function submitHexEditor() {
  const target = state.hexEditTarget;
  if (!target) return;
  const val = parseByteHex($('#hexEditorInput').value);
  if (val === null) {
    showToast('Valor hex inválido (00–FF)', 'error');
    return;
  }
  const buffer = target.side === 'A' ? state.decodedA : state.decodedB;
  if (!buffer || target.offset >= buffer.length) return;

  if (buffer[target.offset] === val) {
    closeHexEditor();
    return;
  }

  if (commitByteEdit(target.side, target.offset, val)) {
    showToast(`0x${target.offset.toString(16).toUpperCase()} → ${val.toString(16).toUpperCase().padStart(2, '0')}`, 'success');
  }
  closeHexEditor();
}

function onHexPaneClick(e) {
  const byte = e.target.closest('.hex-byte[data-editable="1"]');
  if (!byte) {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) clearHexSelection();
    return;
  }
  e.preventDefault();
  const side = byte.dataset.side;
  const offset = Number(byte.dataset.offset);
  if (side === 'a' && !$('#hexEditA')?.checked) return;
  if (side === 'b' && !$('#hexEditB')?.checked) return;

  if (e.ctrlKey || e.metaKey) {
    closeHexEditor();
    toggleHexByteSelection(side, offset);
    $('#hexBulkInput')?.focus();
    return;
  }

  if (e.shiftKey && state.hexSelection?.side === side && state.hexSelection.anchor != null) {
    closeHexEditor();
    rangeHexByteSelection(side, state.hexSelection.anchor, offset);
    $('#hexBulkInput')?.focus();
    return;
  }

  clearHexSelection();
  openHexEditor(byte, side, offset);
}

function onHexPaneDblClick(e) {
  const byteA = e.target.closest('.hex-byte[data-side="a"]');
  if (byteA && state.rawB && $('#hexEditB')?.checked) {
    e.preventDefault();
    copyByteAtoB(Number(byteA.dataset.offset));
    return;
  }
  const byteB = e.target.closest('.hex-byte[data-side="b"]');
  if (byteB && state.rawA && $('#hexEditA')?.checked) {
    e.preventDefault();
    copyByteBtoA(Number(byteB.dataset.offset));
  }
}

function initHexEditor() {
  $('#hexScrollA')?.addEventListener('click', onHexPaneClick);
  $('#hexScrollB')?.addEventListener('click', onHexPaneClick);
  $('#hexScrollA')?.addEventListener('dblclick', onHexPaneDblClick);
  $('#hexScrollB')?.addEventListener('dblclick', onHexPaneDblClick);

  const input = $('#hexEditorInput');
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitHexEditor(); }
    if (e.key === 'Escape') { e.preventDefault(); closeHexEditor(); }
  });
  input?.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement !== input) closeHexEditor();
    }, 120);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.hexEditTarget) closeHexEditor();
      if (state.hexSelection) clearHexSelection();
    }
  });

  on('#hexBulkApply', 'click', submitHexBulkEdit);
  on('#hexBulkClear', 'click', clearHexSelection);
  const bulkInput = $('#hexBulkInput');
  bulkInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitHexBulkEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); clearHexSelection(); }
  });

  $('#btnRevertEdits')?.addEventListener('click', revertAllEdits);
  $('#btnDownloadEdited')?.addEventListener('click', downloadEditedFile);
  on('#btnApplyPageAtoB', 'click', applyPageAToB);
  on('#btnApplyPageBtoA', 'click', applyPageBToA);
  on('#btnApplyAllAtoB', 'click', applyAllDiffsAToB);
  on('#btnApplyRegionAtoB', 'click', () => applyRegionAToB(state.selectedRegion));
  on('#btnApplyRegionBtoA', 'click', () => applyRegionBToA(state.selectedRegion));
  $('#hexEditA')?.addEventListener('change', () => {
    if (!$('#hexEditA')?.checked && state.hexSelection?.side === 'a') clearHexSelection();
    renderHex();
  });
  $('#hexEditB')?.addEventListener('change', () => {
    if (!$('#hexEditB')?.checked && state.hexSelection?.side === 'b') clearHexSelection();
    renderHex();
  });
}

function isDiffByteA(offsetA) {
  if (!state.decodedA || !state.decodedB) return false;
  const offsetB = offsetA + getHexAlignB();
  if (offsetA >= state.decodedA.length) return false;
  if (offsetB < 0 || offsetB >= state.decodedB.length) return true;
  return state.decodedA[offsetA] !== state.decodedB[offsetB];
}

function isDiffByteB(offsetB) {
  if (!state.decodedA || !state.decodedB) return false;
  const offsetA = offsetB - getHexAlignB();
  if (offsetB >= state.decodedB.length) return false;
  if (offsetA < 0 || offsetA >= state.decodedA.length) return true;
  return state.decodedA[offsetA] !== state.decodedB[offsetB];
}

function rowHasDiffA(rowOffset, cols) {
  for (let i = 0; i < cols; i++) {
    if (isDiffByteA(rowOffset + i)) return true;
  }
  return false;
}

function rebuildDiffRows() {
  if (!state.decodedA || !state.regions.length) {
    state.diffRows = [];
    state.diffPages = [];
    return;
  }
  const cols = getHexCols();
  if (getHexAlignB() === 0) {
    state.diffRows = buildDiffRowsFromRegions(state.regions, cols);
  } else {
    refreshDiffRowsAligned();
  }
  state.diffPages = buildDiffPageIndices(state.regions, cols, state.decodedA.length);
}

function refreshDiffRowsAligned() {
  if (!state.decodedA || !state.decodedB) {
    state.diffRows = [];
    return;
  }
  const cols = getHexCols();
  const rows = [];
  const len = state.decodedA.length;
  for (let off = 0; off < len; off += cols) {
    if (rowHasDiffA(off, cols)) rows.push(off);
  }
  state.diffRows = rows;
}

function getHexViewOptions() {
  const hideEqual = !!$('#hexHideEqual')?.checked;
  return {
    cols: getHexCols(),
    hideEqual,
    diffPagesOnly: !hideEqual && !!$('#hexDiffPagesOnly')?.checked,
  };
}

function getHexView() {
  const view = computeHexView(state, getHexViewOptions());
  view._diffRows = state.diffRows;
  state.hexPage = view.page;
  return view;
}

function setHexPage(pageIndex) {
  state.hexPage = pageIndex;
  renderHex();
}


function renderHexPane(side, contentEl, view) {
  if (!state.decodedA || !state.decodedB || !contentEl) return;

  if (view.isEmpty || view.rowCount === 0) {
    contentEl.innerHTML = formatHexEmptyMessage(view.hideEqual, view.diffPagesOnly);
    return;
  }

  const alignB = getHexAlignB();
  const synced = $('#hexSyncScroll')?.checked;
  const { cols, startRow, endRow, hideEqual } = view;
  view._diffRows = state.diffRows;
  const lines = [];

  for (let row = startRow; row < endRow; row++) {
    const resolved = resolveHexRowOffset(view, row, { alignB, synced, side });
    if (!resolved) continue;
    const { offsetA, offsetB } = resolved;

    if (side === 'a') {
      if (offsetA < 0 || offsetA >= state.decodedA.length) {
        lines.push(`<div class="hex-line hex-line--pad"><span class="offset muted">------</span>  <span class="muted">— fora do arquivo —</span></div>`);
        continue;
      }
      lines.push(formatHexLine(state.decodedA, offsetA, cols, (byteOff) => isDiffByteA(byteOff), 'a', true, hexOptionsForSide('a')));
    } else {
      if (offsetB < 0) {
        lines.push(`<div class="hex-line hex-line--pad"><span class="offset muted">------</span>  <span class="muted">— alinhamento —</span></div>`);
        continue;
      }
      if (offsetB >= state.decodedB.length) break;
      lines.push(formatHexLine(state.decodedB, offsetB, cols, (byteOff) => isDiffByteB(byteOff), 'b', true, hexOptionsForSide('b')));
    }
  }

  contentEl.innerHTML = lines.join('');

  if (side === 'a') {
    const first = hideEqual ? (state.diffRows[startRow] ?? 0) : startRow * cols;
    const lastIdx = Math.max(startRow, endRow - 1);
    const last = hideEqual ? (state.diffRows[lastIdx] ?? first) : lastIdx * cols;
    const label = $('#hexLabelA');
    if (label) label.textContent = `0x${first.toString(16).toUpperCase()} – 0x${(last + cols).toString(16).toUpperCase()}`;
  } else {
    let first;
    let last;
    if (hideEqual) {
      first = (state.diffRows[startRow] ?? 0) + alignB;
      const lastIdx = Math.max(startRow, endRow - 1);
      last = (state.diffRows[lastIdx] ?? 0) + alignB;
    } else if (!synced) {
      first = startRow * cols;
      last = (endRow - 1) * cols;
    } else {
      first = startRow * cols + alignB;
      last = (endRow - 1) * cols + alignB;
    }
    const label = $('#hexLabelB');
    if (label) label.textContent = `0x${Math.max(0, first).toString(16).toUpperCase()} – 0x${(last + cols).toString(16).toUpperCase()}`;
  }
}

function renderHex() {
  if (!state.decodedA || !state.decodedB) return;

  const view = getHexView();
  const alignB = getHexAlignB();
  const range = getPageOffsetRange(view);

  renderHexPane('a', $('#hexContentA'), view);
  renderHexPane('b', $('#hexContentB'), view);
  updateEditStatus();

  syncDiffPagesOnlyUI(view.hideEqual);

  const meta = $('#hexPageMeta');
  if (meta) meta.textContent = formatHexPagerMeta(view, range, alignB);
  updateHexPagerControls(view);

  const firstOff = range.firstA;
  updateHexMapLabels(firstOff, firstOff + alignB);
  state.hexOffset = firstOff;
  const offsetEl = $('#hexOffset');
  if (offsetEl && document.activeElement !== offsetEl) {
    offsetEl.value = '0x' + firstOff.toString(16).toUpperCase();
  }
  updateHexSelectionHighlight();
  updateHexBulkUI();
}

function scrollHexToOffset(offset) {
  const opts = getHexViewOptions();
  state.hexPage = offsetToHexPage(offset, state, opts);
  state.hexOffset = offset;
  const offsetEl = $('#hexOffset');
  if (offsetEl) offsetEl.value = '0x' + offset.toString(16).toUpperCase();
  renderHex();
}

function jumpToDiff(direction) {
  if (!state.diffRows.length) return;
  const view = getHexView();
  const { startRow } = view;
  const cols = getHexCols();
  const hideEqual = view.hideEqual;
  const currentOffset = hideEqual
    ? state.diffRows[startRow] ?? state.diffRows[0]
    : startRow * cols;

  let idx = state.diffRows.findIndex((off) => off >= currentOffset);
  if (idx < 0) idx = state.diffRows.length - 1;

  if (direction < 0) {
    if (state.diffRows[idx] === currentOffset && idx > 0) idx -= 1;
    else if (idx > 0 && state.diffRows[idx] > currentOffset) idx -= 1;
  } else {
    if (state.diffRows[idx] === currentOffset && idx < state.diffRows.length - 1) idx += 1;
    else if (state.diffRows[idx] <= currentOffset && idx < state.diffRows.length - 1) idx += 1;
  }

  scrollHexToOffset(state.diffRows[idx]);
}

function renderHeatmap() {
  const canvas = $('#heatmap');
  if (!canvas || !state.diffResult) return;
  const ctx = canvas.getContext('2d');
  const { counts, bucketSize, buckets } = buildHeatmapBuckets(
    state.diffResult.heatmap,
    state.decodedA.length,
    4096
  );

  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#1e2230';
  ctx.fillRect(0, 0, w, h);

  const cols = 128;
  const cellW = w / cols;
  const cellH = h / Math.ceil(buckets / cols);

  let max = 1;
  for (const c of counts) if (c > max) max = c;

  for (let i = 0; i < buckets; i++) {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    const c = counts[i];
    ctx.fillStyle = c
      ? `rgb(${Math.floor(80 + Math.min(1, c / max) * 175)},${Math.floor(40 - Math.min(1, c / max) * 30)},${Math.floor(50 - Math.min(1, c / max) * 20)})`
      : '#252a38';
    ctx.fillRect(x, y, Math.ceil(cellW), Math.ceil(cellH));
  }

  $('#heatmapLegend').textContent = `Cada célula ≈ ${bucketSize / 1024} KB | ${buckets} blocos | máx ${max} bytes alterados/bloco`;
}

function formatStrings(buffer) {
  return extractStrings(buffer, 8)
    .filter((s) => /[A-Za-z]{3}/.test(s.text))
    .map((s) => `0x${s.offset.toString(16).toUpperCase().padStart(6, '0')}  ${s.text}`)
    .join('\n');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function exportJson() {
  const report = exportReport(state.metaA, state.metaB, state.regions, state.diffResult);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ecu-diff-${Date.now()}.json`;
  a.click();
}

function updateAiButtons() {
  const configured = isAiConfigured(state.aiSettings);
  const hasCompare = !!(state.diffResult && state.regions.length);
  const btn = $('#btnSettings');
  if (btn) btn.classList.toggle('ai-configured', configured);
  $('#btnAiAnalyze').disabled = !configured || !hasCompare || state.aiLoading;
  $('#btnAiRegion').disabled = !configured || !state.selectedRegion || state.aiLoading;
}

function openSettingsDialog() {
  const dlg = $('#settingsDialog');
  const s = state.aiSettings;
  $('#aiProvider').value = s.provider;
  $('#aiApiKey').value = s.apiKey;
  $('#aiBaseUrl').value = s.baseUrl || '';
  updateAiModelField();
  dlg.showModal();
}

function updateAiModelField() {
  const provider = $('#aiProvider').value;
  const cfg = getProviderConfig(provider);
  const select = $('#aiModelSelect');
  const custom = $('#aiModelCustom');
  const baseField = $('#aiBaseUrlField');

  baseField.hidden = provider !== 'openai_compat';
  const hasPresets = cfg.models?.length > 0;

  if (hasPresets) {
    select.hidden = false;
    custom.hidden = true;
    select.innerHTML = cfg.models.map((m) => `<option value="${m}">${m}</option>`).join('');
    const current = state.aiSettings.model || cfg.defaultModel;
    select.value = cfg.models.includes(current) ? current : cfg.defaultModel;
  } else {
    select.hidden = true;
    custom.hidden = false;
    custom.value = state.aiSettings.model || '';
  }
}

function getSettingsFromForm() {
  const provider = $('#aiProvider').value;
  const select = $('#aiModelSelect');
  const model = select.hidden ? $('#aiModelCustom').value.trim() : select.value;
  return {
    provider,
    apiKey: $('#aiApiKey').value.trim(),
    baseUrl: $('#aiBaseUrl').value.trim(),
    model,
  };
}

function saveSettingsFromForm() {
  state.aiSettings = saveAiSettings(getSettingsFromForm());
  $('#aiSettingsStatus').textContent = 'Configuração salva neste navegador.';
  updateAiButtons();
  setTimeout(() => { $('#aiSettingsStatus').textContent = ''; }, 2500);
}

async function runAiAnalysis(regionOnly = false) {
  if (!isAiConfigured(state.aiSettings)) {
    openSettingsDialog();
    return;
  }
  if (!state.diffResult) return;

  const resultEl = $('#aiResult');
  const statusEl = $('#aiStatus');
  state.aiLoading = true;
  updateAiButtons();

  resultEl.className = 'ai-result ai-result--loading';
  resultEl.innerHTML = '<p>Analisando com IA… isso pode levar alguns segundos.</p>';
  statusEl.textContent = 'Enviando resumo ao provedor…';

  try {
    const options = {
      question: $('#aiQuestion').value.trim() || undefined,
      maxRegions: regionOnly ? 1 : 25,
      mappack: state.mappack,
    };
    let regions = state.regions;
    if (regionOnly && state.selectedRegion) {
      const region = ensureRegionAnalyzed(state.selectedRegion);
      regions = [region];
      options.question =
        ($('#aiQuestion').value.trim() || '') +
        ` Foque na região 0x${region.start.toString(16).toUpperCase()}–0x${region.end.toString(16).toUpperCase()}.`;
    }

    const payload = buildAnalysisPayload(
      state.metaA,
      state.metaB,
      regions,
      state.diffResult,
      options
    );
    const text = await requestAiAnalysis(state.aiSettings, payload);
    resultEl.className = 'ai-result';
    resultEl.innerHTML = renderMarkdownLite(text);
    statusEl.textContent = `Análise concluída — ${getProviderConfig(state.aiSettings.provider).label}`;
    activateTab('ai');
  } catch (err) {
    resultEl.className = 'ai-result ai-result--error';
    resultEl.innerHTML = `<p><strong>Erro:</strong> ${escapeHtml(err.message || String(err))}</p>`;
    statusEl.textContent = '';
  } finally {
    state.aiLoading = false;
    updateAiButtons();
  }
}

function initAiSettings() {
  const dlg = $('#settingsDialog');
  const open = () => openSettingsDialog();

  on('#btnSettings', 'click', open);
  on('#btnSettingsInline', 'click', open);
  on('#btnCloseSettings', 'click', () => dlg?.close());

  on('#aiProvider', 'change', updateAiModelField);

  on('#settingsForm', 'submit', (e) => {
    e.preventDefault();
    saveSettingsFromForm();
    dlg?.close();
  });

  on('#btnClearAiKey', 'click', () => {
    clearAiSettings();
    state.aiSettings = loadAiSettings();
    const keyEl = $('#aiApiKey');
    if (keyEl) keyEl.value = '';
    const status = $('#aiSettingsStatus');
    if (status) status.textContent = 'Chave removida.';
    updateAiButtons();
  });

  on('#btnAiAnalyze', 'click', () => runAiAnalysis(false));
  on('#btnAiRegion', 'click', () => runAiAnalysis(true));

  updateAiButtons();
}

function initDropzone(zone) {
  if (!zone) return;
  const slot = zone.dataset.slot;
  const input = $(`#file${slot}`);
  if (!input) return;

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => loadFile(input.files?.[0], slot));

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dropzone--hover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dropzone--hover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dropzone--hover');
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file, slot);
  });
}

function initTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });
}

function initEvents() {
  initDropzone($('#dropA'));
  initDropzone($('#dropB'));

  on('#btnSwap', 'click', swapFiles);
  on('#btnClear', 'click', clearFiles);
  on('#btnExport', 'click', exportJson);

  on('#decodeMode', 'change', () => {
    const xor = $('#xorField');
    if (xor) xor.hidden = getDecodeMode() !== 'xor';
    updateDecode();
  });
  on('#xorKey', 'input', updateDecode);
  on('#hexCols', 'change', () => {
    state.hexPage = 0;
    rebuildDiffRows();
    renderHex();
  });
  on('#hexHideEqual', 'change', () => {
    state.hexPage = 0;
    rebuildDiffRows();
    syncDiffPagesOnlyUI($('#hexHideEqual')?.checked);
    renderHex();
  });
  on('#hexDiffPagesOnly', 'change', () => {
    state.hexPage = 0;
    renderHex();
  });
  on('#hexSyncScroll', 'change', renderHex);
  on('#hexAlignB', 'change', () => {
    rebuildDiffRows();
    renderHex();
  });

  const bindDiffNav = (dir) => () => jumpToDiff(dir);
  on('#hexDiffPrev', 'click', bindDiffNav(-1));
  on('#hexDiffNext', 'click', bindDiffNav(1));
  on('#hexDiffPrevBar', 'click', bindDiffNav(-1));
  on('#hexDiffNextBar', 'click', bindDiffNav(1));

  on('#hexOffset', 'change', () => {
    const el = $('#hexOffset');
    if (el) scrollHexToOffset(parseHexInput(el.value));
  });

  on('#regionFilter', 'input', () => {
    state.regionsPage = 0;
    renderRegionsTable();
  });
  on('#onlyCalibration', 'change', () => {
    state.regionsPage = 0;
    renderRegionsTable();
  });

  on('#heatmap', 'click', (e) => {
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const cols = 128;
    const buckets = Math.ceil(state.decodedA.length / 4096);
    const cellW = canvas.width / cols;
    const cellH = canvas.height / Math.ceil(buckets / cols);
    const col = Math.floor((e.clientX - rect.left) / cellW);
    const row = Math.floor((e.clientY - rect.top) / cellH);
    state.hexOffset = (row * cols + col) * 4096;
    const offsetEl = $('#hexOffset');
    if (offsetEl) offsetEl.value = '0x' + state.hexOffset.toString(16).toUpperCase();
    activateTab('hex');
    scrollHexToOffset(state.hexOffset);
  });
}

initTabs();
initEvents();
initHexPager(setHexPage);
initAiSettings();
initHexEditor();
initMappack();
initSidebarToggle();
initCollapsiblePanels();
updateFileActions();
if (state.rawA && state.rawB) restoreActiveTab(activateTab);
initKeyboardShortcuts({
  onNextDiff: () => { if ($('#tab-hex')?.classList.contains('active')) jumpToDiff(1); },
  onPrevDiff: () => { if ($('#tab-hex')?.classList.contains('active')) jumpToDiff(-1); },
  onTab: activateTab,
  onHexPagePrev: () => {
    if (!$('#tab-hex')?.classList.contains('active')) return;
    const v = getHexView();
    setHexPage(Math.max(0, v.page - 1));
  },
  onHexPageNext: () => {
    if (!$('#tab-hex')?.classList.contains('active')) return;
    const v = getHexView();
    setHexPage(Math.min(v.totalPages - 1, v.page + 1));
  },
});
window.addEventListener('resize', () => {
  if ($('#tab-hex')?.classList.contains('active')) renderHex();
});
