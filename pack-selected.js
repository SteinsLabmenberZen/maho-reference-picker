import {fetchImage, makeZip, requestImageAccess} from './zip.js';
import {downloadPath, safeName} from './naming.js';
import {saveOutput} from './destination.js';
export function setupZip({getSelected, getFolder, getOptions, getRows, isBusy, setBusy, notify, destination}) {
  const button = document.getElementById('downloadZip'), stop = document.getElementById('stopZip');
  let controller, stopped = false;
  stop.onclick = () => {stopped = true; controller?.abort(); stop.disabled = true;};
  button.onclick = async () => {
    if (isBusy()) return notify('请等当前任务结束。');
    const list = getSelected().map(i => ({...i}));
    if (!list.length) return notify('先选中需要下载的图片。');
    if (list.length > 200) return notify('ZIP 每次最多 200 张，请分批选择。“保存所选图片”不受这个数量限制。');
    const options = getOptions(), folder = getFolder();
    const files = [], failures = [], manifest = [];
    let bytes = 0;
    const limit = 100 * 1024 * 1024;
    try {
      const target = destination.capture();
      // This call must remain in the original click gesture.
      const permission = requestImageAccess(list);
      stopped = false; button.disabled = true; stop.hidden = false; stop.disabled = false; setBusy(true);
      if (!await permission) throw new Error('没有授予图片网站访问权限。可以改用浏览器方式保存所选图片。');
      await destination.verify(target);
      for (let index = 0; index < list.length; index++) {
        if (stopped) break;
        const item = list[index];
        if (bytes >= limit) {failures.push({url: item.url, reason: 'ZIP 达到 100 MB 上限'}); continue;}
        notify('正在打包 ' + (index + 1) + ' / ' + list.length + ' · 已收集 ' + files.length + ' 张 · ' + (bytes / 1048576).toFixed(1) + ' MB');
        controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25000);
        try {
          const image = await fetchImage(item.url, {signal: controller.signal, maxBytes: Math.min(limit - bytes, 25 * 1024 * 1024)});
          const name = downloadPath(item, index, folder, {...options, extension: image.ext});
          files.push({name, data: image.bytes}); bytes += image.bytes.length;
          manifest.push({...getRows([item])[0], savedPath: name, bytes: image.bytes.length});
        } catch (error) {failures.push({url: item.url, sourcePage: item.sourcePage, reason: stopped ? '手动停止' : error.name === 'AbortError' ? '读取超时' : error.message});}
        finally {clearTimeout(timer);}
      }
      if (!files.length) throw new Error(stopped ? '已停止，尚未收集到可打包的图片。' : '没有获取到可打包的图片。可切换为“每次弹窗选择位置”后保存所选图片，或进入作品详情页重新提取。' + (failures[0] ? '\n' + failures[0].reason : ''));
      const summary = {tool: 'MAHO 拾图', version: 3, exportedAt: new Date().toISOString(), stopped, selected: list.length, saved: files.length, items: manifest, failures};
      files.push({name: '来源清单.json', data: new TextEncoder().encode(JSON.stringify(summary, null, 2))});
      files.push({name: '阅读我.txt', data: new TextEncoder().encode('MAHO 拾图\n图片保留下载时的原始字节。作者、作品页、个人分类和笔记见来源清单.json。\n选中 ' + list.length + ' 张，成功打包 ' + manifest.length + ' 张，失败 ' + failures.length + ' 张。' + (stopped ? '\n本次由用户提前停止，未处理项不在压缩包中。' : ''))});
      const zip = await makeZip(files);
      await destination.verify(target);
      const result = await saveOutput({target, blob: zip, path: 'MAHO 拾图/' + safeName(folder) + '.zip'});
      notify((result.kind === 'directory' ? `ZIP 已保存到“${target.directory.name}”：${result.path}，含 ` : 'ZIP 已提交浏览器下载：含 ') + manifest.length + ' 张图片和来源清单。' + (failures.length ? '\n' + failures.length + ' 张未能打包，原因已写入清单。' : '') + (stopped ? '\n已保存停止前获取的图片。' : ''));
    } catch (e) {notify(e.message, true);}
    finally {controller = null; stop.hidden = true; button.disabled = false; setBusy(false);}
  };
}
