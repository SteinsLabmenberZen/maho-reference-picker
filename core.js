export const CATEGORIES=['未分类','人物','头像表情','动物','线稿','其他'];
export function safeUrl(value){try{const u=new URL(value);if(u.username||u.password)return '';if(/^https?:$/.test(u.protocol))return u.href;if(/^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(value)&&value.length<1500000)return value;}catch{}return '';}
export function formatOf(url){
 if(url.startsWith('data:'))return url.match(/^data:image\/([^;]+)/i)?.[1]?.toLowerCase().replace('jpeg','jpg')||'unknown';
 try{const u=new URL(url),p=u.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();let f=/^(jpe?g|png|gif|webp|avif|svg)$/.test(p||'')?p:(u.searchParams.get('format')||u.searchParams.get('fm')||'unknown').toLowerCase();return f==='jpeg'?'jpg':['jpg','png','webp','gif','avif','svg'].includes(f)?f:'unknown';}catch{return 'unknown';}
}
export function hostOf(url){try{return new URL(url).hostname||'内嵌图片';}catch{return '';}}
export function safePart(value,fallback='参考图'){
 const result=String(value||'').normalize('NFKC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'_').replace(/\.+/g,'.').replace(/^[.\s]+|[.\s]+$/g,'').slice(0,70);
 return !result?fallback:/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)?'_'+result:result;
}
export function filePath(item,index,folder){const ext=formatOf(item.url);return `MAHO 拾图/${safePart(folder,'绘画参考')}/${safePart(item.category,'未分类')}/${String(index+1).padStart(3,'0')}-${safePart(item.alt||item.sourceTitle,'参考图')}${ext==='unknown'?'':'.'+ext}`;}
export function filterItems(items,f){
 let list=items.filter(i=>{
  if(f.onlySelected&&!i.selected)return false;
  if(f.onlyFavorites&&!i.favorite)return false;
  if(f.category&&i.category!==f.category)return false;
  if(f.kind&&!i.kinds.includes(f.kind))return false;
  if(f.host&&hostOf(i.url)!==f.host)return false;
  if(f.format&&formatOf(i.url)!==f.format)return false;
  if(f.viewport&&!i.inView)return false;
  if(f.hideFailed&&i.failed)return false;
  const hay=[i.alt,i.url,i.sourceTitle,i.note].join(' ').toLowerCase();
  if(f.query&&!hay.includes(f.query.trim().toLowerCase()))return false;
  if(f.exclude&&f.exclude.split(/[,，]/).map(s=>s.trim().toLowerCase()).filter(Boolean).some(t=>hay.includes(t)))return false;
  if(!i.width||!i.height)return !!f.unknown;
  const w=i.width,h=i.height,ratio=w/h;
  if(f.minW&&w<f.minW||f.minH&&h<f.minH||f.maxW&&w>f.maxW||f.maxH&&h>f.maxH||f.minLong&&Math.max(w,h)<f.minLong)return false;
  if(f.ratio==='portrait'&&ratio>=.9||f.ratio==='landscape'&&ratio<=1.1||f.ratio==='square'&&(ratio<.9||ratio>1.1)||f.ratio==='strip'&&(ratio>=.33&&ratio<=3))return false;
  return true;
 });
 const mode=f.sort||'source';list=list.slice();
 if(mode==='area')list.sort((a,b)=>(b.width*b.height)-(a.width*a.height));
 if(mode==='width')list.sort((a,b)=>b.width-a.width);
 if(mode==='height')list.sort((a,b)=>b.height-a.height);
 return list;
}
export function mergeItems(old,incoming){
 const byUrl=new Map(old.map(i=>[i.url,{...i}]));
 for(const item of incoming){if(!safeUrl(item.url))continue;const prior=byUrl.get(item.url);if(prior){prior.inView=item.inView;prior.kinds=[...new Set([...prior.kinds,...item.kinds])];if(item.width){prior.width=item.width;prior.height=item.height;}prior.sourcePage=item.sourcePage;prior.detailPage=item.detailPage||prior.detailPage;}else byUrl.set(item.url,{...item,selected:!!item.selected,category:CATEGORIES.includes(item.category)?item.category:'未分类'});}
 return [...byUrl.values()].slice(0,1500);
}
export function csv(rows){const cell=x=>'"'+String(x??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');}
