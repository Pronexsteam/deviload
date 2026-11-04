// Paint the same range track in all three players, including values updated by
// playback rather than user input. Never dispatch an input or change volume.
const selector='.music-dock input[type="range"],.music-stage input[type="range"],.music-mini-page input[type="range"]';
const clocks=new WeakMap(),dragging=new Set();
export const isRangeDragging=input=>dragging.has(input);
export function registerPlaybackRange(input,read){clocks.set(input,read);}
export function paintPlaybackRange(input){
 const min=Number(input.min)||0,max=Number(input.max)||100,value=Number(input.value)||0;
 const fraction=max>min?Math.max(0,Math.min(1,(value-min)/(max-min))):0,progress=(fraction*100).toFixed(4)+'%';
 // Native thumbs travel between half-thumb insets, not the full track width.
 const fill=`calc(${progress} + ${(0.5-fraction).toFixed(6)} * var(--player-thumb-size, 10px))`;
 if(input.style.getPropertyValue('--range-progress')!==progress)input.style.setProperty('--range-progress',progress);
 if(input.style.getPropertyValue('--range-fill')!==fill)input.style.setProperty('--range-fill',fill);
}
const paint=paintPlaybackRange;
document.addEventListener('input',event=>{if(event.target.matches(selector))paint(event.target);});
document.addEventListener('pointerdown',event=>{if(event.target.matches(selector))dragging.add(event.target);});
for(const event of ['pointerup','pointercancel','blur'])window.addEventListener(event,()=>dragging.clear());
// Moving the same controls between the dock and modal changes membership, but
// playback timestamps and CSS animations do not. Avoid a document-wide selector
// on every frame; text-only updates must not invalidate the cached controls.
let frame=0,ranges=[],dirty=true;
const observer=new MutationObserver(records=>{
 if(records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1)))dirty=true;
});
observer.observe(document.documentElement,{childList:true,subtree:true});
function tick(){frame=0;if(document.hidden)return;if(dirty){ranges=[...document.querySelectorAll(selector)];dirty=false;}ranges.forEach(input=>{if(!input.isConnected)return;const read=clocks.get(input);if(read&&!dragging.has(input)){const value=read();if(Number.isFinite(value))input.value=String(value);}paint(input);});frame=requestAnimationFrame(tick);}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!frame)tick();});tick();
window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);frame=0;observer.disconnect();ranges=[];},{once:true});
