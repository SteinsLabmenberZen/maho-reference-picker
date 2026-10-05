import {readDestination, writeDestination} from './destination-store.js';
import {safeName} from './naming.js';

export function relativeOutputPath(path, mode) {
  const parts = String(path).split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\\u0000-\u001f<>:"|?*]/.test(part))) {
    throw new Error('保存路径无效，请修改本次文件夹名称。');
  }
  if (mode === 'ask') return parts.at(-1);
  if (mode === 'directory' && parts[0] === 'MAHO 拾图') parts.shift();
  if (!parts.length) throw new Error('保存路径不能为空。');
  return parts.join('/');
}

export async function verifyDirectory(directory) {
  if (!directory || await directory.queryPermission({mode: 'readwrite'}) !== 'granted') {
    throw new Error('请先点击“允许写入此文件夹”，再开始保存。');
  }
}

let writeChain = Promise.resolve();
function serializeWrite(operation) {
  // Web Locks serialize writes across this extension's tabs as well.
  if (globalThis.navigator?.locks) return navigator.locks.request('maho-picker-file-write', operation);
  const result = writeChain.catch(() => {}).then(operation);
  writeChain = result;
  return result;
}
export async function writeUniqueFile(directory, path, data) {
  const parts = relativeOutputPath(path, 'browser').split('/');
  await verifyDirectory(directory);
  return serializeWrite(async () => {
    let parent = directory;
    for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, {create: true});
    const original = parts.at(-1), dot = original.lastIndexOf('.');
    const stem = dot > 0 ? original.slice(0, dot) : original;
    const extension = dot > 0 ? original.slice(dot) : '';
    for (let number = 0; number < 10000; number++) {
      const name = number ? `${stem} (${number})${extension}` : original;
      try {await parent.getFileHandle(name); continue;}
      catch (error) {
        if (error.name === 'TypeMismatchError') continue; // A folder already uses that name.
        if (error.name !== 'NotFoundError') throw error;
      }
      const file = await parent.getFileHandle(name, {create: true});
      let stream;
      try {
        stream = await file.createWritable();
        await stream.write(data);
        await stream.close();
      } catch (error) {
        try {await stream?.abort();} catch {}
        // Only remove the empty placeholder created by this failed write.
        try {if ((await file.getFile()).size === 0) await parent.removeEntry(name);} catch {}
        throw error;
      }
      return [...parts.slice(0, -1), name].join('/');
    }
    throw new Error('同名文件过多，请更换本次文件夹名称。');
  });
}

export async function saveOutput({target, path, blob, url}, api = globalThis.chrome?.downloads) {
  const filename = relativeOutputPath(path, target.mode);
  if (target.mode === 'directory') {
    if (blob === undefined) throw new Error('指定文件夹保存需要先读取图片内容。');
    const savedPath = await writeUniqueFile(target.directory, filename, blob);
    return {kind: 'directory', path: savedPath};
  }
  const ownedUrl = blob !== undefined ? URL.createObjectURL(blob) : null;
  try {
    const id = await api.download({url: ownedUrl || url, filename, conflictAction: 'uniquify', saveAs: target.mode === 'ask'});
    return {kind: 'download', id, path: filename};
  } finally {
    if (ownedUrl) {
      const timer = setTimeout(() => URL.revokeObjectURL(ownedUrl), 120000);
      timer.unref?.();
    }
  }
}

