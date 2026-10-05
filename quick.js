// Image selection priorities are adapted from Image Picka image-util.js (MIT).
// Copyright (c) 2017 eight. See licenses/Image-Picka-MIT.txt and THIRD-PARTY.md.
export function installQuickMode() {
  const key = '__MAHO_QUICK_COLLECTOR_V3__';
  if (globalThis[key]) {globalThis[key](); return {enabled: false};}
  const abort = new AbortController(), opts = {capture: true, signal: abort.signal};
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({mode: 'closed'});
  const style = document.createElement('style');
  style.textContent = ':host{all:initial}button{font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif;cursor:pointer;border:1px solid #b8b0ff;border-radius:10px;background:#17313b;color:#e0f1f8;padding:10px 14px;pointer-events:auto}button:focus-visible{outline:3px solid #b8b0ff}.bar{position:fixed;right:22px;bottom:22px;pointer-events:auto;background:#10242d;color:#dcf1f8;border:1px solid #35515d;border-radius:14px;box-shadow:0 8px 35px #0005;padding:14px;max-width:330px;font:12px/1.6 system-ui,"Microsoft YaHei",sans-serif}.bar p{margin:0 0 9px;white-space:pre-line}.bar button{padding:6px 10px;margin-right:6px}.hover{position:fixed;background:#b8b0ff;color:#17242d;box-shadow:0 3px 15px #0004}.drop{border-color:#b8b0ff;background:#253546}[hidden]{display:none!important}';
  const bar = document.createElement('div'); bar.className = 'bar';
  const text = document.createElement('p'); text.textContent = '随手收集已开启\n悬停点「＋收集」、Alt + 点击图片，或把图片拖到这里。';
  const open = document.createElement('button'); open.textContent = '打开收集篮';
  const close = document.createElement('button'); close.textContent = '结束收集';
  const hover = document.createElement('button'); hover.className = 'hover'; hover.textContent = '＋ 收集'; hover.hidden = true;
  bar.append(text, open, close); root.append(style, bar, hover); document.documentElement.append(host);
  let current = null, dragging = null;
  const cleanup = () => {abort.abort(); host.remove(); delete globalThis[key];};
  globalThis[key] = cleanup; close.onclick = cleanup;
  const imageAt = event => event.composedPath().find(n => n?.localName === 'img' || n?.localName === 'input' && n.type === 'image');
  function itemFor(img) {
    let raw = img.getAttribute('data-original') || img.getAttribute('data-original-src') || '', best = 0;
    // Prefer the largest declared srcset candidate, like Image Picka. No URL guessing.
    if (!raw) {
      let input = img.srcset || img.closest('picture')?.querySelector('source[srcset]')?.srcset || '';
      while (input) {
        input = input.replace(/^[\s,]+/, ''); const token = input.match(/^\S+/)?.[0]; if (!token) break;
        input = input.slice(token.length); let url = token, descriptor = '';
        if (url.endsWith(',')) url = url.replace(/,+$/, '');
        else {const at = input.indexOf(','); descriptor = at < 0 ? input : input.slice(0, at); input = at < 0 ? '' : input.slice(at + 1);}
        const value = Number(descriptor.trim().match(/^(\d+(?:\.\d+)?)[wx]$/)?.[1] || 1);
        if (value > best) {best = value; raw = url;}
      }
    }
    raw ||= img.currentSrc || img.src;
    const link = img.closest('a[href]');
    if (link && /^[^?#]+\.(jpe?g|png|gif|webp|avif)(?:$|[?#])/i.test(link.href)) raw = link.href;
    const url = new URL(raw, img.ownerDocument.baseURI).href;
    const known = url === (img.currentSrc || img.src);
    return {url, width: known ? img.naturalWidth : 0, height: known ? img.naturalHeight : 0, alt: img.alt || img.title || '', detailPage: link?.href || ''};
  }
  async function collect(img) {
    if (!img) return;
    try {
      const reply = await chrome.runtime.sendMessage({type: 'quick-add', item: itemFor(img)});
      if (!reply?.ok) throw new Error(reply?.error || '无法收集，请刷新网页重新开启。');
      text.textContent = (reply.result.duplicate ? '这张已经收过了。' : '已加入收集篮。') + '\n当前 ' + reply.result.count + ' 张 · 继续浏览，稍后一起整理。';
      hover.textContent = '✓ 已收集';
    } catch (e) {text.textContent = e.message;}
  }
  hover.onclick = event => {if (event.isTrusted) void collect(current);};
  open.onclick = async () => {
    const reply = await chrome.runtime.sendMessage({type: 'quick-open'});
    if (!reply?.ok) text.textContent = reply?.error || '无法打开收集篮。';
  };
  document.addEventListener('pointerover', event => {
    if (event.composedPath().includes(host)) return;
    const img = imageAt(event);
    if (!img) {hover.hidden = true; current = null; return;}
    const rect = img.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) return;
    current = img; hover.textContent = '＋ 收集'; hover.hidden = false;
    hover.style.left = Math.min(Math.max(8, rect.right - 92), innerWidth - 100) + 'px';
    hover.style.top = Math.min(Math.max(8, rect.top + 8), innerHeight - 50) + 'px';
  }, opts);
  document.addEventListener('click', event => {
    const img = imageAt(event);
    if (event.isTrusted && event.altKey && img) {event.preventDefault(); event.stopImmediatePropagation(); void collect(img);}
  }, opts);
  document.addEventListener('dragstart', event => {if (event.isTrusted) dragging = imageAt(event);}, opts);
  bar.ondragover = event => {if (dragging) {event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; bar.classList.add('drop');}};
  bar.ondragleave = () => bar.classList.remove('drop');
  bar.ondrop = event => {if (event.isTrusted && dragging) {event.preventDefault(); void collect(dragging);} bar.classList.remove('drop'); dragging = null;};
  document.addEventListener('dragend', () => {dragging = null; bar.classList.remove('drop');}, opts);
  window.addEventListener('scroll', () => {hover.hidden = true;}, {...opts, passive: true});
  document.addEventListener('keydown', event => {if (event.key === 'Escape') cleanup();}, opts);
  return {enabled: true};
}
