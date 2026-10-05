export function nextZoom(current, delta, mode = 0) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? 400 : 1);
  return Math.max(1, Math.min(4, current * Math.exp(-Math.max(-400, Math.min(400, pixels)) * .0006)));
}
export function setupZoom() {
  const viewport = document.getElementById('previewViewport'), image = document.getElementById('previewImage'), label = document.getElementById('zoomReset');
  let scale = 1, width = 1, height = 1;
  function paint() {
    image.style.width = width * scale + 'px'; image.style.height = height * scale + 'px';
    label.textContent = scale === 1 ? '适屏' : Math.round(scale * 100) + '%';
  }
  function fit() {
    if (!viewport.clientWidth || !image.naturalWidth) return;
    const ratio = Math.min(viewport.clientWidth / image.naturalWidth, viewport.clientHeight / image.naturalHeight, 1);
    width = image.naturalWidth * ratio; height = image.naturalHeight * ratio; paint();
  }
  function change(value, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
    const oldWidth = width * scale, oldHeight = height * scale;
    const imageX = viewport.scrollLeft + x - Math.max(0, (viewport.clientWidth - oldWidth) / 2);
    const imageY = viewport.scrollTop + y;
    const ratio = value / scale; scale = value; paint();
    viewport.scrollLeft = imageX * ratio - x + Math.max(0, (viewport.clientWidth - width * scale) / 2);
    viewport.scrollTop = imageY * ratio - y;
  }
  function reset() {scale = 1; fit(); paint(); viewport.scrollTo(0, 0);}
  viewport.addEventListener('wheel', event => {
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    const r = viewport.getBoundingClientRect(); change(nextZoom(scale, event.deltaY, event.deltaMode), event.clientX - r.left, event.clientY - r.top);
  }, {passive: false});
  document.getElementById('zoomIn').onclick = () => change(Math.min(4, scale * 1.15));
  document.getElementById('zoomOut').onclick = () => change(Math.max(1, scale / 1.15));
  label.onclick = reset;
  new ResizeObserver(fit).observe(viewport);
  return {reset, fit};
}
