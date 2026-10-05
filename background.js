import {scanPage} from './collector.js';
import {installQuickMode} from './quick.js';
import {safeUrl} from './core.js';

const pageUrl = name => chrome.runtime.getURL(name);
let inboxChain = Promise.resolve();

async function openPicker(session) {
  const key = 'capture:' + session.id;
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('capture:'));
  if (keys.length > 4) await chrome.storage.session.remove(keys.slice(0, keys.length - 4));
  await chrome.storage.session.set({[key]: session});
  await chrome.tabs.create({url: pageUrl('picker.html') + '?capture=' + session.id});
  return {count: session.items.length};
}
async function scanTabs(ids, options = {}) {
  const unique = [...new Set(ids)].filter(Number.isInteger).slice(0, 12);
  if (!unique.length) throw new Error('请先选择网页。');
  const session = {id: crypto.randomUUID(), items: [], errors: [], sources: [], scannedAt: new Date().toISOString()};
  let budget = 0;
  for (const tabId of unique) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!/^https?:\/\//.test(tab.url || '')) throw new Error('仅支持普通 HTTP / HTTPS 网页');
      const origin = new URL(tab.url).origin;
      const [{result}] = await chrome.scripting.executeScript({target: {tabId}, func: scanPage, args: [{origin, candidates: true, ...options}]});
      if (!result) throw new Error('页面未返回图片');
      session.sources.push({tabId, origin, page: result.page, title: result.title});
      for (const item of result.items) {
        const size = JSON.stringify(item).length;
        if (session.items.length >= 1500 || budget + size > 4500000) {session.capped = true; break;}
        session.items.push(item); budget += size;
      }
      session.capped ||= result.capped;
      session.skippedBlob = (session.skippedBlob || 0) + result.skippedBlob;
    } catch (error) {session.errors.push('页面 ' + tabId + '：' + error.message);}
  }
  if (!session.sources.length) throw new Error(session.errors.join('\n') || '无法读取网页');
  const first = session.sources[0];
  Object.assign(session, {page: first.page, title: session.sources.length > 1 ? session.sources.length + ' 个页面的参考' : first.title});
  if (session.sources.length === 1) Object.assign(session, {tabId: first.tabId, origin: first.origin});
  return openPicker(session);
}
function addInbox(raw, tab) {
  inboxChain = inboxChain.catch(() => {}).then(async () => {
    const url = safeUrl(raw.url);
    if (!url || url.startsWith('data:')) throw new Error('这张图暂不能快收，请用整页提取或网页另存为。');
    const {inbox = []} = await chrome.storage.local.get('inbox');
    if (inbox.some(i => i.url === url)) return {count: inbox.length, duplicate: true};
    if (inbox.length >= 500) throw new Error('收集篮已满，请先整理或清空。');
    const item = {url, width: Math.max(0, Number(raw.width) || 0), height: Math.max(0, Number(raw.height) || 0), alt: String(raw.alt || '').slice(0, 400), sourcePage: safeUrl(tab.url) || '', sourceTitle: String(tab.title || '').slice(0, 300), detailPage: safeUrl(raw.detailPage) || '', kinds: ['随手收集'], category: '未分类', selected: true, inView: true};
    if (JSON.stringify([...inbox, item]).length > 4000000) throw new Error('收集篮空间已满，请先导出整理。');
    inbox.push(item);
    await chrome.storage.local.set({inbox});
    await chrome.action.setBadgeText({text: String(inbox.length)});
    await chrome.action.setBadgeBackgroundColor({color: '#7870B9'});
    return {count: inbox.length};
  });
  return inboxChain;
}
chrome.runtime.onInstalled.addListener(async () => {
  await new Promise(resolve => chrome.contextMenus.removeAll(resolve));
  chrome.contextMenus.create({id: 'maho-save-image', title: '收进 MAHO 素材篮', contexts: ['image']});
  chrome.contextMenus.create({id: 'maho-scan-page', title: '用 MAHO 提取本页图片', contexts: ['page']});
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const work = info.menuItemId === 'maho-save-image' ? addInbox({url: info.srcUrl, detailPage: info.linkUrl}, tab) : scanTabs([tab.id]);
  work.catch(async error => {
    await chrome.storage.local.set({lastError: error.message});
    await chrome.action.setBadgeText({text: '!'});
  });
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'quick-add' && sender.tab && /^https?:/.test(sender.url || '')) {
    addInbox(message.item || {}, sender.tab).then(result => reply({ok: true, result})).catch(e => reply({ok: false, error: e.message}));
    return true;
  }
  if (message?.type === 'quick-open' && sender.tab && /^https?:/.test(sender.url || '')) {
    inboxChain.catch(() => {}).then(async () => {
      const {inbox = []} = await chrome.storage.local.get('inbox');
      if (!inbox.length) throw new Error('收集篮还是空的。');
      return openPicker({id: crypto.randomUUID(), page: '', title: '随手收集 · 素材篮', items: inbox, scannedAt: new Date().toISOString()});
    }).then(result => reply({ok: true, result})).catch(e => reply({ok: false, error: e.message}));
    return true;
  }
  const trusted = ['popup.html', 'picker.html'].some(file => sender.url?.split('?')[0] === pageUrl(file));
  if (!trusted) return;
  (async () => {
    if (message.type === 'capture-tabs') return scanTabs(message.tabIds || [], message.options);
    if (message.type === 'quick-mode') {
      const tab = await chrome.tabs.get(message.tabId);
      if (!/^https?:/.test(tab.url || '')) throw new Error('请在普通网页启用随手收集。');
      const [{result}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: installQuickMode});
      return result;
    }
    if (message.type === 'open-inbox') {
      await inboxChain.catch(() => {});
      const {inbox = []} = await chrome.storage.local.get('inbox');
      if (!inbox.length) throw new Error('收集篮还是空的。试试图片右键或随手收集。');
      return openPicker({id: crypto.randomUUID(), page: '', title: '随手收集 · 素材篮', items: inbox, scannedAt: new Date().toISOString()});
    }
    if (message.type === 'clear-inbox') {
      inboxChain = inboxChain.catch(() => {}).then(async () => {await chrome.storage.local.set({inbox: []}); await chrome.action.setBadgeText({text: ''});});
      await inboxChain; return {};
    }
    if (message.type === 'scan') {
      if (!Number.isInteger(message.tabId) || !/^https?:/.test(message.origin || '')) throw new Error('来源页面无效');
      const [{result}] = await chrome.scripting.executeScript({target: {tabId: message.tabId}, func: scanPage, args: [{origin: message.origin, candidates: !!message.candidates, backgrounds: !!message.backgrounds}]});
      return result;
    }
    throw new Error('未知操作');
  })().then(result => reply({ok: true, result})).catch(e => reply({ok: false, error: e.message || '操作失败'}));
  return true;
});
