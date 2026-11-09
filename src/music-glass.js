// The play orb: its light follows the pointer, a press sends out a ripple, the play and pause symbols
// blend into each other, and its glow breathes with the bass when the Ambient analysis is running.
// Only the system's "reduce motion" setting stills the player; the app's calm mode is for the downloader.
const still=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

export function wireGlassOrb(button,{host:hostNode=null}={}){
  if(!button)return {energy(){}};
  let energy=0,shown=0;
  // The bass level is set on the whole transport, so the timeline's glow can breathe with the orb.
  const host=()=>hostNode||button.closest('.music-transport')||button;
  button.addEventListener('pointermove',event=>{
    const box=button.getBoundingClientRect();
    button.style.setProperty('--orb-x',`${Math.round((event.clientX-box.left)/box.width*100)}%`);
    button.style.setProperty('--orb-y',`${Math.round((event.clientY-box.top)/box.height*100)}%`);
    // The orb leans a little towards the pointer.
    if(!still()){button.style.setProperty('--mag-x',`${((event.clientX-box.left)/box.width-.5)*6}px`);button.style.setProperty('--mag-y',`${((event.clientY-box.top)/box.height-.5)*6}px`);}
  });
  button.addEventListener('pointerleave',()=>{for(const name of ['--orb-x','--orb-y','--mag-x','--mag-y'])button.style.removeProperty(name);});
  // A press wobbles the orb like a drop of liquid.
  button.addEventListener('click',()=>{
    if(still())return;
    button.animate([{transform:'scale(1,1)'},{transform:'scale(1.14,.84)',offset:.22},{transform:'scale(.9,1.1)',offset:.46},{transform:'scale(1.05,.96)',offset:.7},{transform:'scale(1,1)'}],{duration:620,easing:'ease-out',composite:'add'});
  });
  button.addEventListener('pointerdown',()=>{
    if(still())return;
    const ring=document.createElement('span');ring.className='music-orb-ripple';ring.setAttribute('aria-hidden','true');
    button.append(ring);ring.addEventListener('animationend',()=>ring.remove(),{once:true});
  });
  // The symbol is swapped by the player; fading it around the swap turns the change into a blend.
  new MutationObserver(records=>{
    if(still()||!records.some(record=>record.attributeName==='data-icon'))return;
    button.classList.add('is-morphing');requestAnimationFrame(()=>requestAnimationFrame(()=>button.classList.remove('is-morphing')));
  }).observe(button,{subtree:true,attributes:true,attributeFilter:['data-icon']});
  return {
    // Bass level 0..1; rises quickly and settles slowly so the orb breathes rather than flickers.
    energy(level){
      if(still()){if(shown){shown=0;host().style.removeProperty('--orb-energy');}return;}
      const value=Math.max(0,Math.min(1,Number(level)||0));energy=value>energy?value:energy*.9+value*.1;
      const rounded=Math.round(energy*50)/50;if(rounded===shown)return;shown=rounded;host().style.setProperty('--orb-energy',String(rounded));
    },
  };
}

