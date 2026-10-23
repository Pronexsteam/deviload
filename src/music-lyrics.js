import {t,errorText,onLanguageChange} from "./i18n.js";
import {timedLyrics,lyricFrame} from "./music-lyrics-timing.js";
export function parseLyrics(raw){
  if(typeof raw!=="string")return [];
  const lines=[];for(const line of raw.slice(0,250000).split('\n')){
    const text=line.replace(/\[\d+:\d+(?:\.\d+)?\]/g,"").trim();
    for(const match of line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)){const at=Number(match[1])*60+Number(match[2]);if(Number.isFinite(at)&&at<=86400)lines.push({at,text});}
  }return lines.sort((a,b)=>a.at-b.at).slice(0,3000);
}
export function createMusicLyrics({invoke,button,getTrack,getAudio}){
  const dialog=document.createElement("dialog");dialog.className="music-lyrics-dialog";dialog.setAttribute("aria-label",t("Lyrics"));
  const content=document.createElement("section"),heading=document.createElement("h2"),body=document.createElement("div"),credit=document.createElement("p");
  content.className="music-lyrics-content";body.className="music-lyrics-scroll";body.tabIndex=0;body.setAttribute("aria-label",t("Lyrics"));credit.className="music-lyrics-credit";credit.textContent="LRCLIB";
  const toolbar=document.createElement("div");toolbar.className="music-lyrics-tools";
  let fontSize=28;try{fontSize=Math.max(20,Math.min(40,Number(localStorage.getItem("deviload-lyrics-size"))||28));}catch{}
  const setSize=value=>{fontSize=Math.max(20,Math.min(40,value));content.style.setProperty("--lyrics-size",fontSize+"px");try{localStorage.setItem("deviload-lyrics-size",String(fontSize));}catch{}smaller.disabled=fontSize<=20;larger.disabled=fontSize>=40;};
  const smaller=button(t("Smaller lyrics"),null,()=>setSize(fontSize-2)),larger=button(t("Larger lyrics"),null,()=>setSize(fontSize+2)),resume=button(t("Follow current line"),null,()=>{manualUntil=0;followPending=true;resume.hidden=true;update();});smaller.textContent="A−";larger.textContent="A+";resume.hidden=true;toolbar.append(smaller,larger,resume);setSize(fontSize);
  const close=button(t("Close"),"x-circle",()=>dialog.close());content.append(heading,toolbar,body,credit);dialog.append(close,content);document.body.append(dialog);
  let request=0,id=null,lines=[],active=-1,host=null,manualUntil=0,followPending=false,frame=0;const cache=new Map();
  let activeRows=new Set();
  const visible=()=>dialog.open||Boolean(host&&!host.hidden&&host.getClientRects().length&&(!host.closest("dialog")||host.closest("dialog").open));
  const manualScroll=()=>{manualUntil=Infinity;followPending=true;resume.hidden=!lines.length;};
  body.addEventListener("wheel",manualScroll,{passive:true});body.addEventListener("touchstart",manualScroll,{passive:true});body.addEventListener("pointerdown",manualScroll);
  body.addEventListener("keydown",event=>{if(["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"].includes(event.key))manualScroll();});
  function follow(row){
    if(!row)return;
    // Scroll only the lyrics pane; never move the surrounding modal/page.
    const target=body.scrollTop+row.getBoundingClientRect().top-body.getBoundingClientRect().top-(body.clientHeight-row.offsetHeight)/2;
    body.scrollTo({top:Math.max(0,target),behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});followPending=false;resume.hidden=true;
  }
  async function load(){const track=getTrack();if(!track){++request;id=null;lines=[];active=-1;heading.textContent=t("Lyrics");body.textContent=t("Start playback to load lyrics.");return;}const token=++request;id=track.id;heading.textContent=host?t("Lyrics"):track.title;body.textContent=t("Finding lyrics…");lines=[];active=-1;manualUntil=0;followPending=false;body.scrollTop=0;
    try{
      const duration=getAudio().duration;if(!Number.isFinite(duration)||duration<=0){body.textContent=t("Start playback to load lyrics.");id=null;return;}
      let result=cache.get(id);if(!cache.has(id)){result=await invoke("music_lyrics",{title:track.title,artist:track.artists?.[0]||track.subtitle?.split(' · ')[0]||"",duration});if(result){if(cache.size>=30)cache.delete(cache.keys().next().value);cache.set(track.id,result);}}
      if(token!==request)return;body.replaceChildren();lines=result?.instrumental?[]:timedLyrics(result?.lines);if(!lines.length&&!result?.instrumental)lines=parseLyrics(result?.synced);activeRows=new Set();
      body.dataset.lyricsState=result?.instrumental?"instrumental":lines.length?"synced":result?.plain?"plain":"missing";
      if(lines.length){for(const line of lines){const row=button(line.text||"♪",null,()=>{const audio=getAudio();if(getTrack()?.id!==id||!Number.isFinite(audio.duration))return;manualUntil=0;followPending=true;audio.currentTime=Math.min(line.at,audio.duration);update();},"music-lyric-line");if(line.words?.length){row.classList.add("has-word-sync");row.replaceChildren();for(const word of line.words){const span=document.createElement("span");span.className="music-lyric-word";span.textContent=word.text;span.setAttribute("aria-hidden","true");row.append(span);}row.setAttribute("aria-label",line.text);}body.append(row);}}
      else{const text=document.createElement("p");text.className="music-lyrics-plain";text.textContent=result?.instrumental?t("Instrumental"):(result?.plain||t("No matching lyrics found."));body.append(text);}
      update();
    }catch(error){if(token===request)body.textContent=errorText(error);}
  }
  function update(){
    if(!visible()){if(frame)cancelAnimationFrame(frame);frame=0;return;}if(getTrack()?.id!==id){load();return;}
    const audio=getAudio(), states=lyricFrame(lines,audio.currentTime),nextRows=new Set(states.map(state=>state.index));
    for(const index of activeRows)if(!nextRows.has(index)){const row=body.children[index];row?.classList.remove("active");row?.removeAttribute("aria-current");}
    for(const state of states){const row=body.children[state.index];if(!row)continue;row.classList.add("active");row.setAttribute("aria-current","true");for(let i=0;i<state.words.length;i++){const span=row.children[i],word=state.words[i];span.dataset.state=word.state;span.style.setProperty("--word-progress",(word.progress*100).toFixed(1)+"%");}}
    activeRows=nextRows;const index=states.at(-1)?.index??-1;if(index!==active){active=index;followPending=index>=0;}
    if(followPending&&Date.now()>=manualUntil)follow(body.children[active]);
    if(!audio.paused&&!audio.ended&&lines.some(line=>line.words?.length)&&!frame)frame=requestAnimationFrame(()=>{frame=0;update();});
  }
  dialog.addEventListener("close",()=>{if(!host)++request;});
  onLanguageChange(()=>{dialog.ariaLabel=body.ariaLabel=t("Lyrics");close.title=close.ariaLabel=t("Close");smaller.title=smaller.ariaLabel=t("Smaller lyrics");larger.title=larger.ariaLabel=t("Larger lyrics");resume.textContent=resume.title=resume.ariaLabel=t("Follow current line");if(host)heading.textContent=t("Lyrics");});
  return {
    open(){if(host){load();body.focus();return;}dialog.showModal();load();},
    mount(target){host=target;if(dialog.open)dialog.close();host.append(content);load();},
    unmount(){++request;if(frame)cancelAnimationFrame(frame);frame=0;host=null;id=null;dialog.append(content);},
    update
  };
}
