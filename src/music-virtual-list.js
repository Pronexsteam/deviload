// Keep DOM, image decoders and row event handlers bounded independently of the
// library size. Metadata/search/playback continue to use the complete array.
export const MUSIC_ROW_HEIGHT=72;
export function musicListRange(count,offset,height,{rowHeight=MUSIC_ROW_HEIGHT,overscan=6}={}){
 const visible=Math.ceil(Math.max(1,height)/rowHeight),start=Math.max(0,Math.min(count,Math.floor(Math.max(0,offset)/rowHeight))-overscan);
 return {start,end:Math.min(count,start+Math.min(80,visible+overscan*2))};
}
export function musicThumbnail(url){
 if(typeof url!=='string')return '';
 try{const u=new URL(url);if(u.protocol!=='https:')return '';
  if(u.hostname==='i.ytimg.com')return url.replace(/\/(?:maxresdefault|sddefault|hqdefault|mqdefault|default)\.(jpg|webp)(?=[?#]|$)/,'/mqdefault.$1');
  if(['lh3.googleusercontent.com','yt3.googleusercontent.com'].includes(u.hostname))return url.replace(/=w\d+-h\d+(?=[-?&#]|$)/,'=w96-h96');
 }catch{}return url;
}
export function mountMusicList(container,items,renderRow,onVisible=()=>{}){
 const height=MUSIC_ROW_HEIGHT,top=document.createElement('div'),bottom=document.createElement('div');
 top.className=bottom.className='music-list-spacer';top.ariaHidden=bottom.ariaHidden='true';container.classList.add('music-virtual-list');container.setAttribute('role','list');
 container.append(top,bottom);let scrollRoot=container.parentElement;
 while(scrollRoot&&scrollRoot!==document.body&&!/(auto|scroll)/.test(getComputedStyle(scrollRoot).overflowY))scrollRoot=scrollRoot.parentElement;
 if(!scrollRoot||scrollRoot===document.body)scrollRoot=window;
 let nodes=new Map(),frame=0,disposed=false,lastStart=-1,lastEnd=-1;
 function draw(){
  frame=0;if(disposed||!container.isConnected)return;
  const rect=container.getBoundingClientRect(),viewport=scrollRoot===window?{top:0,height:innerHeight}:scrollRoot.getBoundingClientRect();
  const {start,end}=musicListRange(items.length,viewport.top-rect.top,viewport.height);
  if(start===lastStart&&end===lastEnd)return;lastStart=start;lastEnd=end;
  // Removing old rows can temporarily shorten the document and clamp its scroll
  // position before the replacement rows are inserted (especially at the end).
  const scrollPosition=scrollRoot===window?window.scrollY:scrollRoot.scrollTop;
  const next=new Map();
  top.style.height=start*height+'px';bottom.style.height=(items.length-end)*height+'px';
  for(const [index,row] of nodes)if(index<start||index>=end)row.remove();
  let cursor=top.nextSibling;
  for(let i=start;i<end;i++){const row=nodes.get(i)||renderRow(items[i],i);row.setAttribute('role','listitem');row.setAttribute('aria-posinset',String(i+1));row.setAttribute('aria-setsize',String(items.length));next.set(i,row);if(row!==cursor)container.insertBefore(row,cursor);cursor=row.nextSibling;}
  nodes=next;
  if(scrollRoot===window)window.scrollTo({top:scrollPosition,behavior:'instant'});else scrollRoot.scrollTop=scrollPosition;
  onVisible(items.slice(start,end).map(item=>item.id));
 }
 function schedule(){if(!disposed&&!frame)frame=requestAnimationFrame(draw);}
 function keys(event){
  if(!event.target.closest('.music-track-select,.music-queue-select'))return;
  const row=event.target.closest('.music-track-row,.music-queue-track'),index=Number(row?.getAttribute('aria-posinset'))-1;
  const target=event.key==='ArrowDown'?index+1:event.key==='ArrowUp'?index-1:event.key==='Home'?0:event.key==='End'?items.length-1:null;
  if(target===null||event.ctrlKey||event.altKey||event.metaKey)return;event.preventDefault();
  const next=Math.max(0,Math.min(items.length-1,target));const rect=container.getBoundingClientRect(),view=scrollRoot===window?{top:0,height:innerHeight}:scrollRoot.getBoundingClientRect();
  scrollRoot.scrollBy({top:rect.top-view.top+next*height-view.height/2,behavior:'instant'});draw();nodes.get(next)?.querySelector('.music-track-select,.music-queue-select')?.focus({preventScroll:true});
 }
 scrollRoot.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);container.addEventListener('keydown',keys);
 const resize=new ResizeObserver(schedule);resize.observe(container);if(scrollRoot!==window)resize.observe(scrollRoot);
 draw();return {destroy(){disposed=true;cancelAnimationFrame(frame);resize.disconnect();scrollRoot.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);container.removeEventListener('keydown',keys);nodes.clear();}};
}
