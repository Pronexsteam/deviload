import {t,onLanguageChange} from './i18n.js';

// A guided tour: the page dims around one control at a time and a glass card explains it. The light
// and the card glide from one control to the next. A step whose control is not on screen is skipped.
const SEEN_PREFIX='deviload-tour-';
const visible=node=>node instanceof Element&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function tourSeen(key,storage=globalThis.localStorage){try{return storage?.getItem(SEEN_PREFIX+key)==='done';}catch{return true;}}
function markSeen(key,storage=globalThis.localStorage){try{storage?.setItem(SEEN_PREFIX+key,'done');}catch{/* Shown again next time. */}}
export function forgetTour(key,storage=globalThis.localStorage){try{storage?.removeItem(SEEN_PREFIX+key);}catch{/* Nothing to forget. */}}

let layer=null;
function ensureLayer(){
  if(layer)return layer;
  const root=document.createElement('div');root.className='mtour-layer';root.popover='manual';
  root.innerHTML=`<svg class="mtour-shade" aria-hidden="true"><defs><mask id="mtour-hole"><rect width="100%" height="100%" fill="white"/><rect class="mtour-hole" rx="16" fill="black"/></mask></defs><rect width="100%" height="100%" mask="url(#mtour-hole)"/></svg>
  <div class="mtour-ring" aria-hidden="true"></div>
  <section class="mtour-card" role="dialog" aria-modal="true" aria-labelledby="music-tour-title"><div class="mtour-progress" aria-hidden="true"></div><h2 id="music-tour-title"></h2><p class="mtour-text"></p>
  <div class="mtour-actions"><button type="button" class="mtour-skip"></button><span></span><button type="button" class="mtour-back"></button><button type="button" class="mtour-next"></button></div></section>`;
  document.body.append(root);
  layer={root,hole:root.querySelector('.mtour-hole'),ring:root.querySelector('.mtour-ring'),card:root.querySelector('.mtour-card'),title:root.querySelector("#music-tour-title"),text:root.querySelector('.mtour-text'),progress:root.querySelector('.mtour-progress'),skip:root.querySelector('.mtour-skip'),back:root.querySelector('.mtour-back'),next:root.querySelector('.mtour-next')};
  return layer;
}

