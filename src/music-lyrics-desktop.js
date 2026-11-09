// Sends the current lyric line to the windows that show it: the floating desktop strip and the
// mini-player. Lines flow only while one of them is open.
export function wireLyricsLines({invoke,lyrics,audios=[],isMiniOpen=()=>false,getAccent=()=>'',listen=window.__TAURI__?.event?.listen}){
  let stripOpen=false,stripLocked=false,unwatch=null;const changes=new Set();
  const notify=()=>{for(const change of changes)change({open:stripOpen,locked:stripLocked});};
  const send=state=>invoke('lyrics_line_update',{state:{...state,accent:getAccent()||''}}).catch(()=>{});
  function refresh(){
    const wanted=stripOpen||isMiniOpen();
    if(wanted&&!unwatch)unwatch=lyrics.watch(send);
    else if(!wanted&&unwatch){unwatch();unwatch=null;}
  }
  // Pausing, seeking or changing speed must reach the other windows at once, not with the next line.
  for(const audio of audios)for(const name of ['play','pause','seeked','ratechange','ended'])audio.addEventListener(name,()=>{if(unwatch)lyrics.update();});
  listen?.('lyrics-overlay-closed',()=>{stripOpen=false;stripLocked=false;refresh();notify();});
  listen?.('lyrics-overlay-locked',({payload})=>{stripLocked=!!payload;notify();});
  listen?.('music-mini-closed',()=>setTimeout(refresh,0));
  setInterval(refresh,1000);
  return {
    get open(){return stripOpen;},get locked(){return stripLocked;},
    onChange(change){changes.add(change);return ()=>changes.delete(change);},
    async toggle(){
      // A locked strip lets clicks through and hides its own buttons, so the first press unlocks it.
      if(stripOpen&&stripLocked){await invoke('lyrics_overlay_action',{action:'unlock'});return;}
      if(stripOpen){await invoke('lyrics_overlay_close');return;}
      await invoke('lyrics_overlay_open');stripOpen=true;
      // A fresh subscription sends the current line at once, even if the mini-player already had it.
      unwatch?.();unwatch=null;refresh();notify();
    },
    unlock(){if(stripOpen)invoke('lyrics_overlay_action',{action:'unlock'}).catch(()=>{});},
    refresh,
  };
}
