import {escapeVariable} from './vendor/picka-escape.js';
export function safeName(value, fallback = '参考图') {
  const text = escapeVariable(String(value || '').normalize('NFKC'), {unicode: false, escapeZWJ: true}).replace(/^[.\s]+|[.\s]+$/g, '');
  if (!text) return fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(text) ? '_' + text : text;
}
export function originalName(url) {
  try {return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\.[a-z0-9]{1,6}$/i, '');} catch {return '';}
}
export function downloadPath(item, index, folder, {naming = 'title', grouping = 'category', extension = ''} = {}) {
  let title = item.alt || item.sourceTitle || '参考图';
  if (naming === 'original') title = originalName(item.url) || title;
  if (naming === 'date') title = new Date().toLocaleDateString('sv-SE');
  let group = '';
  if (grouping === 'category') group = safeName(item.category, '未分类') + '/';
  if (grouping === 'site') {try {group = safeName(new URL(item.sourcePage || item.url).hostname) + '/';} catch {group = '其他/';}}
  const suffix = extension && /^[a-z0-9]{2,5}$/.test(extension) ? '.' + extension : '';
  return 'MAHO 拾图/' + safeName(folder, '绘画参考') + '/' + group + String(index + 1).padStart(3, '0') + '-' + safeName(title) + suffix;
}
