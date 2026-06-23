/** Detecção e remoção heurística de proteção NoRead / TPROT em bins MED17/EDC17 */

export const NOREAD_KNOWN_PATCHES = [
  {
    id: 'tprot-2b3c',
    label: 'TPROT 2B 3C → 00 00',
    search: [0x2b, 0x3c],
    replace: [0x00, 0x00],
    anchor: null,
    anchorOffset: 0,
  },
  {
    id: 'tprot-3c2b',
    label: 'TPROT 3C 2B → 00 00',
    search: [0x3c, 0x2b],
    replace: [0x00, 0x00],
    anchor: null,
    anchorOffset: 0,
  },
  {
    id: 'tprot-01-3c-2b',
    label: 'TPROT 01 3C 2B → 01 00 00',
    search: [0x01, 0x3c, 0x2b],
    replace: [0x01, 0x00, 0x00],
    anchor: null,
    anchorOffset: 0,
  },
  {
    id: 'tprot-anchor',
    label: 'Contexto 4F2E…2B3C',
    search: [0x2b, 0x3c],
    replace: [0x00, 0x00],
    anchor: [0x4f, 0x2e, 0x76, 0x2c, 0x8e, 0x28],
    anchorOffset: 6,
  },
];

const TEXT_MARKERS = ['NOREAD', 'NO READ', 'NORD', 'TPROT'];

export function findingKey(finding) {
  return `${finding.source}:${finding.offset}:${finding.id}`;
}

function matchesAt(buffer, offset, pattern) {
  if (offset < 0 || offset + pattern.length > buffer.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (buffer[offset + i] !== pattern[i]) return false;
  }
  return true;
}

function findPatternOccurrences(buffer, pattern, maxHits = 64) {
  const hits = [];
  if (!pattern.length) return hits;
  for (let i = 0; i <= buffer.length - pattern.length && hits.length < maxHits; i++) {
    if (matchesAt(buffer, i, pattern)) hits.push(i);
  }
  return hits;
}

