import {t,errorText} from "./i18n.js";
export function parseLyrics(raw){
  if(typeof raw!=="string")return [];
  const lines=[];for(const line of raw.slice(0,250000).split('\n')){
    const text=line.replace(/\[\d+:\d+(?:\.\d+)?\]/g,"").trim();
    for(const match of line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)){const at=Number(match[1])*60+Number(match[2]);if(Number.isFinite(at)&&at<=86400)lines.push({at,text});}
  }return lines.sort((a,b)=>a.at-b.at).slice(0,3000);
}
export function createMusicLyrics({invoke,button,getTrack,getAudio}){
  const dialog=document.createElement("dialog");dialog.className="music-lyrics-dialog";dialog.setAttribute("aria-label",t("Lyrics"));
  const heading=document.createElement("h2"),body=document.createElement("div"),credit=document.createElement("p");credit.textContent="LRCLIB";dialog.append(button(t("Close"),"x-circle",()=>dialog.close()),heading,body,credit);document.body.append(dialog);
  let request=0,id=null,lines=[],active=-1;const cache=new Map();
  async function load(){const track=getTrack();if(!track)return;const token=++request;id=track.id;heading.textContent=track.title;body.textContent=t("Finding lyrics…");lines=[];active=-1;
    try{
      const duration=getAudio().duration;if(!Number.isFinite(duration)||duration<=0){body.textContent=t("Start playback to load lyrics.");id=null;return;}
      let result=cache.get(id);if(!cache.has(id)){result=await invoke("music_lyrics",{title:track.title,artist:track.artists?.[0]||track.subtitle?.split(' · ')[0]||"",duration});if(result){if(cache.size>=30)cache.delete(cache.keys().next().value);cache.set(track.id,result);}}
      if(token!==request)return;body.replaceChildren();lines=parseLyrics(result?.synced);
      if(lines.length){for(const line of lines){const row=button(line.text||"♪",null,()=>{getAudio().currentTime=line.at;},"music-lyric-line");body.append(row);}}
      else{const text=document.createElement("p");text.className="music-lyrics-plain";text.textContent=result?.plain||(result?.instrumental?t("Instrumental"):t("No matching lyrics found."));body.append(text);}
    }catch(error){if(token===request)body.textContent=errorText(error);}
  }
  dialog.addEventListener("close",()=>{++request;});
  return {open(){dialog.showModal();load();},update(){if(!dialog.open)return;if(getTrack()?.id!==id){load();return;}const time=getAudio().currentTime;let index=-1;for(let i=0;i<lines.length&&lines[i].at<=time;i++)index=i;
    if(index!==active){body.children[active]?.classList.remove("active");active=index;const row=body.children[index];if(row){row.classList.add("active");row.scrollIntoView({block:"nearest",behavior:"smooth"});}}
  }};
}
