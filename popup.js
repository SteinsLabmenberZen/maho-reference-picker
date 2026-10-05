const $ = id => document.getElementById(id);
let active, tabs = [];
function status(text) {$('status').textContent = text;}
async function message(type, data = {}) {
  const response = await chrome.runtime.sendMessage({type, ...data});
  if (!response?.ok) throw new Error(response?.error || '操作未完成，请重新打开插件。');
  return response.result;
}
async function perform(button, work, close = true) {
  button.disabled = true; status('正在处理…');
  try {await work(); if (close) window.close(); else status('已完成。');}
  catch (e) {status(e.message);}
  finally {button.disabled = false;}
}
$('scan').onclick = () => perform($('scan'), () => message('capture-tabs', {tabIds: [active?.id]}));
$('quick').onclick = () => perform($('quick'), () => message('quick-mode', {tabId: active?.id}));
$('inbox').onclick = () => perform($('inbox'), () => message('open-inbox'));
$('history').onclick = () => chrome.tabs.create({url: chrome.runtime.getURL('picker.html')});
$('clearInbox').onclick = () => {
  if (!confirm('清空收集篮？已保存的整理批次和下载文件会保留。')) return;
  void perform($('clearInbox'), async () => {await message('clear-inbox'); $('inboxCount').textContent = '已收集 0 张';}, false);
};
$('multi').onclick = async () => {
  try {
    const granted = await chrome.permissions.request({permissions: ['tabs']});
    if (!granted) return status('未授予页面列表权限，仍可使用当前页提取。');
    tabs = (await chrome.tabs.query({currentWindow: true})).filter(t => /^https?:\/\//.test(t.url || ''));
    $('tabs').replaceChildren();
    for (const tab of tabs) {
      const label = document.createElement('label'), box = document.createElement('input'), text = document.createElement('span');
      box.type = 'checkbox'; box.value = tab.id; box.checked = tab.id === active?.id;
      text.textContent = tab.title || tab.url; text.title = tab.url;
      label.append(box, text); $('tabs').append(label);
    }
    $('multiPanel').hidden = false; status('');
  } catch (e) {status(e.message);}
};
$('scanTabs').onclick = async () => {
  const ids = [...$('tabs').querySelectorAll('input:checked')].map(i => Number(i.value));
  if (!ids.length || ids.length > 12) return status('请选择 1 到 12 个页面。');
  const origins = [...new Set(tabs.filter(t => ids.includes(t.id)).map(t => {const u = new URL(t.url); return u.protocol + '//' + u.hostname + '/*';}))];
  // Request synchronously from the click handler, before any other await.
  const permission = chrome.permissions.request({origins});
  await perform($('scanTabs'), async () => {
    if (!await permission) throw new Error('未授予所选网站权限，没有提取其他页面。');
    await message('capture-tabs', {tabIds: ids});
  });
};
try {
  [active] = await chrome.tabs.query({active: true, currentWindow: true});
  $('pageTitle').textContent = active?.title || '打开素材网页后再使用';
  const data = await chrome.storage.local.get(['inbox', 'lastError']);
  $('inboxCount').textContent = '已收集 ' + (data.inbox?.length || 0) + ' 张';
  if (data.lastError) {status(data.lastError); await chrome.storage.local.remove('lastError');}
} catch (e) {status(e.message);}
