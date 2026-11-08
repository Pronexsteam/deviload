const EASE='cubic-bezier(.2,.8,.2,1)';
const calm=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches!==false;

export function revealView(node){
 if(calm()||!node?.animate)return;
 node.animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none'}],{duration:240,easing:EASE});
}

export function flyFrom(node,origin,{radius='',duration=420}={}){
 if(calm()||!node?.animate||!origin?.width)return;
 const target=node.getBoundingClientRect();if(!target.width||!target.height)return;
 const x=origin.left+origin.width/2-(target.left+target.width/2),y=origin.top+origin.height/2-(target.top+target.height/2),scale=origin.width/target.width;
 node.animate([{transform:`translate(${x}px,${y}px) scale(${scale})`,...(radius?{borderRadius:radius}:{})},{transform:'none'}],{duration,easing:EASE});
}

export function fadeIn(node,duration=260){
 if(calm()||!node?.animate)return;
 node.animate([{opacity:0},{opacity:1}],{duration,easing:'ease-out'});
}
