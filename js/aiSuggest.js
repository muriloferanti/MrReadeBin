import { getProviderConfig } from './aiSettings.js';
import { findMapsForRegion } from './mappack.js';

const SYSTEM_PROMPT = `Você é um especialista em calibração de ECUs Bosch MED17/EDC17.
Analise diferenças entre dois arquivos binários (original vs modificado) com base nos metadados, regiões e — quando fornecido — definições de mappack (nomes de mapas conhecidos: boost, torque, ignição, injeção, etc.).
Nunca invente offsets ou valores que não estejam nos dados.
Se o mappack identificar mapas em uma região, use esses nomes e categorias como evidência principal.

Responda em português do Brasil, em markdown, com esta estrutura:
## Resumo geral
(2-4 frases sobre o tipo de modificação provável)

## Regiões analisadas
Para cada região relevante:
### Região N — 0xOFFSET
- **Tipo provável:** (mapa, limite, checksum, texto, desconhecido…)
- **O que mudou:** (descreva padrão dos valores U16)
- **Hipótese:** (ex.: limite de torque, smoke map, DPF/EGR, pop & bang — seja cauteloso)
- **Confiança:** baixa / média / alta

## Recomendações
- O que validar no WinOLS ou similar
- Riscos ou incompatibilidades (SW diferente, checksum, etc.)

Seja técnico mas acessível. Se dados forem insuficientes, diga claramente.`;

export function buildAnalysisPayload(metaA, metaB, regions, diffResult, options = {}) {
  const maxRegions = options.maxRegions ?? 25;
  const mappack = options.mappack || null;
  const sorted = [...regions].sort((a, b) => {
    if (a.type === 'calibration' && b.type !== 'calibration') return -1;
    if (b.type === 'calibration' && a.type !== 'calibration') return 1;
    return b.length - a.length;
  });

  const picked = sorted.slice(0, maxRegions);
  const sim =
    (1 - diffResult.diffs.length / Math.min(diffResult.lenA, diffResult.lenB)) * 100;

  return {
    context: 'Comparação de bins ECU Bosch — apenas metadados e regiões alteradas (sem dump completo)',
    fileA: {
      name: metaA.fileName,
      size: metaA.size,
      sw: metaA.swVersion,
      hw: metaA.hwNumbers,
      ecuId: metaA.ecuId,
      engine: metaA.engine,
    },
    fileB: {
      name: metaB.fileName,
      size: metaB.size,
      sw: metaB.swVersion,
      hw: metaB.hwNumbers,
      ecuId: metaB.ecuId,
      engine: metaB.engine,
    },
    summary: {
      totalDiffBytes: diffResult.diffs.length,
      totalRegions: regions.length,
      regionsInPrompt: picked.length,
      similarityPct: sim.toFixed(2),
      sizeMismatch: diffResult.sizeMismatch,
    },
    regions: picked.map((r, i) => {
      const knownMaps = mappack
        ? findMapsForRegion(mappack, r.start, r.end).map((m) => ({
            name: m.name,
            category: m.category,
            description: m.description,
            unit: m.unit,
            factor: m.factor,
          }))
        : [];
      return {
      index: i + 1,
      start: `0x${r.start.toString(16).toUpperCase()}`,
      end: `0x${r.end.toString(16).toUpperCase()}`,
      lengthBytes: r.length,
      sectionType: r.type,
      bytesChanged: r.items.length,
      avgWordDeltaU16: Number(r.avgDelta.toFixed(1)),
      uniformDelta: r.uniformDelta,
      knownMaps,
      sampleWordChanges: r.wordChanges.slice(0, 12).map((w) => ({
        offset: `0x${w.offset.toString(16).toUpperCase()}`,
        original: w.a,
        modified: w.b,
        delta: w.delta,
      })),
    };
    }),
    mappack: mappack
      ? { name: mappack.name, ecu: mappack.ecu, sw: mappack.sw, mapCount: mappack.maps?.length }
      : null,
    userQuestion: options.question || 'O que essas alterações provavelmente representam no mapa da ECU?',
  };
}

async function callOpenAi(settings, userContent) {
  const base = settings.provider === 'openai_compat'
    ? settings.baseUrl.replace(/\/$/, '')
    : getProviderConfig(settings.provider).baseUrl;
  const model = settings.model || getProviderConfig(settings.provider).defaultModel;

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(err) || `OpenAI API: ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(settings, userContent) {
  const model = settings.model || getProviderConfig('anthropic').defaultModel;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(err) || `Anthropic API: ${res.status}`);
  }
  const data = await res.json();
  return data.content?.map((c) => c.text).join('') || '';
}

async function callGemini(settings, userContent) {
  const model = settings.model || getProviderConfig('gemini').defaultModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(parseApiError(err) || `Gemini API: ${res.status}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
}

function parseApiError(raw) {
  try {
    const j = JSON.parse(raw);
    return j.error?.message || j.message || raw.slice(0, 200);
  } catch {
    return raw.slice(0, 200);
  }
}

export async function requestAiAnalysis(settings, payload) {
  const userContent = JSON.stringify(payload, null, 2);

  switch (settings.provider) {
    case 'anthropic':
      return callAnthropic(settings, userContent);
    case 'gemini':
      return callGemini(settings, userContent);
    case 'openai':
    case 'openai_compat':
    default:
      return callOpenAi(settings, userContent);
  }
}

export function renderMarkdownLite(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(.+)$/gm, (line) => {
      if (/^<[hul]/.test(line)) return line;
      if (line.trim() === '') return '';
      return `<p>${line}</p>`;
    });
}
