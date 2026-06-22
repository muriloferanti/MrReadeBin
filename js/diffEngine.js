import { readU16 } from './decrypt.js';
import { sectionTypeAt } from './ecuParser.js';

const LARGE_FILE = 512 * 1024;

/** Uma passada — sem array de objetos por byte (3MB não trava). */
export function scanByteDiff(a, b, bucketSize = 4096) {
  const lenA = a.length;
  const lenB = b.length;
  const len = Math.min(lenA, lenB);
  const sizeMismatch = lenA !== lenB;

  let diffCount = 0;
  const regions = [];
  let regStart = -1;

  const buckets = Math.max(1, Math.ceil(lenA / bucketSize));
  const counts = new Uint32Array(buckets);

  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      diffCount++;
      const bucket = (i / bucketSize) | 0;
      if (bucket < buckets) counts[bucket]++;
      if (regStart === -1) regStart = i;
    } else if (regStart !== -1) {
      regions.push({ start: regStart, end: i - 1, length: i - regStart });
      regStart = -1;
    }
  }
  if (regStart !== -1) {
    regions.push({ start: regStart, end: len - 1, length: len - regStart });
  }

  return {
    diffCount,
    lenA,
    lenB,
    sizeMismatch,
    regions,
    heatmap: { counts, bucketSize, buckets },
  };
}

/** Compat — evita alocar N objetos {offset,a,b}. */
export function computeByteDiff(a, b) {
  const r = scanByteDiff(a, b);
  return {
    diffCount: r.diffCount,
    lenA: r.lenA,
    lenB: r.lenB,
    sizeMismatch: r.sizeMismatch,
    regions: r.regions,
    heatmap: r.heatmap,
    get diffs() {
      return { length: r.diffCount };
    },
  };
}

export function buildDiffRowsFromRegions(regions, cols) {
  if (!regions.length || cols < 1) return [];
  const rows = new Set();
  for (const r of regions) {
    const startRow = (r.start / cols | 0) * cols;
    const endRow = (r.end / cols | 0) * cols;
    for (let off = startRow; off <= endRow; off += cols) rows.add(off);
  }
  return [...rows].sort((a, b) => a - b);
}

export function groupRegions(diffs) {
  if (!diffs.length) return [];
  const regions = [];
  let start = diffs[0].offset;
  let end = start;
  let length = 1;

  for (let i = 1; i < diffs.length; i++) {
    const d = diffs[i];
    if (d.offset === end + 1) {
      end = d.offset;
      length++;
    } else {
      regions.push({ start, end, length });
      start = d.offset;
      end = d.offset;
      length = 1;
    }
  }
  regions.push({ start, end, length });
  return regions;
}

export function analyzeRegion(region, a, b, sectionsA, endian = 'be') {
  const wordChanges = [];
  const start = region.start & ~1;
  const end = region.end;
  const maxWords = region.length > LARGE_FILE ? 400 : 8000;

  for (let off = start; off <= end - 1 && wordChanges.length < maxWords; off += 2) {
    const va = readU16(a, off, endian);
    const vb = readU16(b, off, endian);
    if (va !== null && vb !== null && va !== vb) {
      wordChanges.push({ offset: off, a: va, b: vb, delta: vb - va });
    }
  }

  const deltas = wordChanges.map((w) => w.delta);
  const avgDelta = deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : 0;
  const type = sectionTypeAt(sectionsA, region.start);

  return {
    ...region,
    type,
    wordChanges,
    avgDelta,
    uniformDelta: deltas.length > 2 && deltas.every((d) => d === deltas[0]),
  };
}

export function buildHeatmapBuckets(diffsOrHeatmap, fileSize, bucketSize = 4096) {
  if (diffsOrHeatmap?.counts) return diffsOrHeatmap;
  const buckets = Math.ceil(fileSize / bucketSize);
  const counts = new Uint32Array(buckets);
  for (const d of diffsOrHeatmap) {
    const idx = Math.floor(d.offset / bucketSize);
    if (idx < buckets) counts[idx]++;
  }
  return { counts, bucketSize, buckets };
}

export function getDiffCount(diffResult) {
  return diffResult?.diffCount ?? diffResult?.diffs?.length ?? 0;
}

export function exportReport(metaA, metaB, regions, diffResult) {
  const total = getDiffCount(diffResult);
  const minLen = Math.min(diffResult.lenA, diffResult.lenB);
  return {
    generatedAt: new Date().toISOString(),
    fileA: { name: metaA.fileName, size: metaA.size, sw: metaA.swVersion, hw: metaA.hwNumbers },
    fileB: { name: metaB.fileName, size: metaB.size, sw: metaB.swVersion, hw: metaB.hwNumbers },
    summary: {
      totalDiffBytes: total,
      regions: regions.length,
      sizeMismatch: diffResult.sizeMismatch,
      similarityPct: ((1 - total / minLen) * 100).toFixed(4),
    },
    regions: regions.map((r, i) => ({
      index: i + 1,
      start: `0x${r.start.toString(16).toUpperCase()}`,
      end: `0x${r.end.toString(16).toUpperCase()}`,
      length: r.length,
      type: r.type,
      bytesChanged: r.length,
      avgWordDelta: r.avgDelta,
      wordChanges: r.wordChanges.slice(0, 50),
    })),
  };
}
