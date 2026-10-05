import {setupZip} from './pack-selected.js';
import {downloadPath, safeName} from './naming.js';
import {setupDestination, saveOutput} from './destination.js';
import {fetchImage, requestImageAccess} from './zip.js';
import {setupZoom} from './zoom.js';
import {suggestion,useful,imported} from './smart.js';
import {putSession,getSessions,removeSession} from './store.js';
import {CATEGORIES,safeUrl,formatOf,hostOf,filterItems,mergeItems,csv} from './core.js';
const $=id=>document.getElementById(id);
const fields=['query','exclude','minW','minH','maxW','maxH','minLong','ratio','format','category','host','kind','unknown','hideFailed','viewport','onlySelected','onlyFavorites'];
const checks=new Set(['unknown','hideFailed','viewport','onlySelected','onlyFavorites']);
let session=null,items=[],filtered=[],page=1,previewIndex=0,previewList=[],presets={},renderTimer,reading=false,stopReading=false,running=false,stopQueue=false;
const batchResults=[];
const pageSize=60;
const zoom = setupZoom();
const namingOptions = () => ({naming: $('naming').value, grouping: $('grouping').value});
const pathFor = (item,index,folder,options=namingOptions(),extension=formatOf(item.url)==='unknown'?'':formatOf(item.url)) => downloadPath(item,index,folder,{...options,extension});
const destination=setupDestination({getFolder:()=>$('folder').value,getGrouping:()=>$('grouping').value,isBusy:()=>running||reading,notify,onChange:()=>updateSelection()});
setupZip({getSelected:selected,getFolder:()=>$('folder').value,getOptions:namingOptions,getRows:exportRows,isBusy:()=>running||reading,setBusy:value=>{running=value;updateSelection();},notify,destination});
$('openBasket').onclick=async()=>{try{const r=await chrome.runtime.sendMessage({type:'open-inbox'});if(!r?.ok)throw new Error(r?.error||'无法打开');}catch(e){notify(e.message,true);}};
$('showSaveSettings').onclick=()=>{$('saveLocation').scrollIntoView({block:'center'});$('saveMode').focus({preventScroll:true});};
$('naming').onchange=scheduleSave;$('grouping').onchange=()=>{scheduleSave();destination.update();};
let saveTimer,ready=false,historyRows=[],undoStack=[],saveChain=Promise.resolve();
function checkpoint(){undoStack.push(items.map(i=>({url:i.url,selected:i.selected,category:i.category,favorite:i.favorite,note:i.note})));if(undoStack.length>20)undoStack.shift();$('undo').disabled=false;}
function scheduleSave(){if(!ready||!session)return;clearTimeout(saveTimer);$('saveStatus').textContent='正在保存…';saveTimer=setTimeout(saveNow,400);}
function saveNow(){if(!ready||!session)return Promise.resolve();clearTimeout(saveTimer);const snapshot={id:session.id,session:{...session,items:[]},items:structuredClone(items),filters:filters(),folder:$('folder').value,downloadOptions:namingOptions(),updated:Date.now()};
 saveChain=saveChain.catch(()=>{}).then(async()=>{await putSession(snapshot);const rows=await getSessions();for(const row of rows.slice(20))await removeSession(row.id);historyRows=rows.slice(0,20);showHistory();$('saveStatus').textContent='已保存到本机';return true;}).catch(e=>{$('saveStatus').textContent='保存失败，请导出清单：'+e.message;return false;});return saveChain;}
