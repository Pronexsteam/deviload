// Crossfade cached cover images without animating layout or sampling pixels.
export function createArtworkWash(host){
 let current=null,source='',timer=0;
 return {update(value){
  if(value===source)return;source=value;clearTimeout(timer);
  for(const node of [...host.children])if(node!==current)node.remove();
  const previous=current,node=document.createElement('i');node.style.backgroundImage=value;host.append(node);current=node;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){previous?.remove();return;}
  node.animate([{opacity:0},{opacity:1}],{duration:420,easing:'ease-out'});
  if(previous){previous.animate([{opacity:1},{opacity:0}],{duration:420,fill:'forwards'});timer=setTimeout(()=>previous.remove(),430);}
 },dispose(){clearTimeout(timer);host.remove();}};
}