export function setupDestination({getFolder, getGrouping, isBusy, notify, onChange = () => {},
  document = globalThis.document, window = globalThis.window,
  store = {read: readDestination, write: writeDestination}}) {
  const $ = id => document.getElementById(id);
  const supportsFolders = typeof window.showDirectoryPicker === 'function';
  let mode = 'browser', directory = null, permission = 'prompt', loaded = false, pending = false;
  function update() {
    $('saveMode').value = mode;
    $('saveMode').disabled = !loaded || pending || isBusy();
    $('chooseDirectory').disabled = !supportsFolders || !loaded || pending || isBusy();
    $('chooseDirectory').textContent = directory ? '更换文件夹…' : '选择文件夹…';
    $('authorizeDirectory').hidden = mode !== 'directory' || !directory || permission === 'granted' || !supportsFolders;
    $('authorizeDirectory').disabled = pending || isBusy();
    let status;
    if (!loaded) status = '正在读取保存设置…';
    else if (mode === 'directory') status = !supportsFolders ? '此浏览器无法直接选择文件夹，请切换为“每次弹窗选择位置”。'
      : !directory ? '点击“选择文件夹”，选一个你自己的素材文件夹。'
      : `素材文件夹：${directory.name} · ${permission === 'granted' ? '可以保存' : '需要允许写入'}`;
    else if (mode === 'ask') status = '每个文件分别弹出保存窗口；批量收图建议选定文件夹，或打包 ZIP 后只选一次位置。';
    else status = '保存到浏览器设置中的默认下载目录。你也可以点击“选择文件夹”，单独指定素材位置。';
    $('destinationStatus').textContent = status;
    const group = getGrouping() === 'none' ? '' : getGrouping() === 'site' ? ' / 来源网站' : ' / 我的分类';
    const root = mode === 'directory' ? directory?.name || '所选文件夹' : '浏览器下载目录 / MAHO 拾图';
    $('destinationPreview').textContent = mode === 'ask' ? '保存窗口中选择的路径为准；此方式不自动创建分类子文件夹。'
      : `图片：${root} / ${safeName(getFolder(), '绘画参考')}${group} / 图片文件；ZIP 保存在${mode === 'directory' ? '所选文件夹' : '“MAHO 拾图”文件夹'}中。`;
  }
  async function persist() {
    try {await store.write({mode, directory});}
    catch {notify('本页可继续使用，但保存位置未能记住；下次打开需要重新设置。', true);}
  }
  const ready = (async () => {
    try {
      const saved = await store.read();
      if (['browser', 'ask', 'directory'].includes(saved?.mode)) mode = saved.mode;
      if (saved?.directory?.kind === 'directory') {
        directory = saved.directory;
        permission = await directory.queryPermission({mode: 'readwrite'});
      }
    } catch {notify('保存位置读取失败，请重新选择文件夹。', true);}
    finally {loaded = true; update(); onChange();}
  })();
  $('saveMode').onchange = async () => {
    if (isBusy() || pending) return update();
    mode = ['browser', 'ask', 'directory'].includes($('saveMode').value) ? $('saveMode').value : 'browser';
    pending = true; update(); onChange();
    await persist(); pending = false; update(); onChange();
  };
  $('chooseDirectory').onclick = async () => {
    if (isBusy() || pending || !loaded) return;
    if (!supportsFolders) return notify('请选择“每次弹窗选择位置”。', true);
    pending = true; update(); onChange();
    try {
      // Do not await storage or network work before this user-gesture API.
      const chosen = await window.showDirectoryPicker({id: 'maho-materials', mode: 'readwrite', startIn: directory || 'pictures'});
      const granted = await chosen.queryPermission({mode: 'readwrite'});
      directory = chosen; permission = granted; mode = 'directory';
      notify(`已选择“${directory.name}”。图片、ZIP 和来源清单都会使用这个位置。`);
      await persist();
    } catch (error) {
      if (error.name === 'AbortError') notify('已取消选择，保留原保存位置。');
      else notify('未能选择文件夹：' + error.message + '。可改用“每次弹窗选择位置”。', true);
    } finally {pending = false; update(); onChange();}
  };
  $('authorizeDirectory').onclick = async () => {
    if (!directory || isBusy() || pending) return;
    pending = true; update(); onChange();
    try {
      permission = await directory.requestPermission({mode: 'readwrite'});
      notify(permission === 'granted' ? '已允许写入，可以开始保存。' : '尚未允许写入；可以重新授权或选择其他保存方式。');
    } catch (error) {notify('无法授权此文件夹：' + error.message, true);}
    finally {pending = false; update(); onChange();}
  };
  update();
  return {
    ready, update,
    get pending() {return pending || !loaded;},
    capture() {
      if (pending || !loaded) throw new Error('请等保存位置设置完成。');
      if (mode === 'directory') {
        if (!supportsFolders) throw new Error('请切换为“每次弹窗选择位置”。');
        if (!directory) throw new Error('请先点击“选择文件夹”。');
        if (permission !== 'granted') throw new Error('请先点击“允许写入此文件夹”。');
      }
      return {mode, directory: mode === 'directory' ? directory : null};
    },
    async verify(target) {
      if (target.mode !== 'directory') return;
      try {await verifyDirectory(target.directory);}
      catch (error) {if (directory === target.directory) {permission = 'prompt'; update();} throw error;}
    }
  };
}
