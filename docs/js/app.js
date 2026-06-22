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
  formatWordLine,
} from './decrypt.js';
import {
  computeByteDiff,
  groupRegions,
  analyzeRegion,
  buildHeatmapBuckets,
  exportReport,
} from './diffEngine.js';

const state = {
  rawA: null,
  rawB: null,
  decodedA: null,
  decodedB: null,
  metaA: null,
  metaB: null,
  diffResult: null,
  regions: [],
  selectedRegion: null,
  hexOffset: 0,
};

const $ = (sel) => document.querySelector(sel);

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
    state.rawA = buffer;
    state.metaA = meta;
    setFileInfo($('#infoA'), name, buffer.length);
    $('#metaA').innerHTML = `<h3>Arquivo A</h3>${renderMetadata(meta)}`;
    $('#stringsA').textContent = formatStrings(buffer);
    $('#sectionsA').innerHTML = renderSections(meta.sections);
    $('#dropA').classList.add('dropzone--loaded');
  } else {
    state.rawB = buffer;
    state.metaB = meta;
    setFileInfo($('#infoB'), name, buffer.length);
    $('#metaB').innerHTML = `<h3>Arquivo B</h3>${renderMetadata(meta)}`;
    $('#stringsB').textContent = formatStrings(buffer);
    $('#sectionsB').innerHTML = renderSections(meta.sections);
    $('#dropB').classList.add('dropzone--loaded');
  }

  updateDecode();
  $('#btnCompare').disabled = !(state.rawA && state.rawB);

  if (state.rawA && state.rawB) runCompare();
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

function runCompare() {
  if (!state.decodedA || !state.decodedB) return;

  state.diffResult = computeByteDiff(state.decodedA, state.decodedB);
  const grouped = groupRegions(state.diffResult.diffs);
  state.regions = grouped.map((r) => analyzeRegion(r, state.decodedA, state.decodedB, state.metaA.sections));

  renderSummary();
  renderRegionsTable();
  renderHeatmap();
  renderHex();
  $('#btnExport').disabled = false;
  $('#summaryPanel').hidden = false;
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
    tbody.innerHTML = '<tr><td colspan="7" class="muted center">Nenhuma região encontrada</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((r, idx) => {
      const tagClass =
        r.type === 'calibration' ? 'cal' : r.type === 'text' ? 'text' : r.type === 'empty' ? 'empty' : r.type === 'entropy' ? 'entropy' : 'code';
      return `<tr data-region="${state.regions.indexOf(r)}">
        <td>${idx + 1}</td>
        <td class="mono">0x${r.start.toString(16).toUpperCase()}</td>
        <td class="mono">${r.length} B</td>
        <td><span class="tag tag--${tagClass}">${r.type}</span></td>
        <td>${r.items.length}</td>
        <td class="mono">${r.avgDelta.toFixed(1)}${r.uniformDelta ? ' (uniforme)' : ''}</td>
        <td><button class="btn btn--sm jump-region">Ver hex</button></td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('.jump-region').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      jumpToRegion(state.regions[Number(row.dataset.region)]);
    });
  });
}

function jumpToRegion(region) {
  state.selectedRegion = region;
  state.hexOffset = region.start & ~0xf;
  document.querySelector('.tab[data-tab="hex"]').click();
  renderHex();
  renderRegionDetail(region);
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

function renderHex() {
  if (!state.decodedA || !state.decodedB) return;

  const cols = Number($('#hexCols').value);
  const offset = state.hexOffset;
  const onlyDiff = $('#hexOnlyDiff').checked;
  const diffSet = new Set(state.diffResult?.diffs.map((d) => d.offset) || []);

  const linesA = [];
  const linesB = [];
  const rows = 24;

  for (let row = 0; row < rows; row++) {
    const off = offset + row * cols;
    if (off >= state.decodedA.length) break;
    const rowHasDiff = [...Array(cols)].some((_, i) => diffSet.has(off + i));
    if (onlyDiff && !rowHasDiff) continue;
    linesA.push(formatHexLine(state.decodedA, off, cols, diffSet, 'a'));
    linesB.push(formatHexLine(state.decodedB, off, cols, diffSet, 'b'));
  }

  $('#hexViewA').innerHTML = linesA.join('\n') || '<span class="muted">Sem diferenças neste bloco</span>';
  $('#hexViewB').innerHTML = linesB.join('\n') || '<span class="muted">Sem diferenças neste bloco</span>';
  $('#hexLabelA').textContent = `@ 0x${offset.toString(16).toUpperCase()}`;
  $('#hexLabelB').textContent = `@ 0x${offset.toString(16).toUpperCase()}`;

  if (getDecodeMode() === 'u16be' || getDecodeMode() === 'u16le') {
    const endian = getDecodeMode() === 'u16le' ? 'le' : 'be';
    const words = formatWordLine(state.decodedA, offset, Math.min(cols / 2, 16), endian);
    const wordsB = formatWordLine(state.decodedB, offset, Math.min(cols / 2, 16), endian);
    if (words) {
      $('#hexViewA').innerHTML += '\n\n<span class="muted">U16 ' + endian.toUpperCase() + ':</span>\n' + words;
      $('#hexViewB').innerHTML += '\n\n<span class="muted">U16 ' + endian.toUpperCase() + ':</span>\n' + wordsB;
    }
  }
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

function initDropzone(zone) {
  const slot = zone.dataset.slot;
  const input = $(`#file${slot}`);

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
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $(`#tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

function initEvents() {
  initDropzone($('#dropA'));
  initDropzone($('#dropB'));

  $('#btnCompare').addEventListener('click', runCompare);
  $('#btnExport').addEventListener('click', exportJson);

  $('#decodeMode').addEventListener('change', () => {
    $('#xorField').hidden = getDecodeMode() !== 'xor';
    updateDecode();
  });
  $('#xorKey').addEventListener('input', updateDecode);
  $('#hexCols').addEventListener('change', renderHex);
  $('#hexOnlyDiff').addEventListener('change', renderHex);

  $('#hexPrev').addEventListener('click', () => {
    const step = Number($('#hexCols').value) * 24;
    state.hexOffset = Math.max(0, state.hexOffset - step);
    $('#hexOffset').value = '0x' + state.hexOffset.toString(16).toUpperCase();
    renderHex();
  });

  $('#hexNext').addEventListener('click', () => {
    const step = Number($('#hexCols').value) * 24;
    state.hexOffset = Math.min((state.decodedA?.length || 0) - 1, state.hexOffset + step);
    $('#hexOffset').value = '0x' + state.hexOffset.toString(16).toUpperCase();
    renderHex();
  });

  $('#hexOffset').addEventListener('change', () => {
    const v = $('#hexOffset').value.trim().replace(/^0x/i, '');
    state.hexOffset = Math.max(0, parseInt(v, 16) || 0);
    renderHex();
  });

  $('#regionFilter').addEventListener('input', renderRegionsTable);
  $('#onlyCalibration').addEventListener('change', renderRegionsTable);

  $('#heatmap').addEventListener('click', (e) => {
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const cols = 128;
    const buckets = Math.ceil(state.decodedA.length / 4096);
    const cellW = canvas.width / cols;
    const cellH = canvas.height / Math.ceil(buckets / cols);
    const col = Math.floor((e.clientX - rect.left) / cellW);
    const row = Math.floor((e.clientY - rect.top) / cellH);
    state.hexOffset = (row * cols + col) * 4096;
    $('#hexOffset').value = '0x' + state.hexOffset.toString(16).toUpperCase();
    document.querySelector('.tab[data-tab="hex"]').click();
    renderHex();
  });
}

initTabs();
initEvents();
