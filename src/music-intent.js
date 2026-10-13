// A deliberate hover or keyboard focus may prepare one likely selection.
// Scrolling past cards never starts work; retries and memory are bounded.
export function createMusicIntent({prepare,allowed,now=Date.now,schedule=setTimeout,cancel=clearTimeout}) {
  let timer=null,busy=false;
  const recent=new Map(),starts=[];
  function leave(){if(timer!==null)cancel(timer);timer=null;}
  function enter(id){
    leave();
    if(!/^[\w-]{11}$/.test(id)||!allowed()||busy)return;
    timer=schedule(async()=>{
      timer=null;
      const at=now();
      while(starts.length&&at-starts[0]>=60000)starts.shift();
      if(!allowed()||busy||starts.length>=2||(recent.has(id)&&at-recent.get(id)<300000))return;
      if(recent.size>=16)recent.delete(recent.keys().next().value);
      recent.set(id,at);starts.push(at);busy=true;
      try{await prepare(id);}catch{/* The next explicit play reports an error if necessary. */}
      finally{busy=false;}
    },650);
  }
  return {enter,leave};
}
