import {
  parseMetadata,
  renderMetadata,
  renderSections,
  extractStrings,
  md5Hex,
} from './ecuParser.js';
import {
  decodeBuffer,
  formatHexLine,
} from './decrypt.js';
import {
  computeByteDiff,
  groupRegions,
  analyzeRegion,
  buildHeatmapBuckets,
  exportReport,
} from './diffEngine.js';
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
  selectedRegion: null,
  hexOffset: 0,
  hexScrollLock: false,
  aiSettings: loadAiSettings(),
  aiLoading: false,
  baseRawA: null,
  baseRawB: null,
  hexEditTarget: null,
  mappack: null,
};

const HEX_ROW_HEIGHT = 20;
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
  if (tabId === 'hex') requestAnimationFrame(renderHex);
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
  state.selectedRegion = null;

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

  runCompare();
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
  meta.md5 = await md5Hex(buffer);

  if (slot === 'A') {
    state.rawA = cloneBuffer(buffer);
    state.baseRawA = cloneBuffer(buffer);
    state.metaA = meta;
    setFileInfo($('#infoA'), name, buffer.length);
    $('#metaA').innerHTML = `<h3>Original (A)</h3>${renderMetadata(meta)}`;
    $('#stringsA').textContent = formatStrings(buffer);
    $('#sectionsA').innerHTML = renderSections(meta.sections);
    $('#dropA').classList.add('dropzone--loaded');
  } else {
    state.rawB = cloneBuffer(buffer);
    state.baseRawB = cloneBuffer(buffer);
    state.metaB = meta;
    setFileInfo($('#infoB'), name, buffer.length);
    $('#metaB').innerHTML = `<h3>Modificado (B)</h3>${renderMetadata(meta)}`;
    $('#stringsB').textContent = formatStrings(buffer);
    $('#sectionsB').innerHTML = renderSections(meta.sections);
    $('#dropB').classList.add('dropzone--loaded');
  }

  updateDecode();
  updateFileActions();
  refreshMappackResolution();

  if (state.rawA && state.rawB) {
    runCompare();
  } else {
    showToast(`Arquivo ${slot} carregado`, 'success');
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
  if (state.diffResult) runCompare();
}

function runCompare(silent = false) {
  if (!state.decodedA || !state.decodedB) return;

  state.diffResult = computeByteDiff(state.decodedA, state.decodedB);
  const grouped = groupRegions(state.diffResult.diffs);
  state.regions = grouped.map((r) => analyzeRegion(r, state.decodedA, state.decodedB, state.metaA.sections));
  refreshDiffRows();

  renderSummary();
  renderRegionsTable();
  renderHeatmap();
  renderHex();
  updateAiButtons();
  updateTabBadges(state.regions.length, state.diffResult.diffs.length);
  $('#btnExport').disabled = false;
  $('#summaryPanel').hidden = false;
  updateEditStatus();

  const sim = (1 - state.diffResult.diffs.length / Math.min(state.diffResult.lenA, state.diffResult.lenB)) * 100;
  renderSimilarityBar(sim);
  updateWorkflowSteps(3);

  if (!silent) {
    if (state.diffResult.diffs.length > 0) {
      activateTab('hex');
      showToast(`${state.regions.length} regiões · ${state.diffResult.diffs.length.toLocaleString('pt-BR')} bytes diferentes`, 'success');
    } else {
      activateTab('metadata');
      showToast('Arquivos idênticos', 'info');
    }
  }
}

function renderSummary() {
  const { diffs, sizeMismatch, lenA, lenB } = state.diffResult;
  const sim = (1 - diffs.length / Math.min(lenA, lenB)) * 100;
  const swMatch = state.metaA.swVersion === state.metaB.swVersion;

  $('#diffStats').innerHTML = `
    <dt>Bytes diferentes</dt><dd>${diffs.length.toLocaleString('pt-BR')}</dd>
    <dt>Regiões</dt><dd>${state.regions.length}</dd>
    <dt>Similaridade</dt><dd>${sim.toFixed(4)}%</dd>
    <dt>Tamanhos</dt><dd>A=${lenA} / B=${lenB}${sizeMismatch ? ' ⚠ diferentes' : ''}</dd>
    <dt>SW compatível</dt><dd>${swMatch ? 'Sim (' + state.metaA.swVersion + ')' : 'Não — A=' + state.metaA.swVersion + ', B=' + state.metaB.swVersion}</dd>
  `;
}

