import {t} from './i18n.js';

const controllers=new WeakMap();
let sequence=0;

// Render calls refresh; one observer owns all live shelves in this root.
// No wheel handler is needed: trackpads and Shift+wheel retain native scrolling.
export function enhanceMusicShelves(root){
  if(controllers.has(root)){const controller=controllers.get(root);controller.refresh();return controller;}
  const rows=new Map(),view=root.ownerDocument.defaultView;
  let frame=0,destroyed=false;
  const update=()=>{
    frame=0;
    for(const [grid,row]of rows){
      if(!root.contains(grid))continue;
      const max=Math.max(0,grid.scrollWidth-grid.clientWidth),position=Math.max(0,Math.min(max,grid.scrollLeft)),horizontal=view.getComputedStyle(grid).gridAutoFlow.includes('column');
      const previousUnavailable=!horizontal||position<=2,nextUnavailable=!horizontal||max-position<=2;
      row.previous.disabled=previousUnavailable;row.previous.hidden=previousUnavailable;
      row.next.disabled=nextUnavailable;row.next.hidden=nextUnavailable;
      row.wrapper.classList.toggle('music-shelf-overflows',horizontal&&max>2);
      const art=grid.querySelector('.music-art'),bounds=row.wrapper.getBoundingClientRect();
      if(art){const image=art.getBoundingClientRect();row.wrapper.style.setProperty('--music-shelf-control-y',`${Math.max(20,image.top-bounds.top+image.height/2)}px`);}
    }
  };
  const schedule=()=>{if(!destroyed&&!frame)frame=view.requestAnimationFrame(update);};
  const observer=typeof view.ResizeObserver==='function'?new view.ResizeObserver(schedule):null;
  const detach=(grid,row,unwrap=false)=>{
    observer?.unobserve(grid);if(row.art)observer?.unobserve(row.art);
    grid.removeEventListener('scroll',schedule);row.previous.remove();row.next.remove();
    grid.classList.remove('music-shelf-scroll');
    if(row.generatedId)grid.removeAttribute('id');
    if(unwrap&&row.wrapper.parentNode){row.wrapper.before(grid);row.wrapper.remove();}
    rows.delete(grid);
  };
  const makeButton=(direction,grid)=>{
    const button=root.ownerDocument.createElement('button');
    button.type='button';button.className=`music-shelf-arrow music-shelf-arrow-${direction<0?'previous':'next'}`;
    button.setAttribute('aria-controls',grid.id);
    const chevron=root.ownerDocument.createElement('span');chevron.className='music-shelf-chevron';chevron.setAttribute('aria-hidden','true');button.append(chevron);
    button.addEventListener('click',()=>{
      const reduced=view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      grid.scrollBy({left:direction*Math.max(1,Math.round(grid.clientWidth*.8)),behavior:reduced?'auto':'smooth'});
      schedule();
    });
    return button;
  };
  const refresh=()=>{
    if(destroyed)return;
    for(const [grid,row]of rows)if(!root.contains(grid))detach(grid,row);
    for(const grid of root.querySelectorAll('.music-card-grid')){
      if(rows.has(grid)||!view.getComputedStyle(grid).gridAutoFlow.includes('column'))continue;
      const wrapper=root.ownerDocument.createElement('div');wrapper.className='music-shelf-navigation';
      const generatedId=!grid.id;if(generatedId)grid.id=`music-shelf-scroll-${++sequence}`;
      grid.before(wrapper);wrapper.append(grid);grid.classList.add('music-shelf-scroll');
      const previous=makeButton(-1,grid),next=makeButton(1,grid),art=grid.querySelector('.music-art');
      wrapper.append(previous,next);rows.set(grid,{wrapper,previous,next,art,generatedId});
      grid.addEventListener('scroll',schedule,{passive:true});observer?.observe(grid);if(art)observer?.observe(art);
    }
    for(const row of rows.values()){
      row.previous.setAttribute('aria-label',t('Previous tracks'));row.previous.title=t('Previous tracks');
      row.next.setAttribute('aria-label',t('Next tracks'));row.next.title=t('Next tracks');
    }
    if(frame)view.cancelAnimationFrame(frame);frame=0;update();
  };
  const destroy=()=>{
    destroyed=true;if(frame)view.cancelAnimationFrame(frame);frame=0;
    observer?.disconnect();view.removeEventListener('resize',schedule);
    for(const [grid,row]of rows)detach(grid,row,true);
    controllers.delete(root);
  };
  view.addEventListener('resize',schedule,{passive:true});
  const controller={refresh,destroy};controllers.set(root,controller);refresh();return controller;
}
