import { readU16 } from './decrypt.js';
import { sectionTypeAt } from './ecuParser.js';

export const MAX_REGIONS = 8000;
export const SCAN_CHUNK = 256 * 1024;
const LARGE_FILE = 512 * 1024;

/** Uma passada — sem objeto por byte. onProgress(0..1) opcional. */
export function scanByteDiff(a, b, bucketSize = 4096, onProgress) {
  const lenA = a.length;
  const lenB = b.length;
  const len = Math.min(lenA, lenB);
  const sizeMismatch = lenA !== lenB;

  let diffCount = 0;
  const regions = [];
  let regStart = -1;

  const buckets = Math.max(1, Math.ceil(lenA / bucketSize));
  const counts = new Uint32Array(buckets);

  for (let start = 0; start < len; start += SCAN_CHUNK) {
    const end = Math.min(len, start + SCAN_CHUNK);
    for (let i = start; i < end; i++) {
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
    if (onProgress) onProgress(end / len);
  }

  if (regStart !== -1) {
    regions.push({ start: regStart, end: len - 1, length: len - regStart });
  }

  const coalesced = coalesceRegions(regions, MAX_REGIONS);

  return {
    diffCount,
    lenA,
    lenB,
    sizeMismatch,
    regions: coalesced.regions,
    regionsTruncated: coalesced.truncated,
    heatmap: { counts, bucketSize, buckets },
  };
}

/** Evita milhões de regiões 1-byte que derrubam o navegador. */
export function coalesceRegions(regions, maxCount = MAX_REGIONS) {
  if (regions.length <= maxCount) return { regions, truncated: false };
  const merged = [];
  const step = Math.ceil(regions.length / maxCount);
  for (let i = 0; i < regions.length; i += step) {
    const chunk = regions.slice(i, i + step);
    const start = chunk[0].start;
    const end = chunk[chunk.length - 1].end;
    merged.push({ start, end, length: end - start + 1 });
  }
  return { regions: merged, truncated: true };
}

export function analyzeRegionLight(region, sectionsA) {
  return {
    ...region,
    type: sectionTypeAt(sectionsA, region.start) || 'code',
    wordChanges: [],
    avgDelta: 0,
    uniformDelta: false,
    _light: true,
  };
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
  const type = sectionTypeAt(sectionsA, region.start) || 'code';

  return {
    ...region,
    type,
    wordChanges,
    avgDelta,
    uniformDelta: deltas.length > 2 && deltas.every((d) => d === deltas[0]),
    _light: false,
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

export function computeByteDiff(a, b) {
  return scanByteDiff(a, b);
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
      regionsTruncated: !!diffResult.regionsTruncated,
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
      wordChanges: (r.wordChanges || []).slice(0, 50),
    })),
  };
}

export function serializeScanResult(result) {
  return {
    diffCount: result.diffCount,
    lenA: result.lenA,
    lenB: result.lenB,
    sizeMismatch: result.sizeMismatch,
    regionsTruncated: result.regionsTruncated,
    regions: result.regions,
    heatmap: {
      counts: Array.from(result.heatmap.counts),
      bucketSize: result.heatmap.bucketSize,
      buckets: result.heatmap.buckets,
    },
  };
}

export function deserializeScanResult(data) {
  return {
    ...data,
    heatmap: {
      counts: new Uint32Array(data.heatmap.counts),
      bucketSize: data.heatmap.bucketSize,
      buckets: data.heatmap.buckets,
    },
  };
}
