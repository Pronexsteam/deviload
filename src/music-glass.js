// The play orb: its light follows the pointer, a press sends out a ripple, the play and pause symbols
// blend into each other, and its glow breathes with the bass when the Ambient analysis is running.
const still=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.dataset.motion==='reduced';

export function wireGlassOrb(button){
  if(!button)return {energy(){}};
  let energy=0,shown=0;
  button.addEventListener('pointermove',event=>{
    const box=button.getBoundingClientRect();
    button.style.setProperty('--orb-x',`${Math.round((event.clientX-box.left)/box.width*100)}%`);
    button.style.setProperty('--orb-y',`${Math.round((event.clientY-box.top)/box.height*100)}%`);
  });
  button.addEventListener('pointerleave',()=>{button.style.removeProperty('--orb-x');button.style.removeProperty('--orb-y');});
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
      if(still()){if(shown){shown=0;button.style.removeProperty('--orb-energy');}return;}
      const value=Math.max(0,Math.min(1,Number(level)||0));energy=value>energy?value:energy*.9+value*.1;
      const rounded=Math.round(energy*50)/50;if(rounded===shown)return;shown=rounded;button.style.setProperty('--orb-energy',String(rounded));
    },
  };
}