function showHistory(){const old=$('history').value;$('history').replaceChildren(new Option('选择历史批次',''));for(const row of historyRows)$('history').append(new Option(`${row.session.title||'素材批次'} · ${row.items.length} 张`,row.id));$('history').value=old;}
function restore(row){ready=false;session=row.session;session.id=row.id;items=row.items;undoStack=[];$('undo').disabled=true;$('sourceTitle').textContent=session.title;updateHosts();$('folder').value=row.folder||'绘画参考';$('naming').value=row.downloadOptions?.naming||'title';$('grouping').value=row.downloadOptions?.grouping||'category';applyFilters(row.filters||{});ready=true;$('rescan').disabled=!session.tabId;$('openSource').disabled=!session.page;$('saveStatus').textContent='已恢复本地进度';}
$('openHistory').onclick=async()=>{if(running||reading)return notify('请等当前任务结束。');const id=$('history').value;if(!id)return;await saveNow();const row=historyRows.find(r=>r.id===id);if(row){restore(row);history.replaceState(null,'','?capture='+encodeURIComponent(id));notify('已恢复选图、分类、收藏和笔记。');}};
$('deleteHistory').onclick=async()=>{const id=$('history').value;if(!id)return;if(id===session?.id)return notify('当前批次正在使用，请先切换批次。');if(!confirm('删除本地批次？已下载的图片不受影响。'))return;try{await removeSession(id);historyRows=await getSessions();showHistory();}catch(e){notify(e.message,true);}};
$('undo').onclick=()=>{const previous=undoStack.pop();if(!previous)return;const map=new Map(previous.map(i=>[i.url,i]));items.forEach(i=>{if(map.has(i.url))Object.assign(i,map.get(i.url));});$('undo').disabled=!undoStack.length;render();notify('已撤销上一步整理操作。');};
for(const id of ['selectAll','selectPage','invert','clear','applyCategory'])$(id).addEventListener('click',checkpoint,true);
$('recommend').onclick=()=>{checkpoint();let count=0;filtered.forEach(i=>{if(useful(i)){i.selected=true;count++;}});render();notify(`已选中 ${count} 张尺寸合适的参考。未知尺寸请先读取；不判断画面复杂程度。`);};
$('suggest').onclick=()=>{checkpoint();let count=0;selected().forEach(i=>{const hint=suggestion(i);if(i.category==='未分类'&&hint){i.category=hint.category;count++;}});render();notify(`按图片说明辅助分类 ${count} 张，其余保留原分类。可撤销。`);};
$('favoriteSelected').onclick=()=>{checkpoint();selected().forEach(i=>i.favorite=true);render();};
$('previewFavorite').onchange=()=>{checkpoint();previewList[previewIndex].favorite=$('previewFavorite').checked;scheduleSave();};
$('previewNote').oninput=()=>{previewList[previewIndex].note=$('previewNote').value;scheduleSave();};
$('folder').oninput=()=>{scheduleSave();destination.update();};
$('importList').onclick=()=>$('importFile').click();
$('importFile').onchange=async()=>{const file=$('importFile').files[0];if(!file)return;try{if(running||reading)throw new Error('请等当前任务结束再导入。');if(file.size>10000000)throw new Error('清单不能超过 10 MB。');const payload=JSON.parse(await file.text());const rows=imported(payload);if(!rows.length)throw new Error('没有有效图片地址。');await saveNow();const id=crypto.randomUUID();restore({id,session:{id,title:'导入：'+file.name,page:'',items:[],scannedAt:new Date().toISOString()},items:rows,filters:payload.filters&&typeof payload.filters==='object'?payload.filters:{},folder:typeof payload.folder==='string'?payload.folder.slice(0,70):'导入参考'});history.replaceState(null,'','?capture='+id);await saveNow();notify(`已导入 ${rows.length} 张参考地址。清单不包含图片文件。`);}catch(e){notify(e.message,true);}finally{$('importFile').value='';}};
document.addEventListener('visibilitychange',()=>{if(document.hidden)void saveNow();});

