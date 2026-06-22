import { scanByteDiff, deserializeScanResult } from './diffEngine.js';

let worker;
let jobId = 0;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./diffWorker.js', import.meta.url), { type: 'module' });
  }
  return worker;
}

export function scanDiffAsync(a, b, onProgress) {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(
      scanByteDiff(a, b, 4096, (pct) => onProgress?.(pct))
    );
  }

  return new Promise((resolve, reject) => {
    const id = ++jobId;
    const w = getWorker();

    const handler = (e) => {
      if (e.data.id !== id) return;
      if (e.data.type === 'progress') onProgress?.(e.data.pct);
      if (e.data.type === 'done') {
        w.removeEventListener('message', handler);
        resolve(deserializeScanResult(e.data.result));
      }
      if (e.data.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(e.data.message));
      }
    };

    w.addEventListener('message', handler);
    w.postMessage({ id, a, b });
  });
}

export function terminateDiffWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
