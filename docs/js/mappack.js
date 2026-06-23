/**
 * Mappack — definições de mapas (auxiliar ao .bin, estilo WinOLS .kp / A2L).
 * Formato JSON aberto do ECU Map Diff; .kp WinOLS é proprietário (import experimental).
 */

const STORAGE_KEY = 'ecumapdiff_mappack';
const STORAGE_KEY_LEGACY = 'mrreadebin_mappack';

export function parseHexOffset(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value >= 0 ? value : null;
  const s = String(value).trim().replace(/^0x/i, '');
  const n = parseInt(s, 16);
  return Number.isNaN(n) || n < 0 ? null : n;
}

export function parseSignature(hex) {
  const clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
  if (!clean || clean.length % 2) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function findSignature(buffer, pattern) {
  if (!pattern?.length || !buffer?.length) return -1;
  outer: for (let i = 0; i <= buffer.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (buffer[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function mapByteSize(dataType, rows, cols) {
  const cells = Math.max(1, rows) * Math.max(1, cols);
  const per = dataType === 'u8' || dataType === 'i8' ? 1 : dataType === 'u32' || dataType === 'i32' ? 4 : 2;
  return cells * per;
}

function normalizeMap(raw, index) {
  const rows = Number(raw.rows) || 1;
  const cols = Number(raw.cols) || 1;
  const dataType = raw.dataType || 'u16be';
  let start = parseHexOffset(raw.offset ?? raw.start);
  let end = parseHexOffset(raw.end);

  if (start != null && end == null) {
    end = start + mapByteSize(dataType, rows, cols) - 1;
  }

  return {
    id: raw.id || `map_${index + 1}`,
    name: raw.name || raw.id || `Mapa ${index + 1}`,
    category: raw.category || raw.folder || 'Geral',
    description: raw.description || '',
    start,
    end,
    rows,
    cols,
    dataType,
    factor: raw.factor != null ? Number(raw.factor) : null,
    offsetValue: raw.offsetValue != null ? Number(raw.offsetValue) : 0,
    unit: raw.unit || '',
    axisX: raw.axisX || null,
    axisY: raw.axisY || null,
    signature: raw.signature ? parseSignature(raw.signature) : null,
    offsetFromSignature: parseHexOffset(raw.offsetFromSignature) ?? 0,
    _resolvedStart: start,
    _resolvedEnd: end,
  };
}

export function parseMappackJson(text) {
  const data = JSON.parse(text);
  const maps = (data.maps || []).map((m, i) => normalizeMap(m, i));
  return {
    name: data.name || data.title || 'Mappack',
    version: data.version || '1',
    ecu: data.ecu || data.ecuType || '',
    sw: Array.isArray(data.sw) ? data.sw : data.sw ? [data.sw] : [],
    hw: Array.isArray(data.hw) ? data.hw : [],
    author: data.author || '',
    notes: data.notes || '',
    maps,
  };
}

export function resolveMappackAddresses(mappack, buffer) {
  if (!mappack?.maps || !buffer) return mappack;
  const maps = mappack.maps.map((m) => {
    const copy = { ...m };
    if (m.signature) {
      const sigPos = findSignature(buffer, m.signature);
      if (sigPos >= 0) {
        copy._resolvedStart = sigPos + m.offsetFromSignature;
        copy._resolvedEnd = copy._resolvedStart + mapByteSize(m.dataType, m.rows, m.cols) - 1;
        copy._signatureFound = true;
      } else {
        copy._resolvedStart = null;
        copy._resolvedEnd = null;
        copy._signatureFound = false;
      }
    } else {
      copy._resolvedStart = m.start;
      copy._resolvedEnd = m.end;
    }
    return copy;
  });
  return { ...mappack, maps, _resolved: true };
}

export function getMapBounds(map) {
  const start = map._resolvedStart ?? map.start;
  const end = map._resolvedEnd ?? map.end;
  if (start == null) return null;
  return { start, end: end ?? start };
}

const MAP_CATEGORY_COLORS = [
  '#3dd6b5', '#5b8def', '#e6b450', '#f07178', '#b388ff', '#4dd0e1',
  '#81c784', '#ffb74d', '#9575cd', '#4fc3f7', '#aed581', '#ff8a65',
];

const categoryColorCache = new Map();

export function getMapCategoryColor(category) {
  const key = (category || 'Geral').toLowerCase();
  if (categoryColorCache.has(key)) return categoryColorCache.get(key);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const color = MAP_CATEGORY_COLORS[Math.abs(hash) % MAP_CATEGORY_COLORS.length];
  categoryColorCache.set(key, color);
  return color;
}

export function getResolvedMaps(mappack) {
  if (!mappack?.maps) return [];
  return mappack.maps
    .map((m) => {
      const b = getMapBounds(m);
      if (!b) return null;
      return { map: m, start: b.start, end: b.end, size: b.end - b.start + 1 };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

export function getPrimaryMapAtOffset(mappack, offset) {
  const maps = findMapsAtOffset(mappack, offset);
  if (!maps.length) return null;
  return maps.reduce((best, m) => {
    const b = getMapBounds(m);
    const size = b.end - b.start;
    const bestB = best ? getMapBounds(best) : null;
    const bestSize = bestB ? bestB.end - bestB.start : Infinity;
    return size < bestSize ? m : best;
  }, null);
}

export function getMapsStartingInRange(mappack, start, end) {
  return getResolvedMaps(mappack)
    .filter((r) => r.start >= start && r.start <= end)
    .map((r) => r.map);
}

export function renderMappackFileLayout(mappack, fileLength) {
  const resolved = getResolvedMaps(mappack);
  if (!resolved.length) {
    return mappack?._experimental
      ? '<p class="muted">Import .kp sem offsets — use um mappack <strong>.json</strong> com endereços para ver o layout no arquivo.</p>'
      : '<p class="muted">Nenhum mapa com offset resolvido neste arquivo.</p>';
  }
  const total = Math.max(fileLength || 1, resolved[resolved.length - 1].end + 1);
  const bar = resolved
    .map((r) => {
      const pct = Math.max(0.15, (r.size / total) * 100);
      const color = getMapCategoryColor(r.map.category);
      const title = `${r.map.name} (${r.map.category}) · 0x${r.start.toString(16).toUpperCase()}`;
      return `<button type="button" class="mappack-bar__seg jump-map-layout" style="width:${pct}%;background:${color}" data-map-start="${r.start}" title="${escapeHtml(title)}"></button>`;
    })
    .join('');

  const list = resolved
    .map((r) => {
      const color = getMapCategoryColor(r.map.category);
      return `<div class="mappack-layout-row">
        <span class="swatch" style="background:${color}"></span>
        <span class="mono">0x${r.start.toString(16).toUpperCase()}–0x${r.end.toString(16).toUpperCase()}</span>
        <span class="mappack-layout-row__name"><strong>${escapeHtml(r.map.name)}</strong>
          <span class="tag tag--cal">${escapeHtml(r.map.category)}</span></span>
        <span class="muted mono">${r.size} B · ${r.map.rows}×${r.map.cols}</span>
        <button type="button" class="btn btn--sm btn--ghost jump-map-layout" data-map-start="${r.start}">Hex</button>
      </div>`;
    })
    .join('');

  return `<div class="mappack-layout">
    <p class="hint mappack-layout__hint">${resolved.length} região(ões) mapeada(s) no arquivo (${((resolved.reduce((s, r) => s + r.size, 0) / total) * 100).toFixed(1)}% do bin)</p>
    <div class="mappack-bar section-bar">${bar}</div>
    <div class="mappack-layout-list">${list}</div>
  </div>`;
}

export function findMapsAtOffset(mappack, offset) {
  if (!mappack?.maps) return [];
  return mappack.maps.filter((m) => {
    const b = getMapBounds(m);
    if (!b) return false;
    return offset >= b.start && offset <= b.end;
  });
}

export function findMapsForRegion(mappack, regionStart, regionEnd) {
  if (!mappack?.maps) return [];
  return mappack.maps.filter((m) => {
    const b = getMapBounds(m);
    if (!b) return false;
    return regionStart <= b.end && regionEnd >= b.start;
  });
}

export function formatMapShort(map) {
  const b = getMapBounds(map);
  const off = b ? `0x${b.start.toString(16).toUpperCase()}` : '?';
  return `${map.name} (${map.category}) @ ${off}`;
}

export function formatMapDetail(map) {
  const b = getMapBounds(map);
  const lines = [
    `**${map.name}** — ${map.category}`,
    map.description || '',
    b ? `Offset: 0x${b.start.toString(16).toUpperCase()}–0x${b.end.toString(16).toUpperCase()}` : 'Offset: não resolvido',
    `Dimensões: ${map.rows}×${map.cols} (${map.dataType})`,
  ];
  if (map.unit) lines.push(`Unidade: ${map.unit}${map.factor != null ? ` · fator ${map.factor}` : ''}`);
  if (map.axisX?.unit) lines.push(`Eixo X: ${map.axisX.description || map.axisX.unit}`);
  if (map.axisY?.unit) lines.push(`Eixo Y: ${map.axisY.description || map.axisY.unit}`);
  return lines.filter(Boolean).join('\n');
}

export function mappackMatchesForRegions(mappack, regions) {
  if (!mappack) return [];
  return regions.map((r) => {
    const maps = findMapsForRegion(mappack, r.start, r.end);
    return {
      regionStart: r.start,
      regionEnd: r.end,
      maps: maps.map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        description: m.description,
        bounds: getMapBounds(m),
        unit: m.unit,
        factor: m.factor,
      })),
    };
  });
}

export function saveMappackToStorage(mappack) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mappack));
  } catch { /* quota */ }
}

export function loadMappackFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY_LEGACY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearMappackStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Extrai nomes legíveis de .kp WinOLS (ZIP ou texto) — sem garantia de offsets. */
export async function parseKpExperimental(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const names = new Set();

  const pushName = (s) => {
    const t = s.trim();
    if (t.length >= 4 && t.length <= 80 && /^[\w\s\-.,()\/°%]+$/.test(t)) names.add(t);
  };

  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] >= 0x20 && bytes[i] <= 0x7e) {
      let s = '';
      let j = i;
      while (j < bytes.length && bytes[j] >= 0x20 && bytes[j] <= 0x7e && s.length < 80) {
        s += String.fromCharCode(bytes[j++]);
      }
      if (s.length >= 6) pushName(s);
      i = j;
    }
  }

  for (let i = 0; i < bytes.length - 8; i += 2) {
    if (bytes[i] >= 0x20 && bytes[i] <= 0x7e && bytes[i + 1] === 0) {
      let s = '';
      let j = i;
      while (j < bytes.length - 1 && bytes[j + 1] === 0 && bytes[j] >= 0x20 && bytes[j] <= 0x7e) {
        s += String.fromCharCode(bytes[j]);
        j += 2;
      }
      if (s.length >= 6) pushName(s);
    }
  }

  const filtered = [...names]
    .filter((n) => !/^(WinOLS|File|intern|PK|xml)/i.test(n))
    .filter((n) => /[a-zA-Z]{3}/.test(n))
    .slice(0, 200);

  return {
    name: 'Importado de .kp (experimental)',
    version: 'kp-import',
    ecu: '',
    sw: [],
    maps: filtered.map((name, i) => ({
      id: `kp_${i}`,
      name,
      category: 'KP (sem offset)',
      description: 'Nome extraído do .kp — offset não disponível neste importador',
      start: null,
      end: null,
      rows: 1,
      cols: 1,
      dataType: 'u16be',
      _resolvedStart: null,
      _resolvedEnd: null,
    })),
    _experimental: true,
  };
}

