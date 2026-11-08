import {t,onLanguageChange} from './i18n.js';
import {readLayout,saveLayout,moveLayoutItem,swapLayoutPanels,toggleLayoutHidden,HIDEABLE,defaultLayout,isDefaultLayout,layoutZonesFor,normalizeLayout} from './music-layout-model.js';

// Edit layout: blocks and dock buttons can be dragged into the zones they fit, and the side panels swapped.
const LABELS={welcome:()=>t('Greeting'),quick:()=>t('Quick picks'),moods:()=>t('Moods'),stats:()=>t('Listening summary'),navigation:()=>t('Navigation'),playlists:()=>t('Playlists'),
  queue:()=>t('Play queue'),panel:()=>t('Now playing panel'),expand:()=>t('Now playing'),clip:()=>t('Music video'),mini:()=>t('Mini player'),remote:()=>t('Phone remote'),volume:()=>t('Volume')};

export function wireMusicLayout({workspace,document=globalThis.document,storage=globalThis.localStorage}){
  if(!workspace||!document?.body)return null;
  const extras=()=>document.querySelector('.music-dock-extras');
  const one=node=>node?[node]:[];
  const NODES={
    welcome:()=>one(workspace.querySelector('.music-main-content>.music-toolbar')),
    quick:()=>one(workspace.querySelector('.music-main-content>.music-quick-grid')),
    moods:()=>one(workspace.querySelector('.music-main-content>#music-moods')),
    stats:()=>one(workspace.querySelector('.music-sidebar-stats')),
    navigation:()=>one(workspace.querySelector('.music-library-body>.music-sidebar-controls')),
    playlists:()=>[...workspace.querySelectorAll('.music-library-body>:is(.music-library-sidebar-head,.music-library-sidebar-search,.music-library-sidebar-list,.music-library-sidebar-empty)')],
    queue:()=>one(extras()?.querySelector(':scope>.music-queue-toggle')),
    panel:()=>one(extras()?.querySelector(':scope>.music-panel-toggle')),
    expand:()=>one(extras()?.querySelector(':scope>#music-expand')),
    clip:()=>one(extras()?.querySelector(':scope>#music-clip-open')),
    mini:()=>one(extras()?.querySelector(':scope>[data-mirror="music-mini-open"]')),
    remote:()=>one(extras()?.querySelector(':scope>[data-mirror="music-remote-open"]')),
    volume:()=>[...(extras()?.querySelectorAll(':scope>:is(.music-volume-mark,input[type="range"])')||[])],
  };
  const ZONES={
    home:{axis:'y',container:()=>workspace.querySelector('.music-main-content'),before:box=>box.querySelector(':scope>.music-content-heading')},
    greeting:{axis:'x',container:()=>workspace.querySelector('.music-welcome'),before:()=>null},
    sidebar:{axis:'y',container:()=>workspace.querySelector('.music-library-body'),before:()=>null},
    dock:{axis:'x',container:extras,before:box=>box.querySelector(':scope>.music-dock-more')},
  };
  let layout=readLayout(storage),editing=false,drag=null;

  function apply(){
    workspace.classList.toggle('music-panels-swapped',layout.swapped);
    for(const [zone,spec] of Object.entries(ZONES)){
      const box=spec.container();if(!box)continue;
      // Walk backwards so each block only moves when it is out of place; focus and playback stay put.
      let ref=spec.before(box);
      for(const id of [...layout.zones[zone]].reverse()){
        for(const node of NODES[id]().reverse()){if(node.nextSibling!==ref||node.parentNode!==box)box.insertBefore(node,ref);ref=node;}
      }
    }
    // Hidden blocks leave the page; while editing they stay faintly visible so they can come back.
    for(const id of Object.keys(NODES)){
      const off=layout.hidden.includes(id);
      for(const node of NODES[id]()){node.classList.toggle('is-layout-hidden',off&&!editing);node.classList.toggle('is-layout-off',off&&editing);}
    }
  }
  function commit(next,message){
    layout=normalizeLayout(next);saveLayout(layout,storage);apply();refresh();
    if(message)announce(message);
  }

  // Editing bar.
  const bar=document.createElement('div');bar.className='music-layout-bar';bar.setAttribute('role','toolbar');bar.hidden=true;
  bar.innerHTML='<div class="music-layout-copy"><strong data-title></strong><span data-hint></span></div><button type="button" data-swap><span class="icon" data-icon="arrows-left-right" aria-hidden="true"></span><span data-swap-label></span></button><button type="button" data-reset></button><button type="button" class="music-layout-done" data-done></button><span class="music-layout-live" role="status" aria-live="polite"></span>';
  document.body.append(bar);
  const $=selector=>bar.querySelector(selector);
  const announce=text=>{$('.music-layout-live').textContent='';requestAnimationFrame(()=>{$('.music-layout-live').textContent=text;});};
  const marker=document.createElement('div');marker.className='music-layout-marker';marker.hidden=true;document.body.append(marker);
  const eye=document.createElement('button');eye.type='button';eye.className='music-layout-toggle';eye.hidden=true;
  eye.innerHTML='<span class="icon" aria-hidden="true"></span>';document.body.append(eye);
  const ghost=document.createElement('div');ghost.className='music-layout-ghost';ghost.hidden=true;document.body.append(ghost);
  function labels(){
    bar.setAttribute('aria-label',t('Edit layout'));$('[data-title]').textContent=t('Edit layout');
    $('[data-hint]').textContent=t('Drag blocks and buttons to a new place. The eye hides or shows them.');
    $('[data-swap-label]').textContent=t('Swap panels');themeItem.textContent=t('Edit layout');$('[data-reset]').textContent=t('Reset');$('[data-done]').textContent=t('Done');
    if(editing)mark();
  }
  // The theme menu offers it too, from any page.
  const themeMenu=document.getElementById('quick-theme-menu');
  const themeItem=document.createElement('button');themeItem.type='button';themeItem.className='quick-theme-customize quick-theme-layout';
  const customizeItem=themeMenu?.querySelector('.quick-theme-customize');
  if(customizeItem)customizeItem.after(themeItem);else themeMenu?.append(themeItem);
  themeItem.addEventListener('click',()=>{
    themeMenu.hidePopover?.();
    if(document.querySelector('main')?.dataset.page!=='music')document.getElementById('music-tab')?.click();
    requestAnimationFrame(()=>requestAnimationFrame(edit));
  });
  function refresh(){$('[data-reset]').disabled=isDefaultLayout(layout);if(!eye.hidden)showEye(eye.dataset.id);}
  // The eye floats over the block under the pointer or focus and hides or shows it.
  function showEye(id){
    const box=id&&HIDEABLE.includes(id)&&editing&&!drag?rectOf(id):null;
    eye.hidden=!box;if(!box)return;
    const off=layout.hidden.includes(id);eye.dataset.id=id;
    eye.querySelector('.icon').dataset.icon=off?'eye-slash':'eye';eye.classList.toggle('is-off',off);
    eye.title=eye.ariaLabel=off?t('Show {block}',{block:LABELS[id]()}):t('Hide {block}',{block:LABELS[id]()});
    eye.style.left=Math.min(innerWidth-30,Math.max(4,box.right-12))+'px';eye.style.top=Math.max(4,box.top-12)+'px';
  }
  const toggleHidden=id=>{const off=layout.hidden.includes(id);commit(toggleLayoutHidden(layout,id),off?t('{block} shown',{block:LABELS[id]()}):t('{block} hidden',{block:LABELS[id]()}));};
  eye.addEventListener('click',()=>{if(eye.dataset.id)toggleHidden(eye.dataset.id);});
  const over=event=>{if(drag)return;const node=event.target instanceof Element&&event.target.closest('[data-layout-item]');if(node)showEye(node.dataset.layoutItem);else if(!(event.target instanceof Element&&event.target.closest('.music-layout-toggle')))eye.hidden=true;};
  const focusIn=event=>{const node=event.target instanceof Element&&event.target.closest('[data-layout-item]');if(node)showEye(node.dataset.layoutItem);};
  const scrolled=()=>{eye.hidden=true;};
  $('[data-swap]').addEventListener('click',()=>commit(swapLayoutPanels(layout),layout.swapped?t('Panels are back in place'):t('Panels swapped')));
  $('[data-reset]').addEventListener('click',()=>commit(defaultLayout(),t('Layout reset')));
  $('[data-done]').addEventListener('click',()=>finish());

  const focusable=new Map();
  function mark(){
    for(const [zone,spec] of Object.entries(ZONES)){const box=spec.container();if(box)box.dataset.layoutZone=zone;}
    for(const [id,nodes] of Object.entries(NODES)){
      nodes().forEach((node,index)=>{
        node.dataset.layoutItem=id;
        if(index)return;
        if(!focusable.has(node))focusable.set(node,node.getAttribute('tabindex'));
        node.tabIndex=0;node.dataset.layoutLabel=LABELS[id]();
        node.setAttribute('aria-roledescription',t('Movable block'));
      });
    }
  }
  function unmark(){
    for(const node of document.querySelectorAll('[data-layout-zone]'))delete node.dataset.layoutZone;
    for(const node of document.querySelectorAll('[data-layout-item]')){delete node.dataset.layoutItem;delete node.dataset.layoutLabel;node.removeAttribute('aria-roledescription');}
    for(const [node,value] of focusable){if(value===null)node.removeAttribute('tabindex');else node.setAttribute('tabindex',value);}
    focusable.clear();
  }

  function edit(){
    if(editing)return;
    editing=true;document.documentElement.classList.add('music-layout-editing');
    document.querySelector('#music-dock-menu')?.hidePopover?.();
    apply();mark();refresh();bar.hidden=false;labels();$('[data-done]').focus();
    document.addEventListener('pointerdown',down,true);document.addEventListener('click',block,true);document.addEventListener('dblclick',block,true);
    document.addEventListener('keydown',key,true);document.addEventListener('contextmenu',block,true);
    document.addEventListener('pointerover',over,true);document.addEventListener('focusin',focusIn,true);document.addEventListener('scroll',scrolled,true);
  }
  function finish(){
    if(!editing)return;
    cancel();editing=false;document.documentElement.classList.remove('music-layout-editing');bar.hidden=true;unmark();
    document.removeEventListener('pointerdown',down,true);document.removeEventListener('click',block,true);document.removeEventListener('dblclick',block,true);
    document.removeEventListener('keydown',key,true);document.removeEventListener('contextmenu',block,true);
    document.removeEventListener('pointerover',over,true);document.removeEventListener('focusin',focusIn,true);document.removeEventListener('scroll',scrolled,true);
    eye.hidden=true;apply();
  }
  const inEditor=target=>target instanceof Element&&!!target.closest('.music-layout-bar,.music-layout-toggle');
  const inMusic=target=>target instanceof Element&&!!target.closest('#devil-music,.music-dock');
  // While editing, the page is a board: nothing inside it plays, opens or seeks.
  function block(event){if(inMusic(event.target)&&!inEditor(event.target)){event.preventDefault();event.stopImmediatePropagation();}}

  const rectOf=id=>{
    const boxes=NODES[id]().map(node=>node.getBoundingClientRect()).filter(box=>box.width||box.height);
    if(!boxes.length)return null;
    const left=Math.min(...boxes.map(b=>b.left)),top=Math.min(...boxes.map(b=>b.top)),right=Math.max(...boxes.map(b=>b.right)),bottom=Math.max(...boxes.map(b=>b.bottom));
    return {left,top,right,bottom,width:right-left,height:bottom-top};
  };
  function zoneAt(id,x,y){
    let best=null,area=Infinity;
    for(const zone of layoutZonesFor(id)){
      const box=ZONES[zone].container();if(!box||!box.getClientRects().length)continue;
      const r=box.getBoundingClientRect(),pad=14;
      if(x<r.left-pad||x>r.right+pad||y<r.top-pad||y>r.bottom+pad)continue;
      if(r.width*r.height<area){best={zone,rect:r};area=r.width*r.height;}
    }
    return best;
  }
  // Where the dragged block would land, and the line that shows it.
  function target(id,x,y){
    const found=zoneAt(id,x,y);if(!found)return null;
    const {zone,rect}=found,axis=ZONES[zone].axis,others=layout.zones[zone].filter(item=>item!==id);
    const visible=others.map(item=>({item,box:rectOf(item)})).filter(entry=>entry.box);
    const point=axis==='y'?y:x;
    const next=visible.find(({box})=>point<(axis==='y'?box.top+box.height/2:box.left+box.width/2));
    let index,line;
    if(next){index=others.indexOf(next.item);line=axis==='y'?{x:next.box.left,y:next.box.top-5,w:next.box.width,h:3}:{x:next.box.left-5,y:next.box.top,w:3,h:next.box.height};}
    else if(visible.length){const last=visible.at(-1);index=others.indexOf(last.item)+1;line=axis==='y'?{x:last.box.left,y:last.box.bottom+3,w:last.box.width,h:3}:{x:last.box.right+2,y:last.box.top,w:3,h:last.box.height};}
    else{index=0;line=axis==='y'?{x:rect.left+8,y:rect.top+8,w:rect.width-16,h:3}:{x:rect.right-12,y:rect.top+6,w:3,h:Math.max(24,rect.height-12)};}
    return {zone,index,line};
  }
  function showMarker(spot){
    marker.hidden=!spot;if(!spot)return;
    Object.assign(marker.style,{left:spot.line.x+'px',top:spot.line.y+'px',width:spot.line.w+'px',height:spot.line.h+'px'});
  }
  function highlight(id){for(const zone of Object.keys(ZONES)){const box=ZONES[zone].container();if(box)box.classList.toggle('is-layout-target',!!id&&layoutZonesFor(id).includes(zone));}}

  function down(event){
    if(inEditor(event.target)||!inMusic(event.target))return;
    event.preventDefault();event.stopImmediatePropagation();
    const node=event.target.closest('[data-layout-item]');if(!node||event.button!==0)return;
    const id=node.dataset.layoutItem;
    drag={id,x:event.clientX,y:event.clientY,pointer:event.pointerId,active:false,spot:null};
    document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',cancel,true);
  }
  function move(event){
    if(!drag||event.pointerId!==drag.pointer)return;
    if(!drag.active){
      if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<5)return;
      drag.active=true;document.documentElement.classList.add('music-layout-dragging');
      for(const node of NODES[drag.id]())node.classList.add('is-layout-dragging');
      ghost.textContent=LABELS[drag.id]();ghost.hidden=false;eye.hidden=true;highlight(drag.id);
    }
    event.preventDefault();
    ghost.style.transform=`translate(${event.clientX+14}px,${event.clientY+12}px)`;
    drag.spot=target(drag.id,event.clientX,event.clientY);showMarker(drag.spot);
  }
  function up(event){
    if(!drag||event.pointerId!==drag.pointer)return;
    const {id,active,spot}=drag;cancel();
    if(active&&spot)commit(moveLayoutItem(layout,id,spot.zone,spot.index),t('{block} moved',{block:LABELS[id]()}));
  }
  function cancel(){
    if(drag){for(const node of NODES[drag.id]())node.classList.remove('is-layout-dragging');}
    drag=null;marker.hidden=true;ghost.hidden=true;highlight(null);document.documentElement.classList.remove('music-layout-dragging');
    document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',cancel,true);
  }

  // Arrow keys move the focused block within its zone, and on into its other zone at either end.
  function key(event){
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(drag)cancel();else finish();return;}
    const node=document.activeElement?.closest?.('[data-layout-item]');
    if(!node||inEditor(node))return;
    if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopImmediatePropagation();return;}
    if(event.key==='Delete'||event.key==='h'||event.key==='H'){event.preventDefault();event.stopImmediatePropagation();if(HIDEABLE.includes(node.dataset.layoutItem))toggleHidden(node.dataset.layoutItem);return;}
    const step={ArrowUp:-1,ArrowLeft:-1,ArrowDown:1,ArrowRight:1}[event.key];if(!step)return;
    event.preventDefault();event.stopImmediatePropagation();
    const id=node.dataset.layoutItem,zones=layoutZonesFor(id),zone=zones.find(key=>layout.zones[key].includes(id));
    const list=layout.zones[zone],position=list.indexOf(id)+step;
    let next;
    if(position>=0&&position<list.length)next=moveLayoutItem(layout,id,zone,position);
    else if(zones.length>1){const other=zones[(zones.indexOf(zone)+(step>0?1:zones.length-1))%zones.length];next=moveLayoutItem(layout,id,other,step>0?0:layout.zones[other].length);}
    if(!next)return;
    commit(next,t('{block} moved',{block:LABELS[id]()}));
    NODES[id]()[0]?.focus({preventScroll:false});
  }

  onLanguageChange(labels);labels();apply();
  // Rebuilt pieces of the page land back where the layout wants them.
  const observer=new MutationObserver(()=>{if(!drag)queueMicrotask(apply);});
  for(const spec of Object.values(ZONES)){const box=spec.container();if(box)observer.observe(box,{childList:true});}
  return {edit,finish,get editing(){return editing;},get layout(){return layout;}};
}
