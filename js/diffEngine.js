import { readU16 } from './decrypt.js';
import { sectionTypeAt } from './ecuParser.js';

export function computeByteDiff(a, b) {
  const len = Math.min(a.length, b.length);
  const diffs = [];
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) diffs.push({ offset: i, a: a[i], b: b[i] });
  }
  const sizeMismatch = a.length !== b.length;
  return { diffs, sizeMismatch, lenA: a.length, lenB: b.length };
}

export function groupRegions(diffs) {
  if (!diffs.length) return [];
  const regions = [];
  let start = diffs[0].offset;
  let end = start;
  let items = [diffs[0]];

  for (let i = 1; i < diffs.length; i++) {
    const d = diffs[i];
    if (d.offset === end + 1) {
      end = d.offset;
      items.push(d);
    } else {
      regions.push({ start, end, length: end - start + 1, items });
      start = d.offset;
      end = d.offset;
      items = [d];
    }
  }
  regions.push({ start, end, length: end - start + 1, items });
  return regions;
}

export function analyzeRegion(region, a, b, sectionsA, endian = 'be') {
  const wordChanges = [];
  const start = region.start & ~1;
  const end = region.end;

  for (let off = start; off <= end - 1; off += 2) {
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

export function buildHeatmapBuckets(diffs, fileSize, bucketSize = 4096) {
  const buckets = Math.ceil(fileSize / bucketSize);
  const counts = new Uint32Array(buckets);
  for (const d of diffs) {
    const idx = Math.floor(d.offset / bucketSize);
    if (idx < buckets) counts[idx]++;
  }
  return { counts, bucketSize, buckets };
}

export function exportReport(metaA, metaB, regions, diffResult) {
  return {
    generatedAt: new Date().toISOString(),
    fileA: { name: metaA.fileName, size: metaA.size, sw: metaA.swVersion, hw: metaA.hwNumbers },
    fileB: { name: metaB.fileName, size: metaB.size, sw: metaB.swVersion, hw: metaB.hwNumbers },
    summary: {
      totalDiffBytes: diffResult.diffs.length,
      regions: regions.length,
      sizeMismatch: diffResult.sizeMismatch,
      similarityPct: (
        (1 - diffResult.diffs.length / Math.min(diffResult.lenA, diffResult.lenB)) *
        100
      ).toFixed(4),
    },
    regions: regions.map((r, i) => ({
      index: i + 1,
      start: `0x${r.start.toString(16).toUpperCase()}`,
      end: `0x${r.end.toString(16).toUpperCase()}`,
      length: r.length,
      type: r.type,
      bytesChanged: r.items.length,
      avgWordDelta: r.avgDelta,
      wordChanges: r.wordChanges.slice(0, 50),
    })),
  };
}