export async function loadMappackFile(file) {
  const buf = await file.arrayBuffer();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'json') {
    return parseMappackJson(new TextDecoder().decode(buf));
  }
  if (ext === 'kp') {
    return parseKpExperimental(buf);
  }
  try {
    return parseMappackJson(new TextDecoder().decode(buf));
  } catch {
    throw new Error('Formato não suportado. Use .json (recomendado) ou .kp (experimental).');
  }
}

export function renderMappackInfo(mappack) {
  if (!mappack) return '<p class="muted">Nenhum mappack carregado</p>';
  const resolved = mappack.maps.filter((m) => getMapBounds(m)).length;
  const total = mappack.maps.length;
  return `<ul class="meta-list">
    <li><span class="label">Nome</span><span>${escapeHtml(mappack.name)}</span></li>
    <li><span class="label">ECU</span><span>${escapeHtml(mappack.ecu || '—')}</span></li>
    <li><span class="label">SW compat.</span><span>${escapeHtml(mappack.sw?.join(', ') || '—')}</span></li>
    <li><span class="label">Mapas</span><span>${resolved}/${total} com offset</span></li>
    ${mappack._experimental ? '<li><span class="label">Modo</span><span class="tag tag--entropy">KP experimental</span></li>' : ''}
  </ul>`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMapsTable(mappack, filter = '') {
  if (!mappack?.maps?.length) {
    return '<p class="muted center">Nenhum mapa definido</p>';
  }
  const q = filter.trim().toLowerCase();
  const rows = mappack.maps.filter((m) => {
    if (!q) return true;
    return [m.name, m.category, m.description, m.id].some((f) => String(f).toLowerCase().includes(q));
  });

  if (!rows.length) return '<p class="muted center">Nenhum mapa encontrado</p>';

  return `<table class="data-table mappack-table">
    <thead><tr><th>Mapa</th><th>Categoria</th><th>Offset</th><th>Tamanho</th><th></th></tr></thead>
    <tbody>${rows.map((m) => {
      const b = getMapBounds(m);
      const off = b ? `0x${b.start.toString(16).toUpperCase()}` : '—';
      const size = b ? `${b.end - b.start + 1} B` : '—';
      return `<tr data-map-start="${b?.start ?? ''}">
        <td><strong>${escapeHtml(m.name)}</strong>${m.description ? `<br><span class="muted map-desc">${escapeHtml(m.description)}</span>` : ''}</td>
        <td><span class="tag tag--cal">${escapeHtml(m.category)}</span></td>
        <td class="mono">${off}</td>
        <td class="mono">${size} · ${m.rows}×${m.cols}</td>
        <td>${b ? '<button type="button" class="btn btn--sm jump-map">Hex</button>' : ''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}
