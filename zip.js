// ZIP "store" writer. Images are already compressed; preserve bytes unchanged.
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({length: 256}, (_, i) => {
  let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0;
});
export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
export async function makeZip(entries) {
  if (entries.length > 65535) throw new Error('ZIP 文件数量过多');
  const parts = [], central = [], used = new Set();
  let offset = 0, directorySize = 0;
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('/') || entry.name.split('/').some(s => s === '..' || s === '.') || entry.name.includes('\\')) throw new Error('ZIP 路径无效');
    if (used.has(entry.name)) throw new Error('ZIP 文件名重复：' + entry.name);
    used.add(entry.name);
    const name = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(await entry.data.arrayBuffer());
    if (name.length > 65535 || data.length + offset > 0xffffffff) throw new Error('ZIP 内容过大');
    const crc = crc32(data), local = new Uint8Array(30), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint16(12, 33, true); // 1980-01-01
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true);
    const directory = new Uint8Array(46), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true);
    d.setUint16(14, 33, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true);
    d.setUint16(28, name.length, true); d.setUint32(42, offset, true);
    parts.push(local, name, data); central.push(directory, name);
    offset += local.length + name.length + data.length; directorySize += directory.length + name.length;
  }
  const end = new Uint8Array(22), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true);
  v.setUint32(12, directorySize, true); v.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], {type: 'application/zip'});
}

export function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.slice(0,8).join(',') === '137,80,78,71,13,10,26,10') return 'png';
  const text = new TextDecoder().decode(bytes.slice(0, 512));
  if (/^GIF8[79]a/.test(text)) return 'gif';
  if (text.startsWith('RIFF') && text.slice(8,12) === 'WEBP') return 'webp';
  if (text.slice(4,8) === 'ftyp' && /avif|avis/.test(text.slice(8,40))) return 'avif';
  if (text.startsWith('BM')) return 'bmp';
  // SVG is not packed: remote SVG can contain active external references.
  return '';
}
export async function fetchImage(url, {signal, maxBytes = 25 * 1024 * 1024} = {}) {
  const response = await fetch(url, {credentials: 'include', redirect: 'follow', signal});
  if (!response.ok) throw new Error('HTTP ' + response.status);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('单图超过 25 MB');
  if (!response.body) throw new Error('图片内容为空');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {await reader.cancel(); throw new Error('单图或剩余 ZIP 容量超限');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) {bytes.set(chunk, at); at += chunk.length;}
  const ext = imageType(bytes);
  if (!ext) throw new Error('未获取到支持的图片文件（SVG 请切换为浏览器保存方式）');
  return {bytes, ext};
}

// Call directly from a click handler, before awaiting any other work.
export function requestImageAccess(items) {
  const origins = [...new Set(items.filter(item => /^https?:/.test(item.url)).map(item => {
    const url = new URL(item.url);
    return url.protocol + '//' + url.hostname + '/*';
  }))];
  return origins.length ? chrome.permissions.request({origins}) : Promise.resolve(true);
}
