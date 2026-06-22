/** Base path para GitHub Pages (ex.: /ecu-map-diff). Vazio na raiz ou file:// */
export function getBasePath() {
  const script = document.querySelector('script[data-base]');
  if (script?.dataset.base !== undefined) return script.dataset.base;
  if (location.hostname.endsWith('github.io')) {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return seg ? `/${seg}` : '';
  }
  return '';
}

export function assetUrl(path) {
  const base = getBasePath();
  const clean = path.replace(/^\//, '');
  return base ? `${base}/${clean}` : clean;
}
