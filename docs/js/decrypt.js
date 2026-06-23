/** Decodificação / "descriptografia" heurística para bins Bosch MED17 */

export function xorDecrypt(buffer, keyBytes) {
  if (!keyBytes.length) return buffer.slice();
  const out = new Uint8Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) out[i] = buffer[i] ^ keyBytes[i % keyBytes.length];
  return out;
}

export function parseHexKey(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (!clean || clean.length % 2) return new Uint8Array([0]);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function decodeBuffer(buffer, mode, xorKeyHex = '00') {
  switch (mode) {
    case 'xor':
      return xorDecrypt(buffer, parseHexKey(xorKeyHex));
    case 'raw':
    case 'u16be':
    case 'u16le':
    default:
      return buffer;
  }
}

export function readU16(buffer, offset, endian = 'be') {
  if (offset + 1 >= buffer.length) return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return endian === 'be' ? view.getUint16(offset, false) : view.getUint16(offset, true);
}

export function formatHexLine(buffer, offset, cols, diffMask = null, side = 'a', wrapRow = false, options = {}) {
  const { editable = false, isEdited = null } = options;
  const end = Math.min(offset + cols, buffer.length);
  let line = `<span class="offset">${offset.toString(16).toUpperCase().padStart(6, '0')}</span>  `;
  const bytes = [];
  const ascii = [];
  let rowHasDiff = false;

  const isDiffAt = (byteOffset) => {
    if (!diffMask) return false;
    if (typeof diffMask === 'function') return diffMask(byteOffset);
    return diffMask.has(byteOffset);
  };

  for (let i = offset; i < end; i++) {
    const b = buffer[i];
    const isDiff = isDiffAt(i);
    if (isDiff) rowHasDiff = true;
    const edited = isEdited?.(i);
    let cls = isDiff ? (side === 'a' ? 'diff-a' : 'diff-b') : 'same';
    if (edited) cls += ' hex-byte--edited';
    const hex = b.toString(16).toUpperCase().padStart(2, '0');
    const editAttr = editable ? ` data-editable="1" data-side="${side}"` : '';
    bytes.push(`<span class="hex-byte ${cls}" data-offset="${i}"${editAttr} title="${editable ? 'Clique editar · Ctrl+clique selecionar · Shift intervalo' : ''}">${hex}</span>`);
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.');
  }

  while (bytes.length < cols) {
    bytes.push('  ');
    ascii.push(' ');
  }

  line += bytes.join(' ') + '  |' + ascii.join('') + '|';
  if (!wrapRow) return line;
  const rowCls = rowHasDiff ? 'hex-line hex-line--diff' : 'hex-line';
  return `<div class="${rowCls}" data-offset="${offset}">${line}</div>`;
}

export function formatWordLine(buffer, offset, count, endian, diffWords = null) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const off = offset + i * 2;
    const val = readU16(buffer, off, endian);
    if (val === null) break;
    const changed = diffWords && diffWords.has(off);
    lines.push(`  +${(i * 2).toString().padStart(2, '0')}: ${val.toString().padStart(5)} (0x${val.toString(16).toUpperCase().padStart(4, '0')})${changed ? ' *' : ''}`);
  }
  return lines.join('\n');
}

export function detectCalibrationRegions(buffer, minWords = 8) {
  const regions = [];
  let start = null;
  let run = 0;

  for (let i = 0; i < buffer.length - 1; i += 2) {
    const v = readU16(buffer, i, 'be');
    const plausible = v !== null && v > 0 && v < 65000;
    if (plausible) {
      if (start === null) start = i;
      run++;
    } else if (start !== null && run >= minWords) {
      regions.push({ offset: start, length: run * 2, words: run });
      start = null;
      run = 0;
    } else {
      start = null;
      run = 0;
    }
  }
  if (start !== null && run >= minWords) regions.push({ offset: start, length: run * 2, words: run });
  return regions;
}

export function boschValueHints(raw) {
  const hints = [];
  if (raw >= 100 && raw <= 8000) hints.push(`possível RPM×4: ${(raw / 4).toFixed(0)} rpm`);
  if (raw >= 1000 && raw <= 30000) hints.push(`possível mg/stroke×100 ou hPa`);
  if (raw <= 255) hints.push(`byte estendido: ${raw}`);
  return hints;
}
