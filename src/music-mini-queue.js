import {t,onLanguageChange} from './i18n.js';

export function wireMiniQueue({invoke}){
 const main=document.querySelector('main'),header=document.querySelector('header'),timeline=document.querySelector('.mini-timeline');
 const faces=document.createElement('div'),front=document.createElement('div'),back=document.createElement('div');
 faces.className='mini-faces';front.className='mini-front';back.className='mini-queue';back.inert=true;back.setAttribute('role','list');
 front.append(...main.childNodes);faces.append(front,back);main.append(faces);main.classList.add('mini-flip-shell');
 const toggle=document.createElement('button');toggle.type='button';toggle.id='mini-queue-toggle';toggle.textContent='≡';toggle.setAttribute('aria-expanded','false');header.insertBefore(toggle,document.getElementById('mini-pin'));
 const moved=['mini-play','mini-mute','mini-volume'].map(id=>{const node=document.getElementById(id),slot=document.createComment(id);node.before(slot);return{node,slot};});
 let open=false,signature='',items=[],dragged=null,busy=false,pending=null;
 const labels=()=>{toggle.title=toggle.ariaLabel=open?t('Back to player'):t('Play queue');back.ariaLabel=t('Up next');};labels();onLanguageChange(labels);
 toggle.addEventListener('click',()=>{
  open=!open;document.body.classList.toggle('mini-queue-open',open);toggle.setAttribute('aria-expanded',String(open));front.inert=open;back.inert=!open;labels();
  if(open){timeline.prepend(moved[0].node);timeline.append(moved[1].node,moved[2].node);}
  else for(const {node,slot}of moved)slot.after(node);
 });
 async function command(action,id,before=null){
  if(busy)return;busy=true;
  try{await invoke('music_mini_queue',{action,id,before});document.getElementById('mini-status').textContent='';}
  catch{document.getElementById('mini-status').textContent=t('Could not control playback.');}
  finally{busy=false;}
 }
 function finishDrag(){dragged=null;back.querySelectorAll('.drop-target,.dragging').forEach(node=>node.classList.remove('drop-target','dragging'));if(pending){const value=pending;pending=null;update(value);}}
 function update(value){
  if(dragged){pending=value;return;}
  const next=Array.isArray(value.queue)?value.queue.slice(0,32):[],key=JSON.stringify(next);if(key===signature)return;signature=key;items=next;
  const scroll=back.scrollTop,focus=document.activeElement?.closest('.mini-queue-row')?.dataset.id;back.replaceChildren();
  for(const [index,item]of items.entries()){
   const row=document.createElement('div');row.className='mini-queue-row';row.dataset.id=item.id;row.setAttribute('role','listitem');
   const play=document.createElement('button');play.type='button';play.className='mini-queue-select';play.textContent=item.title;play.title=item.title+' — '+item.artist;play.ariaLabel=t('Play {title}',{title:item.title});play.addEventListener('click',()=>command('play',item.id));
   const handle=document.createElement('button');handle.type='button';handle.className='mini-queue-grip';handle.draggable=true;handle.textContent='⠿';handle.title=handle.ariaLabel=t('Drag to reorder. Alt + ↑/↓ to move.');handle.setAttribute('aria-keyshortcuts','Alt+ArrowUp Alt+ArrowDown');
   handle.addEventListener('keydown',event=>{if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const target=event.key==='ArrowUp'?index-1:index+2;if(index===0&&event.key==='ArrowUp'||index===items.length-1&&event.key==='ArrowDown')return;command('move',item.id,items[target]?.id||null);}});
   row.addEventListener('dragstart',event=>{dragged=item.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-devil-music-mini-queue',item.id);row.classList.add('dragging');});
   row.addEventListener('dragover',event=>{if(dragged&&dragged!==item.id){event.preventDefault();event.dataTransfer.dropEffect='move';back.querySelectorAll('.drop-target').forEach(node=>node.classList.remove('drop-target'));row.classList.add('drop-target');}});
   row.addEventListener('drop',event=>{event.preventDefault();const id=dragged;if(id&&id!==item.id)command('move',id,item.id);finishDrag();});row.addEventListener('dragend',finishDrag);
   row.append(play,handle);back.append(row);
  }
  if(!items.length){const empty=document.createElement('p');empty.className='mini-queue-empty';empty.textContent=t('Pick a song to start your queue.');back.append(empty);}
  back.scrollTop=scroll;if(focus)back.querySelector(`[data-id="${CSS.escape(focus)}"] button`)?.focus({preventScroll:true});
 }
 return {update};
}