function notify(message,error=false){$('notice').hidden=!message;$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function filters(){const f={sort:$('sort').value};for(const key of fields)f[key]=checks.has(key)?$(key).checked:$(key).type==='number'?Math.max(0,Number($(key).value)||0):$(key).value;return f;}
function applyFilters(value={}){for(const key of fields){if(checks.has(key))$(key).checked=value[key]??(key==='unknown');else $(key).value=value[key]??'';}$('sort').value=value.sort||'source';page=1;render();}
function queueRender(){clearTimeout(renderTimer);renderTimer=setTimeout(render,160);}
function selected(){return items.filter(i=>i.selected);}
function updateSelection(){const count=selected().length,busy=running||destination.pending;$('selection').textContent=`已选 ${count}（含筛选外）`;$('download').disabled=busy||!count;$('downloadZip').disabled=busy||!count;for(const id of ['naming','grouping','folder','importList','backupBatch'])$(id).disabled=busy;$('exportCsv').disabled=busy||!count;$('exportJson').disabled=busy||!count;$('applyCategory').disabled=!count;destination.update();}
function categoryOptions(select,value){for(const c of CATEGORIES){const option=document.createElement('option');option.value=c;option.textContent=c;select.append(option);}select.value=value;}
function updateHosts(){const old=$('host').value;$('host').replaceChildren(new Option('全部域名',''));for(const host of [...new Set(items.map(i=>hostOf(i.url)))].sort())$('host').append(new Option(host,host));$('host').value=[...$('host').options].some(o=>o.value===old)?old:'';}
function setDimensions(item,img){if(img.naturalWidth&&(item.width!==img.naturalWidth||item.height!==img.naturalHeight||item.failed)){item.width=img.naturalWidth;item.height=img.naturalHeight;item.failed=false;queueRender();}}
function render(){
 filtered=filterItems(items,filters());const pages=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.min(page,pages);
 $('count').textContent=`${filtered.length} / ${items.length} 张图片`;$('empty').hidden=filtered.length>0;$('prev').disabled=page<=1;$('next').disabled=page>=pages;$('pageInfo').textContent=`${page} / ${pages} 页`;
 const fragment=document.createDocumentFragment();
 for(const item of filtered.slice((page-1)*pageSize,page*pageSize)){
  const node=$('card').content.firstElementChild.cloneNode(true),img=node.querySelector('img'),box=node.querySelector('input'),select=node.querySelector('select'),fallback=node.querySelector('.image-fallback');
  node.classList.toggle('favorite',!!item.favorite);node.classList.toggle('selected',!!item.selected);box.checked=!!item.selected;box.setAttribute('aria-label','选择 '+(item.alt||'图片'));
  img.alt=item.alt||'参考图片';img.src=item.url;
  img.onload=()=>setDimensions(item,img);img.onerror=()=>{img.hidden=true;fallback.hidden=false;if(!item.failed){item.failed=true;queueRender();}};
  node.querySelector('.size').textContent=item.width&&item.height?`${item.width} × ${item.height}`:'尺寸待读取';
  node.querySelector('.caption').textContent=item.alt||hostOf(item.url);node.querySelector('.caption').title=item.alt||item.sourcePage;
  node.querySelector('.file-format').textContent=`${formatOf(item.url).toUpperCase()} · ${item.kinds[0]}`;
  box.onchange=()=>{checkpoint();item.selected=box.checked;node.classList.toggle('selected',item.selected);updateSelection();scheduleSave();if($('onlySelected').checked)queueRender();};
  categoryOptions(select,item.category);select.onchange=()=>{checkpoint();item.category=select.value;scheduleSave();if($('category').value)queueRender();};
  node.querySelector('.image-button').onclick=()=>{previewList=filtered.slice();previewIndex=previewList.indexOf(item);showPreview();$('preview').showModal();$('previewImage').focus();};fragment.append(node);
 }
 $('grid').replaceChildren(fragment);updateSelection();scheduleSave();
}
function showPreview(){
 const item=previewList[previewIndex];if(!item)return;zoom.reset();
 $('previewTitle').textContent=item.alt||item.sourceTitle||'参考图片';$('previewInfo').textContent=`${previewIndex+1} / ${previewList.length} · ${item.width||'?'} × ${item.height||'?'} · ${item.kinds.join(' / ')}`;
 const image=$('previewImage');image.alt=item.alt||'参考图片';image.src=item.url;image.onload=()=>{setDimensions(item,image);zoom.fit();};
 $('previewFavorite').checked=!!item.favorite;$('previewNote').value=item.note||'';$('suggestion').textContent=suggestion(item)?'建议分类：'+suggestion(item).category+' · '+suggestion(item).reason:'暂无文字分类线索，可手动标记。';
 $('previewSelected').checked=!!item.selected;$('previewCategory').value=item.category;
 $('originalLink').href=item.url;$('originalLink').hidden=item.url.startsWith('data:');
 const source=safeUrl(item.detailPage)||safeUrl(item.sourcePage);$('detailLink').href=source;$('detailLink').hidden=!/^https?:/.test(source);
 $('previewPrev').disabled=previewList.length<2;$('previewNext').disabled=previewList.length<2;
}
function turn(delta){previewIndex=(previewIndex+delta+previewList.length)%previewList.length;showPreview();}
$('previewPrev').onclick=()=>turn(-1);$('previewNext').onclick=()=>turn(1);$('closePreview').onclick=()=>$('preview').close();
$('preview').addEventListener('close',()=>render());
$('previewSelected').onchange=()=>{checkpoint();scheduleSave();const item=previewList[previewIndex];if(item)item.selected=$('previewSelected').checked;updateSelection();};
categoryOptions($('previewCategory'),'未分类');$('previewCategory').onchange=()=>{checkpoint();scheduleSave();const item=previewList[previewIndex];if(item)item.category=$('previewCategory').value;};
$('preview').addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(event.target.tagName))return;if(event.key==='ArrowLeft'){event.preventDefault();turn(-1);}if(event.key==='ArrowRight'){event.preventDefault();turn(1);}if(event.code==='Space'){event.preventDefault();$('previewSelected').click();}});
$('previewImage').tabIndex=0;
$('filters').onsubmit=e=>e.preventDefault();$('filters').addEventListener('input',()=>{page=1;queueRender();});$('filters').addEventListener('change',()=>{page=1;queueRender();});$('sort').onchange=()=>{page=1;render();};
$('reset').onclick=()=>applyFilters();
for(const button of document.querySelectorAll('[data-preset]'))button.onclick=()=>applyFilters(button.dataset.preset==='all'?{}:{minW:400,minH:400,minLong:800,unknown:true,ratio:button.dataset.preset==='portrait'?'portrait':''});
$('selectAll').onclick=()=>{filtered.forEach(i=>i.selected=true);render();};$('selectPage').onclick=()=>{filtered.slice((page-1)*pageSize,page*pageSize).forEach(i=>i.selected=true);render();};$('invert').onclick=()=>{filtered.forEach(i=>i.selected=!i.selected);render();};$('clear').onclick=()=>{items.forEach(i=>i.selected=false);render();};
$('applyCategory').onclick=()=>{const list=selected();list.forEach(i=>i.category=$('bulkCategory').value);notify(`已将 ${list.length} 张图片标记为「${$('bulkCategory').value}」。`);render();};
$('prev').onclick=()=>{page--;render();$('count').scrollIntoView({block:'start'});};$('next').onclick=()=>{page++;render();$('count').scrollIntoView({block:'start'});};
function showPresets(){const value=$('savedPresets').value;$('savedPresets').replaceChildren(new Option('选择已保存筛选',''));for(const name of Object.keys(presets))$('savedPresets').append(new Option(name,name));$('savedPresets').value=value;}
$('savePreset').onclick=async()=>{const name=$('presetName').value.trim();if(!name)return notify('先给这组筛选条件起个名字。');if(Object.keys(presets).length>=20&&!Object.hasOwn(presets,name))return notify('最多保存 20 组筛选，请先删除不用的。');
 try{const data=filters();delete data.host;presets={...presets,[name]:data};await chrome.storage.local.set({presets});showPresets();notify('筛选条件已保存在本机。');}catch(e){notify('保存失败：'+e.message,true);}};
