import { parseHexKey } from './decrypt.js';

export function decodedToRawByte(decodedByte, offset, mode, xorKeyHex) {
  if (mode !== 'xor') return decodedByte;
  const key = parseHexKey(xorKeyHex);
  return decodedByte ^ key[offset % key.length];
}

export function applyDecodedByteEdit(rawBuffer, offset, decodedByte, mode, xorKeyHex) {
  if (offset < 0 || offset >= rawBuffer.length) return false;
  rawBuffer[offset] = decodedToRawByte(decodedByte, offset, mode, xorKeyHex);
  return true;
}

export function parseByteHex(input) {
  const clean = input.trim().replace(/^0x/i, '');
  if (!clean) return null;
  const val = parseInt(clean.length <= 2 ? clean : clean.slice(-2), 16);
  return Number.isNaN(val) || val < 0 || val > 255 ? null : val;
}

/** Parseia sequência hex: "FF", "FF 00 AA", "FF,00;AA" */
export function parseHexByteSequence(input) {
  const clean = input.trim();
  if (!clean) return [];
  const parts = clean.split(/[\s,;]+/).filter(Boolean);
  const values = [];
  for (const part of parts) {
    const val = parseByteHex(part);
    if (val === null) return null;
    values.push(val);
  }
  return values;
}

export function countRawDiff(base, current) {
  if (!base || !current) return 0;
  const len = Math.min(base.length, current.length);
  let n = 0;
  for (let i = 0; i < len; i++) if (base[i] !== current[i]) n++;
  if (base.length !== current.length) n += Math.abs(base.length - current.length);
  return n;
}

export function isOffsetEdited(base, current, offset) {
  if (!base || !current || offset < 0) return false;
  if (offset >= base.length || offset >= current.length) return true;
  return base[offset] !== current[offset];
}

export function downloadBuffer(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildEditedFilename(originalName, suffix = '_edited') {
  const match = originalName.match(/^(.+?)(\.[^.]+)?$/);
  const base = match?.[1] || 'ecu';
  const ext = match?.[2] || '.bin';
  return `${base}${suffix}${ext}`;
}

export function cloneBuffer(buffer) {
  return new Uint8Array(buffer);
}

export function revertRawBuffer(working, base) {
  if (!working || !base) return;
  working.set(base);
}

/** Copia bytes diferentes de A para B (desfaz alteração em B). Retorna qty alterada. */
export function applyDiffRangeAToB(startA, endA, decodedA, decodedB, rawB, alignB, mode, xorKey) {
  if (!decodedA || !decodedB || !rawB) return 0;
  let count = 0;
  const lo = Math.max(0, startA);
  const hi = Math.min(endA, decodedA.length - 1);
  for (let o = lo; o <= hi; o++) {
    const ob = o + alignB;
    if (ob < 0 || ob >= decodedB.length) continue;
    if (decodedA[o] === decodedB[ob]) continue;
    if (applyDecodedByteEdit(rawB, ob, decodedA[o], mode, xorKey)) count++;
  }
  return count;
}

/** Copia bytes diferentes de B para A. */
export function applyDiffRangeBToA(startA, endA, decodedA, decodedB, rawA, alignB, mode, xorKey) {
  if (!decodedA || !decodedB || !rawA) return 0;
  let count = 0;
  const lo = Math.max(0, startA);
  const hi = Math.min(endA, decodedA.length - 1);
  for (let o = lo; o <= hi; o++) {
    const ob = o + alignB;
    if (ob < 0 || ob >= decodedB.length) continue;
    if (decodedA[o] === decodedB[ob]) continue;
    if (applyDecodedByteEdit(rawA, o, decodedB[ob], mode, xorKey)) count++;
  }
  return count;
}

export function applyDiffRegionAToB(region, decodedA, decodedB, rawB, alignB, mode, xorKey) {
  return applyDiffRangeAToB(region.start, region.end, decodedA, decodedB, rawB, alignB, mode, xorKey);
}

export function applyDiffRegionBToA(region, decodedA, decodedB, rawA, alignB, mode, xorKey) {
  return applyDiffRangeBToA(region.start, region.end, decodedA, decodedB, rawA, alignB, mode, xorKey);
}