// Puts the light on [target] and the card beside it, on whichever side has room.
function place(target){
  const {hole,ring,card}=ensureLayer(),pad=8;
  const box=target?target.getBoundingClientRect():{left:innerWidth/2,top:innerHeight/2,width:0,height:0,right:innerWidth/2,bottom:innerHeight/2};
  const x=Math.max(4,box.left-pad),y=Math.max(4,box.top-pad),w=Math.min(innerWidth-8,box.width+pad*2),h=Math.min(innerHeight-8,box.height+pad*2);
  for(const [name,value]of [['x',x],['y',y],['width',w],['height',h]])hole.setAttribute(name,String(Math.max(0,value)));
  Object.assign(ring.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px',opacity:target?'1':'0'});
  const cw=card.offsetWidth||340,ch=card.offsetHeight||180,gap=16;
  // Beside the control first; above or below it the card centres on it and keeps inside the window.
  const across=Math.min(innerWidth-cw-12,Math.max(12,box.left+box.width/2-cw/2)),down=Math.min(innerHeight-ch-12,Math.max(12,box.top));
  const spots=[[box.right+gap,down],[box.left-cw-gap,down],[across,box.bottom+gap],[across,box.top-ch-gap]];
  const fits=([left,top])=>left>=12&&top>=12&&left+cw<=innerWidth-12&&top+ch<=innerHeight-12;
  let [left,top]=target?(spots.find(fits)||[across,box.top>innerHeight/2?box.top-ch-gap:box.bottom+gap]):[(innerWidth-cw)/2,(innerHeight-ch)/2];
  left=Math.min(innerWidth-cw-12,Math.max(12,left));top=Math.min(innerHeight-ch-12,Math.max(12,top));
  card.style.translate=`${Math.round(left)}px ${Math.round(top)}px`;
}

// Runs [steps] once per [key] unless forced. Each step: {target:()=>Element, title, text, before?:async()=>{}}.
export function runTour({key,steps,force=false,single=false,storage=globalThis.localStorage}){
  if(!force&&tourSeen(key,storage))return Promise.resolve(false);
  const ui=ensureLayer();if(ui.root.matches(':popover-open'))return Promise.resolve(false);
  return new Promise(resolve=>{
    let index=-1,current=null,frame=0;
    const labels=()=>{ui.skip.textContent=t('Skip');ui.back.textContent=t('Back');};
    const follow=()=>{frame=0;if(current)place(current);};
    const relayout=()=>{if(!frame)frame=requestAnimationFrame(follow);};
    async function go(step){
      let next=index+step;
      while(next>=0&&next<steps.length){
        await steps[next].before?.();
        const node=steps[next].target?.();
        if(!steps[next].target||visible(node)){index=next;current=node||null;break;}
        next+=step;
      }
      if(next<0)return;
      if(next>=steps.length){finish(true);return;}
      const item=steps[index];
      ui.root.classList.add('is-moving');ui.card.classList.remove('is-shown');await pause(140);
      ui.title.textContent=item.title;ui.text.textContent=item.text;
      ui.progress.replaceChildren(...steps.map((_,i)=>{const dot=document.createElement('i');if(i===index)dot.className='is-current';return dot;}));
      ui.back.hidden=single||index===0;ui.skip.hidden=single;ui.next.textContent=single?t('Got it'):index===steps.length-1?t('Done'):t('Next');
      current?.scrollIntoView?.({block:'nearest',inline:'nearest'});
      place(current);requestAnimationFrame(()=>{ui.card.classList.add('is-shown');ui.root.classList.remove('is-moving');});
      ui.next.focus({preventScroll:true});
    }
    function finish(completed){
      markSeen(key,storage);ui.card.classList.remove('is-shown');ui.root.classList.add('is-leaving');
      clearInterval(guard);removeEventListener('resize',relayout);removeEventListener('scroll',relayout,true);document.removeEventListener('keydown',keys,true);
      ui.next.onclick=ui.back.onclick=ui.skip.onclick=null;
      setTimeout(()=>{ui.root.classList.remove('is-leaving');if(ui.root.matches(':popover-open'))ui.root.hidePopover();resolve(completed);},260);
    }
    function keys(event){
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(false);}
      else if(event.key==='ArrowRight'){event.preventDefault();go(1);}
      else if(event.key==='ArrowLeft'&&index>0){event.preventDefault();go(-1);}
    }
    // Another window opening over the tour ends it, so the two never stack.
    const watcher=new MutationObserver(records=>{if(records.some(record=>record.target instanceof HTMLDialogElement&&record.target.open)){watcher.disconnect();finish(false);}});
    watcher.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
    const finishOnce=finish;finish=completed=>{watcher.disconnect();finish=()=>{};finishOnce(completed);};
    labels();ui.next.onclick=()=>go(1);ui.back.onclick=()=>go(-1);ui.skip.onclick=()=>finish(false);
    addEventListener('resize',relayout);addEventListener('scroll',relayout,true);document.addEventListener('keydown',keys,true);
    // A modal window makes everything outside it unclickable, so the tour lives inside the open one.
    const modal=[...document.querySelectorAll('dialog[open]')].filter(node=>node.matches(':modal')).at(-1);
    (modal||document.body).append(ui.root);
    // When the control a step points at goes away (the person moved on), the tour steps aside too.
    const guard=setInterval(()=>{if(current&&!visible(current)&&!ui.root.classList.contains('is-moving'))finish(false);},300);
    ui.root.showPopover();go(1);
  });
}

// A single tip pointed at one control, shown once per key.
export function showTip({key,target,title,text,storage=globalThis.localStorage}){
  return runTour({key,storage,single:true,steps:[{target:()=>typeof target==='function'?target():target,title,text}]});
}
onLanguageChange(()=>{if(layer){layer.skip.textContent=t('Skip');layer.back.textContent=t('Back');}});