$('savedPresets').onchange=()=>{const value=presets[$('savedPresets').value];if(value)applyFilters(value);};$('deletePreset').onclick=async()=>{const name=$('savedPresets').value;if(!name)return;try{delete presets[name];await chrome.storage.local.set({presets});showPresets();}catch(e){notify(e.message,true);}};
$('openSource').onclick=async()=>{if(!session)return;try{await chrome.tabs.update(session.tabId,{active:true});}catch{if(/^https?:/.test(session.page))await chrome.tabs.create({url:session.page});}};
$('rescan').onclick=async()=>{
 if(!session)return;if(reading||running)return notify('请先结束当前任务，再重新提取。');const button=$('rescan');button.disabled=true;button.textContent='正在提取……';
 try{const response=await chrome.runtime.sendMessage({type:'scan',tabId:session.tabId,origin:session.origin,candidates:$('candidates').checked,backgrounds:$('backgrounds').checked});if(!response?.ok)throw new Error(response?.error||'提取失败');
 const old=items.length;items=mergeItems(items.map(i=>({...i,inView:false})),response.result.items);Object.assign(session,{page:response.result.page,title:response.result.title,scannedAt:response.result.scannedAt});$('sourceTitle').textContent=session.title;updateHosts();render();notify(`已补充 ${items.length-old} 个新图片地址；相同地址自动去重。${response.result.capped?'本次已达到扫描上限，可分批在其他页面提取。':''}${response.result.skippedBlob?'部分临时 blob 图片暂不支持，请在原页另存为。':''}`);
 }catch(e){notify('无法继续提取：'+e.message+' 若原网页已关闭或跳转，请重新在网页点击扩展图标。',true);}finally{button.disabled=false;button.textContent='重新提取当前页';}
};
function probe(item){return new Promise(resolve=>{const img=new Image();img.referrerPolicy='no-referrer';let done=false;const finish=ok=>{if(done)return;done=true;clearTimeout(timer);if(ok){item.width=img.naturalWidth;item.height=img.naturalHeight;item.failed=false;}else item.failed=true;img.onload=img.onerror=null;resolve(ok);};const timer=setTimeout(()=>finish(false),10000);img.onload=()=>finish(img.naturalWidth>0);img.onerror=()=>finish(false);img.src=item.url;});}
$('measure').onclick=async()=>{if(reading||running)return;reading=true;stopReading=false;$('measure').disabled=true;$('stopMeasure').hidden=false;const pending=items.filter(i=>!i.width||!i.height||i.failed);let at=0,done=0;
 async function worker(){while(at<pending.length&&!stopReading){const item=pending[at++];await probe(item);done++;$('measureStatus').textContent=`已读取 ${done} / ${pending.length}；会向图片所在网站加载图片。`;queueRender();}}
 await Promise.all(Array.from({length:4},worker));reading=false;$('measure').disabled=false;$('stopMeasure').hidden=true;$('measureStatus').textContent=`${stopReading?'已停止':'读取结束'}：${done} / ${pending.length}。未知尺寸可选择继续保留。`;render();};