// Each player button answers a press in its own way: skips slide the symbol out and back in their
// direction, repeat turns, shuffle twists, a like pops with a small burst, and switching a mode on
// sends out a ring. Animations run on the symbol (or the heart) so they never fight the button's own
// hover and press scale.
const SPRING='cubic-bezier(.2,1.25,.3,1)';
const PLAYER='.music-dock,.music-stage,.music-mini-page';
const BUTTONS='.music-transport-buttons>button,.music-dock-extras>button,.music-like,.mini-controls>button';
function motionFor(icon){
  if(/^skip-forward/.test(icon))return {frames:[{transform:'translateX(0)',opacity:1},{transform:'translateX(12px)',opacity:0,offset:.38},{transform:'translateX(-12px)',opacity:0,offset:.4},{transform:'translateX(0)',opacity:1}],duration:420,easing:'ease-out'};
  if(/^skip-back/.test(icon))return {frames:[{transform:'translateX(0)',opacity:1},{transform:'translateX(-12px)',opacity:0,offset:.38},{transform:'translateX(12px)',opacity:0,offset:.4},{transform:'translateX(0)',opacity:1}],duration:420,easing:'ease-out'};
  if(/^repeat/.test(icon))return {frames:[{transform:'rotate(0)'},{transform:'rotate(360deg)'}],duration:560,easing:'cubic-bezier(.3,.9,.2,1)'};
  if(/^shuffle/.test(icon))return {frames:[{transform:'rotate(0) scaleX(1)'},{transform:'rotate(-14deg) scaleX(.86)',offset:.35},{transform:'rotate(8deg) scaleX(1.06)',offset:.7},{transform:'rotate(0) scaleX(1)'}],duration:480,easing:'ease-out'};
  return {frames:[{transform:'scale(1)'},{transform:'scale(.78)',offset:.3},{transform:'scale(1.14)',offset:.68},{transform:'scale(1)'}],duration:440,easing:SPRING};
}
function burst(button){
  const ring=document.createElement('span');ring.className='music-like-burst';ring.setAttribute('aria-hidden','true');
  for(let index=0;index<8;index++){const dot=document.createElement('i');dot.style.setProperty('--turn',`${index*45}deg`);ring.append(dot);}
  button.append(ring);ring.addEventListener('animationend',()=>ring.remove(),{once:true});
}
function ringOut(button){
  const ring=document.createElement('span');ring.className='music-mode-ring';ring.setAttribute('aria-hidden','true');
  button.append(ring);ring.addEventListener('animationend',()=>ring.remove(),{once:true});
}
export function wireGlassButtons(root=document){
  // The symbol leans towards the pointer and the glass catches the light where the pointer is.
  let lit=null,frame=0,px=0,py=0;
  const paint=()=>{frame=0;if(!lit)return;const box=lit.getBoundingClientRect(),fx=(px-box.left)/box.width,fy=(py-box.top)/box.height;
    lit.style.setProperty('--bx',`${Math.round(fx*100)}%`);lit.style.setProperty('--by',`${Math.round(fy*100)}%`);
    if(!still()){lit.style.setProperty('--mag-x',`${((fx-.5)*5).toFixed(2)}px`);lit.style.setProperty('--mag-y',`${((fy-.5)*5).toFixed(2)}px`);}};
  const clear=node=>{if(node)for(const name of ['--bx','--by','--mag-x','--mag-y'])node.style.removeProperty(name);};
  root.addEventListener('pointermove',event=>{
    const button=event.target instanceof Element?event.target.closest(BUTTONS):null;
    const next=button&&button.closest(PLAYER)&&!button.classList.contains('music-play-button')?button:null;
    if(next!==lit){clear(lit);lit=next;}
    if(!lit)return;px=event.clientX;py=event.clientY;if(!frame)frame=requestAnimationFrame(paint);
  });
  root.addEventListener('click',event=>{
    if(still()||!(event.target instanceof Element))return;
    const button=event.target.closest(BUTTONS);
    if(!button||!button.closest(PLAYER)||button.classList.contains('music-play-button')||button.disabled)return;
    const wasOn=button.getAttribute('aria-pressed')==='true';
    const icon=button.querySelector('.icon');
    const like=button.classList.contains('music-like');
    // The player updates the button in the same task; the outcome is read once it has.
    requestAnimationFrame(()=>{
      const on=button.getAttribute('aria-pressed')==='true';
      if(like){button.animate([{transform:'scale(1)'},{transform:'scale(.7)',offset:.25},{transform:'scale(1.3)',offset:.6},{transform:'scale(1)'}],{duration:520,easing:SPRING});if(on)burst(button);return;}
      const target=icon||button,{frames,duration,easing}=motionFor(icon?.dataset.icon||'');
      target.animate(frames,{duration,easing});
      if(on&&!wasOn)ringOut(button);
    });
  });
}
