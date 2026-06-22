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