$('stopMeasure').onclick=()=>{stopReading=true;};
function exportRows(list){return list.map(({url,width,height,alt,category,kinds,sourcePage,sourceTitle,detailPage,favorite,note,selected})=>({selected,favorite,note,url,width,height,alt,category,kinds,sourcePage,sourceTitle,detailPage,formatGuess:formatOf(url),collectedAt:session?.scannedAt||''}));}
function exported(){return exportRows(selected());}
$('backupBatch').onclick=()=>saveBlob(JSON.stringify({tool:'MAHO 拾图',version:2,items:exportRows(items),filters:filters(),folder:$('folder').value},null,2),'application/json','整批素材记录.json').catch(e=>notify(e.message,true));
async function saveBlob(content,type,name){
 if(running||reading)throw new Error('请等当前任务结束。');
 const target=destination.capture(),path=`MAHO 拾图/${safeName($('folder').value,'绘画参考')}/${name}`;
 running=true;updateSelection();
 try{await destination.verify(target);const result=await saveOutput({target,path,blob:new Blob([content],{type})});notify(result.kind==='directory'?`已保存到“${target.directory.name}”：${result.path}`:'已提交浏览器保存，请查看下载列表。');}
 finally{running=false;updateSelection();}
}
$('exportJson').onclick=()=>saveBlob(JSON.stringify({tool:'MAHO 拾图',version:1,items:exported()},null,2),'application/json','来源清单.json').catch(e=>notify(e.message,true));
$('exportCsv').onclick=()=>{const rows=[['分类','说明','宽','高','格式推测','图片地址','来源页面','来源标题','作品页','提取方式'],...exported().map(i=>[i.category,i.alt,i.width,i.height,i.formatGuess,i.url,i.sourcePage,i.sourceTitle,i.detailPage,i.kinds.join('/')])];void saveBlob(csv(rows),'text/csv;charset=utf-8','来源清单.csv').catch(e=>notify(e.message,true));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function logDownload(){let complete=0,failed=0,pending=0,stopped=0;const fragment=document.createDocumentFragment();for(const result of batchResults){if(result.state==='已完成')complete++;else if(result.state.startsWith('失败'))failed++;else if(result.state.startsWith('已停止'))stopped++;else pending++;const p=document.createElement('p');p.textContent=`${result.state} · ${result.name}`;fragment.append(p);}$('downloadLog').replaceChildren(fragment);$('retry').disabled=running||!failed;$('downloadStatus').textContent=`已完成 ${complete} · 失败 ${failed} · 排队或处理中 ${pending} · 已停止 ${stopped}`;}
async function downloadOne(item,index,folder,record,target,options){
 try{
  if(!safeUrl(item.url))throw new Error('图片地址无效');
  if(target.mode==='directory'){
   record.state='读取图片';logDownload();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
   let image;try{image=await fetchImage(item.url,{signal:controller.signal});}finally{clearTimeout(timer);}
   record.state='保存中';logDownload();await destination.verify(target);const result=await saveOutput({target,path:pathFor(item,index,folder,options,image.ext),blob:new Blob([image.bytes])});
   record.name=result.path;record.state='已完成';return;
  }
  // A blocked preview must not prevent a browser-managed download.
  record.state=target.mode==='ask'?'等待选择保存位置':'提交下载';logDownload();const {id}=await saveOutput({target,url:item.url,path:pathFor(item,index,folder,options)});record.id=id;record.state='下载中';logDownload();
  const started=Date.now();
  while(Date.now()-started<90000){const [d]=await chrome.downloads.search({id});if(!d)throw new Error('下载记录不存在');if(d.state==='complete'){if(d.mime==='text/html')throw new Error('网站返回了网页，请到来源页确认登录状态');record.state='已完成';return;}if(d.state==='interrupted')throw new Error(d.error||'下载中断');await sleep(800);}
  record.state='仍在下载，请查看浏览器';
 }catch(e){record.state='失败：'+(e.name==='AbortError'?'读取超时':e.message);if(target.mode==='ask')stopQueue=true;}finally{logDownload();}
}
chrome.downloads.onChanged.addListener(delta=>{const record=batchResults.find(r=>r.id===delta.id);if(!record)return;if(delta.state?.current==='complete'&&!record.state.startsWith('失败'))record.state='已完成';else if(delta.state?.current==='interrupted')record.state='失败：'+(delta.error?.current||'下载中断');logDownload();});
$('download').onclick=async()=>{
 if(running||reading)return notify('请先停止尺寸读取。');const list=selected().map(i=>({...i,kinds:[...i.kinds]}));if(!list.length)return;
 try{
  const target=destination.capture(),folder=$('folder').value,options=namingOptions();
  const permission=target.mode==='directory'?requestImageAccess(list):Promise.resolve(true);
  running=true;stopQueue=false;updateSelection();$('stopDownload').hidden=false;
  if(!await permission)throw new Error('没有授予图片网站访问权限。可以改用“每次弹窗选择位置”或浏览器默认下载。');
  await destination.verify(target);
  batchResults.length=0;for(const [index,item] of list.entries())batchResults.push({state:'等待',url:item.url,name:pathFor(item,index,folder,options)});
  logDownload();let at=0;
  async function worker(){while(at<list.length&&!stopQueue){const index=at++;await downloadOne(list[index],index,folder,batchResults[index],target,options);}}
  await Promise.all(Array.from({length:target.mode==='ask'?1:3},worker));if(stopQueue)for(let i=at;i<list.length;i++)batchResults[i].state='已停止，未提交';
  logDownload();notify(stopQueue?'已停止后续保存任务。已开始的下载会继续。':target.mode==='directory'?`保存结束，请到“${target.directory.name}”查看；各图片结果见下方。`:'本次队列已处理，请查看下方结果；失败的图片可回来源页打开后另存。');
 }catch(error){notify(error.message,true);}
 finally{running=false;$('stopDownload').hidden=true;logDownload();updateSelection();}
};
$('retry').onclick=()=>{if(running)return;const urls=new Set(batchResults.filter(r=>r.state.startsWith('失败')).map(r=>r.url));checkpoint();items.forEach(i=>i.selected=urls.has(i.url));render();$('download').click();};
$('stopDownload').onclick=()=>{stopQueue=true;};window.addEventListener('beforeunload',e=>{if(running){e.preventDefault();e.returnValue='';}});
async function init(){
 try{await destination.ready;presets=(await chrome.storage.local.get('presets')).presets||{};showPresets();historyRows=await getSessions();showHistory();const id=new URL(location.href).searchParams.get('capture');const saved=historyRows.find(r=>r.id===id);if(saved){restore(saved);return;}if(!id){if(historyRows[0]){restore(historyRows[0]);return;}throw new Error('请点击扩展图标提取网页，或导入旧版来源清单。');}const key='capture:'+id;const capture=(await chrome.storage.session.get(key))[key];if(!capture)throw new Error('提取已过期，请重新点击扩展，或打开历史批次。');
 restore({id,session:capture,items:mergeItems([],capture.items),filters:{},folder:'绘画参考-'+new Date().toISOString().slice(0,10)});const persisted=await saveNow();if(persisted)await chrome.storage.session.remove(key);if(capture.error)notify(capture.error,true);else notify(`已提取 ${items.length} 张，选图进度自动保存在本机。${capture.capped?'已达到提取上限。':''}${capture.errors?.length?'部分页面未能读取：'+capture.errors.join('；'):''}${capture.skippedBlob?'部分临时 blob 图片请在原页另存。':''}`);
 }catch(e){$('sourceTitle').textContent='打开素材网页，开始收集';notify(e.message,true);$('rescan').disabled=true;$('openSource').disabled=true;render();}
}
void init();
