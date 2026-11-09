import {createLean} from './music-lean.js';
// Hover light for songs: rows catch a soft light under the pointer and cards tilt towards it with a glass
// glare. One listener for the whole music page; it writes only to the element under the pointer.
const ROWS='.music-track-row,.music-card-main';

export function wireHoverLight(root){
  if(!root)return;
  let target=null,frame=0,x=0,y=0;const tilts=new WeakMap();
  // Cards tilt on a spring, so they follow the pointer softly and settle back when it leaves.
  const tiltOf=node=>{let tilt=tilts.get(node);if(!tilt){tilt=createLean((rx,ry,settled)=>{if(settled&&!rx&&!ry){node.style.removeProperty('--rx');node.style.removeProperty('--ry');return;}node.style.setProperty('--rx',`${rx.toFixed(2)}deg`);node.style.setProperty('--ry',`${ry.toFixed(2)}deg`);},{stiffness:.1,damping:.76});tilts.set(node,tilt);}return tilt;};
  function paint(){
    frame=0;if(!target)return;
    const box=target.getBoundingClientRect(),fx=(x-box.left)/box.width,fy=(y-box.top)/box.height;
    target.style.setProperty('--mx',`${(fx*100).toFixed(1)}%`);target.style.setProperty('--my',`${(fy*100).toFixed(1)}%`);
    if(target.classList.contains('music-card-main'))tiltOf(target).to((.5-fy)*9,(fx-.5)*9);
  }
  function leave(node){if(!node)return;node.style.removeProperty('--mx');node.style.removeProperty('--my');node.classList.remove('is-lit');if(node.classList.contains('music-card-main'))tiltOf(node).release();}
  root.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    const next=event.target instanceof Element?event.target.closest(ROWS):null;
    if(next!==target){leave(target);target=next;target?.classList.add('is-lit');}
    if(!target)return;x=event.clientX;y=event.clientY;if(!frame)frame=requestAnimationFrame(paint);
  });
  root.addEventListener('pointerleave',()=>{leave(target);target=null;});
}
