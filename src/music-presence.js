import {t,onLanguageChange} from "./i18n.js";

export function createMusicPresence({invoke,storage,getPlayback}){
  const input=document.getElementById("music-discord-presence"),notice=document.getElementById("music-discord-notice");
  const native=Boolean(window.__TAURI__?.core?.invoke);
  let enabled=false,last="",lastSent=0,busy=false,pending=false;
  try{enabled=storage?.getItem("deviload-discord-presence")==="true";}catch{/* optional preference */}
  input.checked=enabled;input.disabled=!native;
  function explain(){notice.textContent=native?t("Share the song and artist with Discord while playing. Requires Discord Desktop and activity sharing. Hidden during private sessions."):t("Discord status is available in Deviload Desktop.");}
  explain();onLanguageChange(explain);
  async function sync(force=false){
    if(!native)return;
    if(busy){pending=true;return;}
    const state=getPlayback(),share=enabled&&!state.privateSession&&state.playing;
    const presence={enabled,playing:share,privateSession:state.privateSession,title:share?state.title:"",artist:share?state.artist:"",image:share?state.image:"",position:share?state.position:0,duration:share?state.duration:0};
    const signature=JSON.stringify([enabled,share,presence.title,presence.artist]);
    if(!force&&signature===last&&Date.now()-lastSent<15000)return;
    last=signature;lastSent=Date.now();busy=true;
    try{const configured=await invoke("music_presence",{presence});if(!configured){notice.textContent=t("Discord integration is not configured in this build.");}}
    catch{notice.textContent=t("Could not update Discord status.");last="";}
    finally{busy=false;if(pending){pending=false;sync(true);}}
  }
  input.addEventListener("change",()=>{enabled=input.checked;try{storage?.setItem("deviload-discord-presence",String(enabled));}catch{/* optional preference */}explain();sync(true);});
  return {sync};
}