export function formatBytes(bytes) {
  return [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export function scanKnownNoReadSignatures(buffer, options = {}) {
  const maxEarly = options.maxEarlyOffset ?? 0x100000;
  const patches = [];
  const seen = new Set();

  for (const def of NOREAD_KNOWN_PATCHES) {
    let occurrences = [];
    if (def.anchor) {
      for (const anchorOff of findPatternOccurrences(buffer, def.anchor)) {
        const off = anchorOff + def.anchorOffset;
        if (matchesAt(buffer, off, def.search)) occurrences.push(off);
      }
    } else {
      occurrences = findPatternOccurrences(buffer, def.search);
    }

    for (const off of occurrences) {
      const key = `${off}:${def.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const current = buffer.subarray(off, off + def.search.length);
      let confidence = 68;
      if (off < maxEarly) confidence += 15;
      if (def.anchor) confidence += 12;
      if (def.id === 'tprot-2b3c') confidence += 5;

      patches.push({
        id: def.id,
        label: def.label,
        offset: off,
        length: def.search.length,
        currentBytes: [...current],
        patchBytes: [...def.replace],
        source: 'signature',
        confidence: Math.min(99, confidence),
        description: `${formatBytes(current)} → ${formatBytes(def.replace)}`,
        autoApply: true,
      });
    }
  }

  for (const marker of TEXT_MARKERS) {
    const bytes = [...new TextEncoder().encode(marker)];
    for (const off of findPatternOccurrences(buffer, bytes, 8)) {
      patches.push({
        id: `text-${marker.replace(/\s/g, '-')}`,
        label: `Texto "${marker}"`,
        offset: off,
        length: bytes.length,
        currentBytes: bytes,
        patchBytes: null,
        source: 'text-marker',
        confidence: 35,
        description: `Marcador textual em 0x${off.toString(16).toUpperCase()}`,
        autoApply: false,
      });
    }
  }

  return patches.sort((a, b) => b.confidence - a.confidence || a.offset - b.offset);
}

function regionSize(region) {
  return region.length ?? region.end - region.start + 1;
}

function hasPatternAt(buffer, offset, pattern) {
  return matchesAt(buffer, offset, pattern);
}

export function findNoReadCandidatesFromPair(readable, protectedBuf, regions = []) {
  if (!readable || !protectedBuf) return [];
  const len = Math.min(readable.length, protectedBuf.length);
  const candidates = [];
  const maxProtectionSize = 4096;
  const maxEarly = 0x200000;

  for (const region of regions) {
    const start = region.start;
    const size = regionSize(region);
    if (size > maxProtectionSize) continue;
    if (region.type === 'calibration' && size > 128) continue;

    let score = 48;
    if (start < maxEarly) score += 18;
    if (size <= 16) score += 18;
    else if (size <= 64) score += 12;
    else if (size <= 256) score += 6;

    const patchOffsets = [];
    const patchBytes = [];
    let hasKnownPattern = false;

    for (let o = start; o <= region.end && o < len; o++) {
      if (readable[o] === protectedBuf[o]) continue;
      patchOffsets.push(o);
      patchBytes.push(readable[o]);

      if (
        (protectedBuf[o] === 0x2b && protectedBuf[o + 1] === 0x3c && readable[o] === 0x00 && readable[o + 1] === 0x00) ||
        (protectedBuf[o] === 0x3c && protectedBuf[o + 1] === 0x2b && readable[o] === 0x00 && readable[o + 1] === 0x00)
      ) {
        hasKnownPattern = true;
      }
    }

    if (!patchOffsets.length) continue;
    if (hasKnownPattern) score += 28;
    if (hasPatternAt(protectedBuf, start, [0x2b, 0x3c]) || hasPatternAt(protectedBuf, start, [0x01, 0x3c, 0x2b])) {
      score += 15;
    }
    if (region.type === 'code' || region.type === 'entropy') score += 8;

    const currentBytes = [...protectedBuf.subarray(start, Math.min(start + Math.min(size, 32), protectedBuf.length))];

    candidates.push({
      id: `pair-${start.toString(16)}`,
      label: `Diff vs legível (${size} B)`,
      offset: start,
      length: size,
      currentBytes,
      patchBytes,
      patchOffsets,
      source: 'pair-compare',
      confidence: Math.min(98, score),
      description: `${patchOffsets.length} byte(s) diferentes — copiar do arquivo legível (A)`,
      autoApply: true,
      region,
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence || a.offset - b.offset);
}

export function mergeNoReadFindings(signatureHits, pairCandidates, options = {}) {
  const minConfidence = options.minConfidence ?? 52;
  const merged = [];
  const covered = new Set();

  for (const finding of pairCandidates) {
    if (!finding.autoApply || finding.confidence < minConfidence) continue;
    merged.push(finding);
    for (const o of finding.patchOffsets || []) covered.add(o);
  }

  for (const finding of signatureHits) {
    if (!finding.autoApply || !finding.patchBytes || finding.confidence < minConfidence) continue;
    let skip = true;
    for (let i = 0; i < finding.length; i++) {
      if (!covered.has(finding.offset + i)) {
        skip = false;
        break;
      }
    }
    if (skip) continue;
    merged.push(finding);
    for (let i = 0; i < finding.length; i++) covered.add(finding.offset + i);
  }

  return merged.sort((a, b) => b.confidence - a.confidence || a.offset - b.offset);
}

export function analyzeNoRead({ readable, protectedBuf, regions, totalDiffCount }) {
  const sigOnB = protectedBuf ? scanKnownNoReadSignatures(protectedBuf) : [];
  const sigOnA = readable ? scanKnownNoReadSignatures(readable) : [];

  let pairCandidates = [];
  if (readable && protectedBuf && regions?.length) {
    pairCandidates = findNoReadCandidatesFromPair(readable, protectedBuf, regions);

    if (totalDiffCount != null && totalDiffCount < 500) {
      pairCandidates = pairCandidates.map((p) => ({
        ...p,
        confidence: Math.min(99, p.confidence + 12),
      }));
    } else if (totalDiffCount > 8000) {
      pairCandidates = pairCandidates.map((p) => {
        if (regionSize(p.region) > 256) {
          return { ...p, confidence: Math.max(25, p.confidence - 30), autoApply: false };
        }
        return p;
      });
    }
  }

  const findings = mergeNoReadFindings(sigOnB, pairCandidates);
  const highConfidence = findings.filter((f) => f.confidence >= 75);

  return {
    findings,
    signatureHits: sigOnB,
    pairCandidates,
    readableSignatures: sigOnA,
    summary: {
      count: findings.length,
      highConfidence: highConfidence.length,
      readableHasProtectionMarkers: sigOnA.some((s) => s.autoApply && s.confidence >= 70),
      protectedHasProtectionMarkers: sigOnB.some((s) => s.autoApply && s.confidence >= 70),
      suggestPairMode: !!(readable && protectedBuf),
      totalDiffCount,
    },
  };
}

export function applyNoReadFinding(buffer, finding) {
  let applied = 0;

  if (finding.source === 'pair-compare' && finding.patchOffsets?.length) {
    for (let i = 0; i < finding.patchOffsets.length; i++) {
      const o = finding.patchOffsets[i];
      const v = finding.patchBytes[i];
      if (o >= 0 && o < buffer.length && buffer[o] !== v) {
        buffer[o] = v;
        applied++;
      }
    }
    return { buffer, applied, finding };
  }

  if (finding.patchBytes?.length) {
    for (let i = 0; i < finding.length; i++) {
      const o = finding.offset + i;
      const v = finding.patchBytes[i];
      if (o < buffer.length && buffer[o] !== v) {
        buffer[o] = v;
        applied++;
      }
    }
    return { buffer, applied, finding };
  }

  return { buffer, applied: 0, finding };
}

export function applyNoReadFindings(buffer, findings, options = {}) {
  const minConfidence = options.minConfidence ?? 55;
  const onlyKeys = options.onlyKeys ?? null;

  let totalApplied = 0;
  const results = [];

  const toApply = findings.filter((f) => {
    if (!f.autoApply || !f.patchBytes) return false;
    if (f.confidence < minConfidence) return false;
    if (onlyKeys && !onlyKeys.has(findingKey(f))) return false;
    return true;
  });

  for (const finding of toApply) {
    const res = applyNoReadFinding(buffer, finding);
    totalApplied += res.applied;
    if (res.applied > 0) results.push(res);
  }

  return { buffer, totalApplied, results, appliedFindings: toApply };
}

export function confidenceLabel(confidence) {
  if (confidence >= 85) return 'Alta';
  if (confidence >= 65) return 'Média';
  return 'Baixa';
}

export function confidenceTagClass(confidence) {
  if (confidence >= 85) return 'tag--cal';
  if (confidence >= 65) return 'tag--text';
  return 'tag--entropy';
}

export function renderNoReadSummary(analysis) {
  if (!analysis) {
    return '<p class="muted">Carregue um arquivo protegido (B). Para comparação, use A = legível e B = com NoRead.</p>';
  }

  const { summary } = analysis;
  const rows = [
    ['Candidatos aplicáveis', summary.count],
    ['Alta confiança (≥75%)', summary.highConfidence],
    ['Marcadores no B', summary.protectedHasProtectionMarkers ? 'Sim' : 'Não'],
  ];
  if (summary.suggestPairMode) {
    rows.push(['Modo comparação', 'A legível + B protegido']);
    if (summary.totalDiffCount != null) {
      rows.push(['Total de diffs', summary.totalDiffCount.toLocaleString('pt-BR')]);
    }
  }

  return `<dl class="stats noread-summary">${rows
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('')}</dl>`;
}

export function renderNoReadTable(findings, selectedKeys = new Set()) {
  if (!findings?.length) {
    return '<p class="muted center" style="padding:1rem">Nenhum bloco de proteção detectado com os critérios atuais.</p>';
  }

  const rows = findings
    .map((f) => {
      const key = findingKey(f);
      const checked = selectedKeys.has(key) ? 'checked' : '';
      const canApply = f.autoApply && f.patchBytes;
      return `<tr data-finding-key="${key}">
        <td>${canApply ? `<input type="checkbox" class="noread-check" data-key="${key}" ${checked} />` : '—'}</td>
        <td class="mono">0x${f.offset.toString(16).toUpperCase()}</td>
        <td>${f.length ?? (f.patchOffsets?.length || '—')}</td>
        <td><span class="tag ${confidenceTagClass(f.confidence)}">${confidenceLabel(f.confidence)} (${f.confidence}%)</span></td>
        <td>${f.label}</td>
        <td class="mono muted">${f.description}</td>
        <td class="actions"><button type="button" class="btn btn--sm btn--ghost noread-jump" data-offset="${f.offset}">Hex</button></td>
      </tr>`;
    })
    .join('');

  return `<div class="table-wrap">
    <table class="data-table" id="noreadTable">
      <thead>
        <tr>
          <th></th>
          <th>Offset</th>
          <th>Tam.</th>
          <th>Conf.</th>
          <th>Tipo</th>
          <th>Detalhe</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
