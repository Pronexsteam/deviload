// Hover light for songs: rows catch a soft light under the pointer and cards tilt towards it with a glass
// glare. One listener for the whole music page; it writes only to the element under the pointer.
const ROWS='.music-track-row,.music-card-main';
const still=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

export function wireHoverLight(root){
  if(!root)return;
  let target=null,frame=0,x=0,y=0;
  function paint(){
    frame=0;if(!target)return;
    const box=target.getBoundingClientRect(),fx=(x-box.left)/box.width,fy=(y-box.top)/box.height;
    target.style.setProperty('--mx',`${(fx*100).toFixed(1)}%`);target.style.setProperty('--my',`${(fy*100).toFixed(1)}%`);
    if(target.classList.contains('music-card-main')&&!still()){
      target.style.setProperty('--ry',`${((fx-.5)*8).toFixed(2)}deg`);target.style.setProperty('--rx',`${((.5-fy)*8).toFixed(2)}deg`);
    }
  }
  function leave(node){if(!node)return;for(const name of ['--mx','--my','--rx','--ry'])node.style.removeProperty(name);node.classList.remove('is-lit');}
  root.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    const next=event.target instanceof Element?event.target.closest(ROWS):null;
    if(next!==target){leave(target);target=next;target?.classList.add('is-lit');}
    if(!target)return;x=event.clientX;y=event.clientY;if(!frame)frame=requestAnimationFrame(paint);
  });
  root.addEventListener('pointerleave',()=>{leave(target);target=null;});
}
