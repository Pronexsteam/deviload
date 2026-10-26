// Metadata requests have their own lifetime; they never resolve a media stream.
export function cinemaInput(value) {
  const text=String(value||"").trim();
  if(!text)return {kind:"empty",value:""};
  if(/^(?:www\.)?(?:youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com)\//i.test(text))return {kind:"url",value:`https://${text}`};
  if(/^(?:[a-z][a-z\d+.-]*:\/|(?:file|data|javascript|mailto):|www\.|(?:[\w-]+\.)+[a-z]{2,}(?:\/|$))/i.test(text))return {kind:"url",value:text};
  return {kind:"text",value:text};
}
export function videoCards(entries,exclude="") {
  const seen=new Set([exclude]);
  return (entries||[]).filter(item=>{
    if(!/^[\w-]{11}$/.test(item.id)||seen.has(item.id)||item.unavailable||!item.title)return false;
    seen.add(item.id);return true;
  }).slice(0,20).map(item=>({...item,kind:"online-video"}));
}
export function createVideoSearch(invoke,lane,{delay=350,now=Date.now}={}) {
  let generation=0,timer=null,settle=null,barrier=Promise.resolve();
  const cache=new Map();
  function cancel(){
    generation++;clearTimeout(timer);timer=null;settle?.(null);settle=null;
    barrier=barrier.then(()=>invoke("cinema_cancel_search",{lane})).catch(()=>{});
  }
  return {
    cancel,
    search(query,{immediate=false}={}){
      cancel();const token=generation,key=query.trim().replace(/\s+/g," ");
      if(!key)return Promise.resolve([]);
      const hit=cache.get(key);
      if(hit&&now()-hit.at<600000){cache.delete(key);cache.set(key,hit);return Promise.resolve(hit.rows);}
      return new Promise((resolve,reject)=>{
        settle=resolve;
        timer=setTimeout(async()=>{
          timer=null;
          try{
            await barrier;if(token!==generation)return;
            const rows=videoCards(await invoke("cinema_search",{query:key,lane}));
            if(token!==generation)return;
            cache.delete(key);cache.set(key,{at:now(),rows});while(cache.size>12)cache.delete(cache.keys().next().value);
            settle=null;resolve(rows);
          }catch(error){if(token===generation){settle=null;reject(error);}}
        },immediate?0:delay);
      });
    }
  };
}
