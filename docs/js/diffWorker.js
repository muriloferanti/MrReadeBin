import { scanByteDiff, serializeScanResult } from './diffEngine.js';

self.onmessage = (e) => {
  const { id, a, b } = e.data;
  try {
    const aView = new Uint8Array(a);
    const bView = new Uint8Array(b);
    const result = scanByteDiff(aView, bView, 4096, (pct) => {
      self.postMessage({ id, type: 'progress', pct });
    });
    self.postMessage({ id, type: 'done', result: serializeScanResult(result) });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err?.message || String(err) });
  }
};
