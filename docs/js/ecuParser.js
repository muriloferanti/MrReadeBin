const PATTERNS = {
  swVersion: /10SW\d{12}/g,
  hwNumber: /04C90\d{4}[A-Z0-9]*/g,
  calNumber: /1037\d{12}/g,
  med17: /MED17[\w.\s/]+/g,
  edc17: /ME\(D\)\/EDC17[\w.\s/]+/g,
  tprot: /TPROT_V[\d.]+\/\d+/g,
  engine: /1\.0l TFS[\w\s]*/g,
  cyta: /CYTA/g,
  ecuId: /EV_ECM[\w\s]+/g,
};

const SECTION_COLORS = {
  empty: '#2a3042',
  text: '#4f8cff',
  calibration: '#36c9a8',
  entropy: '#f0b429',
  code: '#ff6b6b',
};

export function extractStrings(buffer, minLen = 6) {
  const out = [];
  let current = '';

  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    if (c >= 0x20 && c <= 0x7e) {
      current += String.fromCharCode(c);
    } else {
      if (current.length >= minLen) out.push({ offset: i - current.length, text: current });
      current = '';
    }
  }
  if (current.length >= minLen) out.push({ offset: buffer.length - current.length, text: current });

  return out;
}

export function entropy(data) {
  if (!data.length) return 0;
  const freq = new Uint32Array(256);
  for (const b of data) freq[b]++;
  let e = 0;
  const n = data.length;
  for (let i = 0; i < 256; i++) {
    if (freq[i]) {
      const p = freq[i] / n;
      e -= p * Math.log2(p);
    }
  }
  return e;
}

export function classifyChunk(data) {
  if (!data.length) return 'empty';
  let zeros = 0;
  let printable = 0;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === 0) zeros++;
    if (b >= 0x20 && b <= 0x7e) printable++;
  }
  const zeroRatio = zeros / data.length;
  if (zeroRatio > 0.92) return 'empty';

  if (printable / data.length > 0.75) return 'text';

  const e = entropy(data);
  if (e > 6.8) return 'entropy';
  if (e < 4.5 && zeroRatio < 0.3) return 'calibration';
  return 'code';
}

export function analyzeSections(buffer, blockSize = 4096) {
  const sections = [];
  for (let offset = 0; offset < buffer.length; offset += blockSize) {
    const chunk = buffer.subarray(offset, Math.min(offset + blockSize, buffer.length));
    const type = classifyChunk(chunk);
    const last = sections[sections.length - 1];
    if (last && last.type === type && last.end === offset) {
      last.end = offset + chunk.length;
    } else {
      sections.push({ offset, end: offset + chunk.length, type, entropy: entropy(chunk) });
    }
  }
  return sections;
}

function decodeMetadataText(buffer) {
  if (buffer.length <= 1024 * 1024) {
    return new TextDecoder('latin1').decode(buffer);
  }
  const head = new TextDecoder('latin1').decode(buffer.subarray(0, 1024 * 1024));
  const tail = new TextDecoder('latin1').decode(buffer.subarray(Math.max(0, buffer.length - 512 * 1024)));
  return `${head}\n${tail}`;
}

export function parseMetadata(buffer, fileName = '', options = {}) {
  const skipHeavy = options.skipHeavy ?? buffer.length > 512 * 1024;
  const text = decodeMetadataText(buffer);
  const pick = (re) => {
    const m = text.match(re);
    return m ? [...new Set(m)][0] : null;
  };
  const pickAll = (re) => {
    const m = text.match(re);
    return m ? [...new Set(m)] : [];
  };

  let notable = [];
  if (!skipHeavy) {
    const strings = extractStrings(buffer, 8);
    notable = strings
      .filter((s) => /MED|EDC|TPROT|04C90|10SW|1037|Engine|TFS|CYTA|EV_ECM/i.test(s.text))
      .map((s) => s.text);
  }

  return {
    fileName,
    size: buffer.length,
    sizeHuman: `${(buffer.length / 1024 / 1024).toFixed(2)} MB`,
    md5: null,
    swVersion: pick(PATTERNS.swVersion),
    hwNumbers: pickAll(PATTERNS.hwNumber),
    calNumbers: pickAll(PATTERNS.calNumber),
    ecuType: pick(PATTERNS.med17) || pick(PATTERNS.edc17),
    tprot: pick(PATTERNS.tprot),
    engine: pick(PATTERNS.engine),
    ecuId: pick(PATTERNS.ecuId),
    notableStrings: notable,
    sections: skipHeavy ? [] : analyzeSections(buffer),
    _enriched: !skipHeavy,
  };
}

export function enrichMetadata(meta, buffer) {
  if (meta._enriched) return meta;
  if (!meta.sections.length) meta.sections = analyzeSections(buffer);
  meta._enriched = true;
  return meta;
}

export function renderMetadata(meta) {
  const rows = [
    ['Arquivo', meta.fileName],
    ['Tamanho', `${meta.size} bytes (${meta.sizeHuman})`],
    ['Hash', meta.md5 || '—'],
    ['Software VW', meta.swVersion || '—'],
    ['Hardware', meta.hwNumbers.join(', ') || '—'],
    ['Calibração', meta.calNumbers.join(', ') || '—'],
    ['Tipo ECU', meta.ecuType || '—'],
    ['TPROT', meta.tprot || '—'],
    ['Motor', meta.engine || '—'],
    ['ID ECM', meta.ecuId || '—'],
  ];

  return `<ul class="meta-list">${rows
    .map(([label, val]) => `<li><span class="label">${label}</span><span>${escapeHtml(String(val))}</span></li>`)
    .join('')}</ul>`;
}

export function renderSections(sections) {
  const total = sections[sections.length - 1]?.end || 1;
  const bar = sections
    .map((s) => {
      const pct = ((s.end - s.offset) / total) * 100;
      return `<span style="width:${pct}%;background:${SECTION_COLORS[s.type]}" title="${s.type} @ 0x${s.offset.toString(16)}"></span>`;
    })
    .join('');

  const list = sections
    .map(
      (s) =>
        `<div><span class="swatch" style="background:${SECTION_COLORS[s.type]}"></span>` +
        `<span class="mono">0x${s.offset.toString(16).toUpperCase()}–0x${(s.end - 1).toString(16).toUpperCase()}</span> ` +
        `<span class="tag tag--${s.type === 'calibration' ? 'cal' : s.type === 'text' ? 'text' : s.type === 'empty' ? 'empty' : s.type === 'entropy' ? 'entropy' : 'code'}">${s.type}</span> ` +
        `<span class="muted">H=${s.entropy.toFixed(2)}</span></div>`
    )
    .join('');

  return `<div class="section-bar">${bar}</div><div class="section-list">${list}</div>`;
}

export function sectionTypeAt(sections, offset) {
  for (const s of sections) {
    if (offset >= s.offset && offset < s.end) return s.type;
  }
  return 'code';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function md5Hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
