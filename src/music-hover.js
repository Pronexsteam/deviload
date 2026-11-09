import {createLean} from './music-lean.js';
// Hover light for songs: rows catch a soft light under the pointer and cards tilt towards it with a glass
// glare. One listener for the whole music page; it writes only to the element under the pointer.
const ROWS='.music-track-row,.music-card-main';

export function wireHoverLight(root){
  if(!root)return;
  let target=null,rest=null,frame=0,x=0,y=0;const tilts=new WeakMap();
  // Cards tilt on a spring, so they follow the pointer softly and settle back when it leaves.
  const tiltOf=node=>{let tilt=tilts.get(node);if(!tilt){tilt=createLean((rx,ry,settled)=>{if(settled&&!rx&&!ry){node.style.removeProperty('--rx');node.style.removeProperty('--ry');return;}node.style.setProperty('--rx',`${rx.toFixed(2)}deg`);node.style.setProperty('--ry',`${ry.toFixed(2)}deg`);},{stiffness:.1,damping:.76});tilts.set(node,tilt);}return tilt;};
  function paint(){
    frame=0;if(!target)return;
    // Cards are measured where they rested when the pointer arrived; measuring the tilted, lifted card would
    // feed its own movement back and make it shake.
    const box=rest||(rest=target.getBoundingClientRect()),fx=Math.max(0,Math.min(1,(x-box.left)/box.width)),fy=Math.max(0,Math.min(1,(y-box.top)/box.height));
    target.style.setProperty('--mx',`${(fx*100).toFixed(1)}%`);target.style.setProperty('--my',`${(fy*100).toFixed(1)}%`);
    if(target.classList.contains('music-card-main'))tiltOf(target).to((.5-fy)*7,(fx-.5)*7);
  }
  function leave(node){if(!node)return;node.style.removeProperty('--mx');node.style.removeProperty('--my');node.classList.remove('is-lit');if(node.classList.contains('music-card-main'))tiltOf(node).release();}
  root.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    const next=event.target instanceof Element?event.target.closest(ROWS):null;
    if(next!==target){leave(target);target=next;rest=target?.getBoundingClientRect()||null;target?.classList.add('is-lit');}
    if(!target)return;x=event.clientX;y=event.clientY;if(!frame)frame=requestAnimationFrame(paint);
  });
  root.addEventListener('pointerleave',()=>{leave(target);target=null;rest=null;});
  // Scrolling moves the cards under a still pointer, so their resting place is measured again.
  root.addEventListener('scroll',()=>{if(target)rest=null;},{capture:true,passive:true});
}