function renderRegionsTable() {
  const filter = $('#regionFilter').value.trim().toLowerCase();
  const onlyCal = $('#onlyCalibration').checked;
  const tbody = $('#regionsBody');
  const rows = state.regions.filter((r) => {
    if (onlyCal && r.type !== 'calibration') return false;
    if (filter) {
      const hex = r.start.toString(16);
      if (!hex.includes(filter.replace('0x', ''))) return false;
    }
    return true;
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted center">Nenhuma região encontrada</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((r, idx) => {
      const tagClass =
        r.type === 'calibration' ? 'cal' : r.type === 'text' ? 'text' : r.type === 'empty' ? 'empty' : r.type === 'entropy' ? 'entropy' : 'code';
      const maps = state.mappack ? findMapsForRegion(state.mappack, r.start, r.end) : [];
      const mapCell = maps.length
        ? maps.slice(0, 2).map((m) => `<span class="tag tag--cal" title="${escapeHtml(m.description || '')}">${escapeHtml(m.name)}</span>`).join(' ')
            + (maps.length > 2 ? ` <span class="muted">+${maps.length - 2}</span>` : '')
        : '<span class="muted">—</span>';
      return `<tr data-region="${state.regions.indexOf(r)}">
        <td>${idx + 1}</td>
        <td class="mono">0x${r.start.toString(16).toUpperCase()}</td>
        <td class="mono">${r.length} B</td>
        <td><span class="tag tag--${tagClass}">${r.type}</span></td>
        <td>${r.items.length}</td>
        <td class="mono">${r.avgDelta.toFixed(1)}${r.uniformDelta ? ' ∆' : ''}</td>
        <td class="map-cell">${mapCell}</td>
        <td class="actions">
          <button type="button" class="btn btn--sm jump-region">Hex</button>
          <button type="button" class="btn btn--sm btn--ghost jump-ai" ${isAiConfigured(state.aiSettings) ? '' : 'title="Configure a IA primeiro"'}>IA</button>
        </td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('.jump-region').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      jumpToRegion(state.regions[Number(row.dataset.region)]);
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
  if (!region?.wordChanges?.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const lines = region.wordChanges.map(
    (w) =>
      `0x${w.offset.toString(16).toUpperCase()}: ${w.a} (0x${w.a.toString(16).toUpperCase()}) → ${w.b} (0x${w.b.toString(16).toUpperCase()})  Δ=${w.delta >= 0 ? '+' : ''}${w.delta}`
  );
  pre.textContent = `Região 0x${region.start.toString(16).toUpperCase()}–0x${region.end.toString(16).toUpperCase()} (${region.length} bytes)\n\n` + lines.join('\n');
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
  if (!applyDecodedByteEdit(raw, offset, decodedByte, getDecodeMode(), getXorKey())) return false;
  updateDecode();
  if (state.rawA && state.rawB) runCompare(true);
  else {
    renderHex();
    updateEditStatus();
  }
  return true;
}

function copyByteAtoB(offsetA) {
  if (!state.decodedA || !state.rawB) return;
  const offsetB = offsetA + getHexAlignB();
  if (offsetB < 0 || offsetB >= state.decodedB.length) {
    showToast('Fora do alcance do arquivo B', 'error');
    return;
  }
  const val = state.decodedA[offsetA];
  if (commitByteEdit('B', offsetB, val)) {
    showToast(`Copiado A→B em 0x${offsetB.toString(16).toUpperCase()}`, 'success');
  }
}

function revertAllEdits() {
  if (state.rawA && state.baseRawA) revertRawBuffer(state.rawA, state.baseRawA);
  if (state.rawB && state.baseRawB) revertRawBuffer(state.rawB, state.baseRawB);
  closeHexEditor();
  updateDecode();
  if (state.rawA && state.rawB) runCompare(true);
  else renderHex();
  updateEditStatus();
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
  if (!byte) return;
  e.preventDefault();
  const side = byte.dataset.side;
  if (side === 'a' && !$('#hexEditA')?.checked) return;
  if (side === 'b' && !$('#hexEditB')?.checked) return;
  openHexEditor(byte, side, Number(byte.dataset.offset));
}

function onHexPaneDblClick(e) {
  const byte = e.target.closest('.hex-byte[data-side="a"]');
  if (!byte || !state.rawB || !$('#hexEditB')?.checked) return;
  e.preventDefault();
  copyByteAtoB(Number(byte.dataset.offset));
}

function initHexEditor() {
  $('#hexScrollA')?.addEventListener('click', onHexPaneClick);
  $('#hexScrollB')?.addEventListener('click', onHexPaneClick);
  $('#hexScrollA')?.addEventListener('dblclick', onHexPaneDblClick);

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
    if (e.key === 'Escape' && state.hexEditTarget) closeHexEditor();
  });

  $('#btnRevertEdits')?.addEventListener('click', revertAllEdits);
  $('#btnDownloadEdited')?.addEventListener('click', downloadEditedFile);
  $('#hexEditA')?.addEventListener('change', renderHex);
  $('#hexEditB')?.addEventListener('change', renderHex);
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

function refreshDiffRows() {
  if (!state.decodedA || !state.decodedB) {
    state.diffRows = [];
    return;
  }
  const cols = getHexCols();
  const rows = new Set();
  const len = state.decodedA.length;
  for (let off = 0; off < len; off += cols) {
    if (rowHasDiffA(off, cols)) rows.add(off);
  }
  state.diffRows = [...rows].sort((a, b) => a - b);
}

function getHexRowModel() {
  const hideEqual = $('#hexHideEqual')?.checked;
  const cols = getHexCols();
  if (hideEqual) {
    return {
      mode: 'diff-only',
      rows: state.diffRows,
      totalRows: state.diffRows.length,
      rowOffset: (index) => state.diffRows[index],
    };
  }
  const totalRows = Math.ceil(state.decodedA.length / cols);
  return {
    mode: 'full',
    rows: null,
    totalRows,
    rowOffset: (index) => index * cols,
  };
}

function renderHexPane(side, scrollEl, contentEl, spacerEl) {
  if (!state.decodedA || !state.decodedB || !scrollEl) return;

  const cols = getHexCols();
  const alignB = getHexAlignB();
  const synced = $('#hexSyncScroll')?.checked;
  const hideEqual = $('#hexHideEqual')?.checked;
  const scrollTop = scrollEl.scrollTop;
  const clientHeight = scrollEl.clientHeight || 400;

  let totalRows;
  let bufferStart;
  let bufferEnd;

  if (hideEqual) {
    totalRows = state.diffRows.length;
    const startRow = Math.floor(scrollTop / HEX_ROW_HEIGHT);
    const visibleRows = Math.ceil(clientHeight / HEX_ROW_HEIGHT) + 10;
    bufferStart = Math.max(0, startRow - 2);
    bufferEnd = Math.min(totalRows, bufferStart + visibleRows);
  } else if (side === 'b' && !synced) {
    totalRows = Math.ceil(state.decodedB.length / cols);
    const startRow = Math.floor(scrollTop / HEX_ROW_HEIGHT);
    const visibleRows = Math.ceil(clientHeight / HEX_ROW_HEIGHT) + 10;
    bufferStart = Math.max(0, startRow - 2);
    bufferEnd = Math.min(totalRows, bufferStart + visibleRows);
  } else {
    totalRows = Math.ceil(state.decodedA.length / cols);
    const startRow = Math.floor(scrollTop / HEX_ROW_HEIGHT);
    const visibleRows = Math.ceil(clientHeight / HEX_ROW_HEIGHT) + 10;
    bufferStart = Math.max(0, startRow - 2);
    bufferEnd = Math.min(totalRows, bufferStart + visibleRows);
  }

  spacerEl.style.height = `${totalRows * HEX_ROW_HEIGHT}px`;

  const lines = [];
  for (let row = bufferStart; row < bufferEnd; row++) {
    let offsetA;
    let offsetB;

    if (hideEqual) {
      offsetA = state.diffRows[row];
      offsetB = offsetA + alignB;
    } else if (side === 'b' && !synced) {
      offsetB = row * cols;
      offsetA = offsetB - alignB;
    } else {
      offsetA = row * cols;
      offsetB = offsetA + alignB;
    }

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

  contentEl.style.transform = `translateY(${bufferStart * HEX_ROW_HEIGHT}px)`;
  contentEl.innerHTML = lines.join('');

  if (side === 'a') {
    const first = hideEqual ? state.diffRows[bufferStart] ?? 0 : bufferStart * cols;
    const lastRow = Math.min(bufferEnd, totalRows) - 1;
    const last = hideEqual ? state.diffRows[lastRow] ?? first : lastRow * cols;
    $('#hexLabelA').textContent = `0x${first.toString(16).toUpperCase()} – 0x${(last + cols).toString(16).toUpperCase()}`;
  } else {
    let first;
    let last;
    if (hideEqual) {
      first = (state.diffRows[bufferStart] ?? 0) + alignB;
      const lastRow = Math.min(bufferEnd, totalRows) - 1;
      last = (state.diffRows[lastRow] ?? 0) + alignB;
    } else if (!synced) {
      first = bufferStart * cols;
      last = (Math.min(bufferEnd, totalRows) - 1) * cols;
    } else {
      first = bufferStart * cols + alignB;
      last = (Math.min(bufferEnd, totalRows) - 1) * cols + alignB;
    }
    $('#hexLabelB').textContent = `0x${Math.max(0, first).toString(16).toUpperCase()} – 0x${(last + cols).toString(16).toUpperCase()}`;
  }
}

function renderHex() {
  if (!state.decodedA || !state.decodedB) return;
  refreshDiffRows();
  renderHexPane('a', $('#hexScrollA'), $('#hexContentA'), $('#hexSpacerA'));
  renderHexPane('b', $('#hexScrollB'), $('#hexContentB'), $('#hexSpacerB'));
  updateEditStatus();
  const scrollA = $('#hexScrollA');
  const cols = getHexCols();
  const hideEqual = $('#hexHideEqual')?.checked;
  const row = Math.floor((scrollA?.scrollTop || 0) / HEX_ROW_HEIGHT);
  const offsetA = hideEqual ? (state.diffRows[row] ?? 0) : row * cols;
  updateHexMapLabels(offsetA, offsetA + getHexAlignB());
}

function onHexScroll(sourceSide) {
  const scrollA = $('#hexScrollA');
  const scrollB = $('#hexScrollB');
  if (!state.hexScrollLock && $('#hexSyncScroll')?.checked) {
    state.hexScrollLock = true;
    if (sourceSide === 'a') scrollB.scrollTop = scrollA.scrollTop;
    else scrollA.scrollTop = scrollB.scrollTop;
    state.hexScrollLock = false;
  }
  renderHex();
}

function scrollHexToOffset(offset) {
  const model = getHexRowModel();
  const cols = getHexCols();
  let rowIndex;
  if (model.mode === 'diff-only') {
    rowIndex = state.diffRows.findIndex((off) => off >= offset);
    if (rowIndex < 0) rowIndex = Math.max(0, model.totalRows - 1);
  } else {
    rowIndex = Math.floor(offset / cols);
  }
  const scrollTop = Math.max(0, rowIndex * HEX_ROW_HEIGHT - HEX_ROW_HEIGHT * 3);
  const scrollA = $('#hexScrollA');
  const scrollB = $('#hexScrollB');
  scrollA.scrollTop = scrollTop;
  if ($('#hexSyncScroll')?.checked) scrollB.scrollTop = scrollTop;
  else scrollB.scrollTop = scrollTop;
  state.hexOffset = offset;
  $('#hexOffset').value = '0x' + offset.toString(16).toUpperCase();
  renderHex();
}

function jumpToDiff(direction) {
  if (!state.diffRows.length) return;
  const scrollA = $('#hexScrollA');
  const cols = getHexCols();
  const hideEqual = $('#hexHideEqual')?.checked;
  const currentOffset = hideEqual
    ? state.diffRows[Math.floor(scrollA.scrollTop / HEX_ROW_HEIGHT)] ?? state.diffRows[0]
    : Math.floor(scrollA.scrollTop / HEX_ROW_HEIGHT) * cols;

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
  const ctx = canvas.getContext('2d');
  const { counts, bucketSize, buckets } = buildHeatmapBuckets(
    state.diffResult.diffs,
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
      regions = [state.selectedRegion];
      options.question =
        ($('#aiQuestion').value.trim() || '') +
        ` Foque na região 0x${state.selectedRegion.start.toString(16).toUpperCase()}–0x${state.selectedRegion.end.toString(16).toUpperCase()}.`;
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
    refreshDiffRows();
    renderHex();
  });
  on('#hexHideEqual', 'change', renderHex);
  on('#hexSyncScroll', 'change', renderHex);
  on('#hexAlignB', 'change', () => {
    refreshDiffRows();
    renderHex();
  });

  on('#hexScrollA', 'scroll', () => onHexScroll('a'));
  on('#hexScrollB', 'scroll', () => onHexScroll('b'));

  const bindDiffNav = (dir) => () => jumpToDiff(dir);
  on('#hexDiffPrev', 'click', bindDiffNav(-1));
  on('#hexDiffNext', 'click', bindDiffNav(1));
  on('#hexDiffPrevBar', 'click', bindDiffNav(-1));
  on('#hexDiffNextBar', 'click', bindDiffNav(1));

  on('#hexOffset', 'change', () => {
    const el = $('#hexOffset');
    if (el) scrollHexToOffset(parseHexInput(el.value));
  });

  on('#regionFilter', 'input', renderRegionsTable);
  on('#onlyCalibration', 'change', renderRegionsTable);

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
});
window.addEventListener('resize', () => {
  if ($('#tab-hex')?.classList.contains('active')) renderHex();
});
