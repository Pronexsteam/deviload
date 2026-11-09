// Pointer capture avoids WebView native drag/drop handoff, and also supports
// touch. Capture belongs to the stable panel while virtualized rows change.
export function wireQueueHandle(handle,row,panel,id,move){
 handle.draggable=false;handle.style.touchAction='none';
 handle.addEventListener('pointerdown',event=>{
  if(event.button!==0||!event.isPrimary)return;
  event.preventDefault();event.stopPropagation();
  const pointer=event.pointerId,startX=event.clientX,startY=event.clientY,startScroll=panel.scrollTop;
  // The lifted row floats with the pointer; it ignores the pointer itself so the row beneath can be found.
  const float=()=>{if(row.style)row.style.translate=`0 ${y-startY+panel.scrollTop-startScroll}px`;};
  let dragging=false,target=null,y=startY,x=startX,frame=0,ended=false;
  const clear=()=>panel.querySelectorAll('.drop-target').forEach(node=>node.classList.remove('drop-target'));
  const locate=()=>{
   clear();const candidate=document.elementFromPoint(x,y)?.closest('.music-queue-track');
   target=candidate&&panel.contains(candidate)&&candidate.dataset.trackId!==id?candidate:null;
   target?.classList.add('drop-target');
  };
  const tick=()=>{
   frame=0;if(ended||!dragging)return;if(!panel.isConnected||panel.hidden){stop({pointerId:pointer});return;}const bounds=panel.getBoundingClientRect();
   if(y<bounds.top+40)panel.scrollTop-=10;else if(y>bounds.bottom-40)panel.scrollTop+=10;
   float();locate();frame=requestAnimationFrame(tick);
  };
  const update=next=>{if(next.pointerId!==pointer)return;x=next.clientX;y=next.clientY;if(!dragging&&Math.hypot(x-startX,y-startY)>=6){dragging=true;row.classList.add('dragging');frame=requestAnimationFrame(tick);}if(dragging){float();locate();}};
  const finish=(next,cancel=false)=>{
   if(next.pointerId!==pointer||ended)return;ended=true;cancelAnimationFrame(frame);
   const position=target?Number(target.getAttribute('aria-posinset'))-1:-1;
   clear();row.classList.remove('dragging');if(row.style)row.style.translate='';panel.removeEventListener('pointermove',update);panel.removeEventListener('pointerup',up);panel.removeEventListener('pointercancel',stop);panel.removeEventListener('lostpointercapture',stop);
   if(panel.hasPointerCapture(pointer))panel.releasePointerCapture(pointer);
   if(!cancel&&dragging&&position>=0)move(id,position);
  };
  const up=next=>finish(next),stop=next=>finish(next,true);
  panel.addEventListener('pointermove',update);panel.addEventListener('pointerup',up);panel.addEventListener('pointercancel',stop);panel.addEventListener('lostpointercapture',stop);
  panel.setPointerCapture(pointer);
 });
}
