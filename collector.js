// Self-contained: Chrome serializes this function into the granted page.
export function scanPage(options = {}) {
  if (options.origin && location.origin !== options.origin) throw new Error('原页面已跳转到另一网站，请在新页面重新点击扩展图标。');
  const found = new Map(); let skippedBlob = 0, capped = false, payloadSize = 0;
  const page = location.href, title = document.title.slice(0, 300);
  let documents = 1, shadowRoots = 0, blockedFrames = 0;
  function add(raw, element, kind, hint = 0) {
    if (!raw || typeof raw !== 'string') return;
    let url; try { url = new URL(raw.trim(), element?.ownerDocument?.baseURI || document.baseURI); } catch { return; }
    if (url.protocol === 'blob:') { skippedBlob++; return; }
    if (!['http:', 'https:', 'data:'].includes(url.protocol) || url.username || url.password) return;
    if (url.protocol === 'data:' && (!/^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(raw) || raw.length > 1500000)) return;
    if(url.protocol !== 'data:') url.hash = '';
    const key = url.href;
    if(key.length>1500000 || (url.protocol!=='data:' && key.length>12000))return;
    const rect = element?.getBoundingClientRect?.();
    const inView = !!rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    const current = element?.currentSrc || element?.src;
    const known = ['IMG','INPUT'].includes(element?.tagName) && current === key;
    const prior = found.get(key);
    if (prior) { prior.inView ||= inView; prior.hint = Math.max(prior.hint, hint); if(!prior.kinds.includes(kind))prior.kinds.push(kind); return; }
    if (found.size >= 1500 || payloadSize + key.length + page.length + title.length + 1200 > 4500000) { capped = true; return; }
    payloadSize += key.length + page.length + title.length + 1200;
    const link = element?.closest?.('a[href]');
    let detail = ''; try { const u = new URL(link?.href || '', page); if(link && /^https?:$/.test(u.protocol)) detail = u.href; } catch {}
    found.set(key, {url:key,width:known ? element.naturalWidth || 0 : 0,height:known ? element.naturalHeight || 0 : 0,
      alt:(element?.alt || element?.title || '').slice(0, 400),kinds:[kind],inView,hint,sourcePage:element?.ownerDocument?.URL || page,sourceTitle:(element?.ownerDocument?.title || title).slice(0,300),detailPage:detail,category:'未分类'});
  }
  function srcset(value, el) {
    // URLs may contain commas. Descriptors are read separately from URL tokens.
    let input = value || '';
    while (input) {
      input = input.replace(/^[\s,]+/, ''); if(!input)break;
      const token = input.match(/^\S+/)?.[0]; if(!token)break;
      input = input.slice(token.length);
      let raw = token, descriptor = '';
      if(raw.endsWith(','))raw=raw.replace(/,+$/, '');
      else { const end = input.indexOf(','); descriptor = end < 0 ? input : input.slice(0,end); input = end < 0 ? '' : input.slice(end+1); }
      const match=descriptor.trim().match(/^(\d+)w$/);
      add(raw,el,'候选大图',match?Number(match[1]):0);
    }
  }
  const roots = [{root: document, depth: 0}], seen = new Set();
  let checked = 0;
  while (roots.length && checked < 20000 && found.size < 1500) {
    const {root, depth} = roots.shift();
    if (seen.has(root)) continue;
    seen.add(root);
    for (const el of root.querySelectorAll('*')) {
      if (++checked > 20000) {capped = true; break;}
      const image = el.localName === 'img' || el.localName === 'input' && el.type === 'image';
      if (image) {
        add(el.currentSrc || el.src, el, '页面图片'); add(el.getAttribute('src'), el, '页面图片');
        if (options.candidates !== false) {
          for (const key of ['data-src','data-original','data-original-src','data-lazy-src','data-url']) add(el.getAttribute(key),el,'懒加载');
          srcset(el.getAttribute('srcset'),el); srcset(el.getAttribute('data-srcset'),el);
          for (const source of el.closest('picture')?.querySelectorAll('source[srcset]') || []) srcset(source.getAttribute('srcset'),el);
        }
      }
      if (options.candidates !== false && el.localName === 'a' && /\.(?:jpe?g|png|webp|gif|avif|svg)(?:[?#]|$)/i.test(el.href)) add(el.href,el,'原图链接');
      if (options.backgrounds) {
        const background = el.ownerDocument.defaultView.getComputedStyle(el).backgroundImage;
        for (const match of background.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) add(match[1]||match[2]||match[3],el,'背景图片');
      }
      if (depth < 4 && el.shadowRoot) {roots.push({root: el.shadowRoot, depth: depth+1}); shadowRoots++;}
      if (depth < 4 && el.localName === 'iframe') {
        try {
          const doc = el.contentDocument;
          if (doc?.documentElement && (!doc.location.origin || doc.location.origin === 'null' || doc.location.origin === location.origin)) {roots.push({root: doc, depth: depth+1}); documents++;}
          else blockedFrames++;
        } catch {blockedFrames++;}
      }
    }
  }
  if (roots.length) capped = true;
  return {page,title,items:[...found.values()],skippedBlob,capped,documents,shadowRoots,blockedFrames,scannedAt:new Date().toISOString()};
}
