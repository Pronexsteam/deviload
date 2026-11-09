// Arrow keys in search results: Down from the search field enters the results, arrows move to the
// nearest result in that direction, Enter plays or opens it, Up from the top or Escape returns to the field.
const TARGETS='.music-best-art,.music-track-select,.music-card-main';
const visible=node=>node.getClientRects().length>0&&!node.closest('[hidden]');

// The nearest target from [from] in [direction], preferring ones in line with it.
export function nearestInDirection(from,boxes,direction){
  const vertical=direction==='down'||direction==='up';
  let best=null,score=Infinity;
  for(const {box,node} of boxes){
    // Distance along the move, edge to edge, and how far off to the side (zero when they overlap).
    const along=direction==='down'?box.top-from.bottom:direction==='up'?from.top-box.bottom:direction==='right'?box.left-from.right:from.left-box.right;
    if(along<-4)continue;
    const across=vertical?Math.max(0,box.left-from.right,from.left-box.right):Math.max(0,box.top-from.bottom,from.top-box.bottom);
    const value=Math.max(0,along)+across*3;
    if(value<score){score=value;best=node;}
  }
  return best;
}

export function wireResultKeys({input,root}){
  if(!input||!root)return {enter:()=>false};
  const items=()=>[...root.querySelectorAll(TARGETS)].filter(visible);
  const show=node=>{node.focus({preventScroll:true});node.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});};
  root.addEventListener('keydown',event=>{
    if(!(event.target instanceof Element)||!event.target.matches(TARGETS))return;
    if(event.key==='Escape'){event.preventDefault();input.focus();return;}
    const direction={ArrowDown:'down',ArrowUp:'up',ArrowLeft:'left',ArrowRight:'right'}[event.key];
    if(!direction)return;
    event.preventDefault();
    const from=event.target.getBoundingClientRect();
    const next=nearestInDirection(from,items().filter(node=>node!==event.target).map(node=>({node,box:node.getBoundingClientRect()})),direction);
    if(next)show(next);else if(direction==='up')input.focus();
  });
  return {
    // Called by the search field on Down when no suggestion list is open.
    enter(){const first=items()[0];if(!first)return false;show(first);return true;},
  };
}
