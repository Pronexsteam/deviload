// Paint the same range track in all three players, including values updated by
// playback rather than user input. Never dispatch an input or change volume.
const selector='.music-dock input[type="range"],.music-stage input[type="range"],.music-mini-page input[type="range"]';
const clocks=new WeakMap(),dragging=new Set();
export const isRangeDragging=input=>dragging.has(input);
export function registerPlaybackRange(input,read){clocks.set(input,read);}
function paint(input){const min=Number(input.min)||0,max=Number(input.max)||100,value=Number(input.value)||0;const progress=(max>min?Math.max(0,Math.min(100,(value-min)/(max-min)*100)):0).toFixed(2)+'%';if(input.style.getPropertyValue('--range-progress')!==progress)input.style.setProperty('--range-progress',progress);}
document.addEventListener('input',event=>{if(event.target.matches(selector))paint(event.target);});
document.addEventListener('pointerdown',event=>{if(event.target.matches(selector))dragging.add(event.target);});
for(const event of ['pointerup','pointercancel','blur'])window.addEventListener(event,()=>dragging.clear());
let frame=0;
function tick(){frame=0;if(document.hidden)return;document.querySelectorAll(selector).forEach(input=>{const read=clocks.get(input);if(read&&!dragging.has(input)){const value=read();if(Number.isFinite(value))input.value=String(value);}paint(input);});frame=requestAnimationFrame(tick);}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!frame)tick();});tick();
window.addEventListener('pagehide',()=>cancelAnimationFrame(frame),{once:true});
