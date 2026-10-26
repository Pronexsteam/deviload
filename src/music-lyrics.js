import {t,errorText,onLanguageChange} from "./i18n.js";
import {timedLyrics,lyricFrame,parseLyrics} from "./music-lyrics-timing.js";
export {parseLyrics} from "./music-lyrics-timing.js";
export function createMusicLyrics({invoke,button,getTrack,getAudio}){
  const dialog=document.createElement("dialog");dialog.className="music-lyrics-dialog";dialog.setAttribute("aria-label",t("Lyrics"));
  const content=document.createElement("section"),heading=document.createElement("h2"),body=document.createElement("div"),credit=document.createElement("p");
  content.className="music-lyrics-content";body.className="music-lyrics-scroll";body.tabIndex=0;body.setAttribute("aria-label",t("Lyrics"));credit.className="music-lyrics-credit";credit.textContent="LRCLIB";
  const toolbar=document.createElement("div");toolbar.className="music-lyrics-tools";
  let fontSize=28;try{fontSize=Math.max(20,Math.min(40,Number(localStorage.getItem("deviload-lyrics-size"))||28));}catch{}
  const setSize=value=>{fontSize=Math.max(20,Math.min(40,value));content.style.setProperty("--lyrics-size",fontSize+"px");try{localStorage.setItem("deviload-lyrics-size",String(fontSize));}catch{}smaller.disabled=fontSize<=20;larger.disabled=fontSize>=40;};
  const smaller=button(t("Smaller lyrics"),null,()=>setSize(fontSize-2)),larger=button(t("Larger lyrics"),null,()=>setSize(fontSize+2)),resume=button(t("Follow current line"),null,()=>{manualUntil=0;followPending=true;resume.hidden=true;update();});smaller.textContent="A−";larger.textContent="A+";resume.hidden=true;toolbar.append(smaller,larger,resume);setSize(fontSize);
  const close=button(t("Close"),"x-circle",()=>dialog.close());content.append(heading,toolbar,body,credit);dialog.append(close,content);document.body.append(dialog);
  let request=0,id=null,lines=[],active=-1,host=null,manualUntil=0,followPending=false,frame=0;const cache=new Map(),loading=new Map();
  let activeRows=new Set(),nearRows=new Set(),lastFrameAt=0,hasWords=false;
  let syncLabel="";
  const updateCredit=()=>{credit.textContent="LRCLIB"+(syncLabel?" · "+(syncLabel==="words"?t("Word timing"):t("Line timing · word timing unavailable")):"");};
  const visible=()=>!document.hidden&&(dialog.open||Boolean(host&&!host.hidden&&host.getClientRects().length&&(!host.closest("dialog")||host.closest("dialog").open)));
  const manualScroll=()=>{manualUntil=Date.now()+8000;followPending=true;resume.hidden=!lines.length;};
  body.addEventListener("wheel",manualScroll,{passive:true});body.addEventListener("touchmove",manualScroll,{passive:true});body.addEventListener("pointerdown",event=>{if(event.target===body)manualScroll();});
  body.addEventListener("keydown",event=>{if(["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"].includes(event.key))manualScroll();});
  function follow(row){
    if(!row)return;
    // Scroll only the lyrics pane; never move the surrounding modal/page.
    const target=body.scrollTop+row.getBoundingClientRect().top-body.getBoundingClientRect().top-(body.clientHeight-row.offsetHeight)/2;
    body.scrollTo({top:Math.max(0,target),behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});followPending=false;resume.hidden=true;
  }
  async function load(){if(frame)cancelAnimationFrame(frame);frame=0;hasWords=false;syncLabel="";updateCredit();const track=getTrack();if(!track){++request;id=null;lines=[];active=-1;heading.textContent=t("Lyrics");body.textContent=t("Start playback to load lyrics.");return;}const token=++request;id=track.id;heading.textContent=host?t("Lyrics"):track.title;body.textContent=t("Finding lyrics…");lines=[];active=-1;manualUntil=0;followPending=false;body.scrollTop=0;
    try{
      const duration=getAudio().duration;if(!Number.isFinite(duration)||duration<=0){body.textContent=t("Start playback to load lyrics.");id=null;return;}
      const args={title:track.title,artist:track.artists?.join(", ")||track.subtitle?.split(' · ')[0]||"",duration};
      const key=JSON.stringify([track.id,args.title,args.artist,Math.round(duration)]);
      let result=cache.get(key);
      if(!cache.has(key)){
        // Moving the same controller between sidebar and full player must not
        // start duplicate requests, nor let an older song replace the new one.
        if(!loading.has(key)){
          const task=Promise.resolve().then(()=>invoke("music_lyrics",args)).then(value=>{
            if(cache.size>=30)cache.delete(cache.keys().next().value);cache.set(key,value);return value;
          }).finally(()=>loading.delete(key));loading.set(key,task);
        }
        result=await loading.get(key);
      }
      if(token!==request)return;body.replaceChildren();lines=result?.instrumental?[]:timedLyrics(result?.lines);if(!lines.length&&!result?.instrumental)lines=parseLyrics(result?.synced);activeRows=new Set();
      body.dataset.lyricsState=result?.instrumental?"instrumental":lines.length?"synced":result?.plain?"plain":"missing";
      if(lines.length){for(const [lineIndex,line] of lines.entries()){const row=button(line.text||(lineIndex===lines.length-1?t("End of available lyrics"):"♪"),null,()=>{const audio=getAudio();if(getTrack()?.id!==id||!Number.isFinite(audio.duration))return;manualUntil=0;followPending=true;audio.currentTime=Math.min(line.at,audio.duration);update();},"music-lyric-line");if(line.words?.length){row.classList.add("has-word-sync");row.replaceChildren();for(const word of line.words){const span=document.createElement("span");span.className="music-lyric-word";span.textContent=word.text;span.setAttribute("aria-hidden","true");row.append(span);}row.setAttribute("aria-label",line.text);}body.append(row);}}
      else{const text=document.createElement("p");text.className="music-lyrics-plain";text.textContent=result?.instrumental?t("Instrumental"):(result?.plain||t("No matching lyrics found."));body.append(text);}
      hasWords=lines.some(line=>line.words?.length);
      syncLabel=hasWords?"words":lines.length?"lines":"";updateCredit();
      body.dataset.lyricsSync=hasWords?"words":lines.length?"lines":"none";
      nearRows=new Set();lastFrameAt=0;update();
    }catch(error){if(token===request){body.dataset.lyricsState="error";body.textContent=errorText(error);body.append(button(t("Retry"),null,()=>load(),"music-lyrics-retry"));}}
  }
  function update(){
    if(!visible()){if(frame)cancelAnimationFrame(frame);frame=0;return;}if(getTrack()?.id!==id){load();return;}
    const audio=getAudio(), states=lyricFrame(lines,audio.currentTime,Number.isFinite(audio.duration)?audio.duration:Infinity),nextRows=new Set(states.map(state=>state.index));
    for(const index of activeRows)if(!nextRows.has(index)){const row=body.children[index];row?.classList.remove("active");row?.removeAttribute("aria-current");}
    for(const state of states){const row=body.children[state.index];if(!row)continue;if(!activeRows.has(state.index)){row.classList.add("active");row.setAttribute("aria-current","true");}for(let i=0;i<state.words.length;i++){const span=row.children[i],word=state.words[i];if(span.dataset.state!==word.state)span.dataset.state=word.state;const progress=(word.progress*100).toFixed(1)+"%";if(span.style.getPropertyValue("--word-progress")!==progress)span.style.setProperty("--word-progress",progress);}}
    activeRows=nextRows;const index=states.at(-1)?.index??-1;if(index!==active){active=index;followPending=index>=0;for(const i of nearRows)body.children[i]?.classList.remove("lyric-near");nearRows=new Set(index<0?[]:[index-1,index+1]);for(const i of nearRows)body.children[i]?.classList.add("lyric-near");}
    if(followPending&&Date.now()>=manualUntil)follow(body.children[active]);
    if(!audio.paused&&!audio.ended&&hasWords&&!frame){const tick=now=>{frame=0;if(now-lastFrameAt<30){frame=requestAnimationFrame(tick);return;}lastFrameAt=now;update();};frame=requestAnimationFrame(tick);}
  }
  document.addEventListener("visibilitychange",update);
  dialog.addEventListener("close",()=>{if(!host){++request;if(frame)cancelAnimationFrame(frame);frame=0;}});
  onLanguageChange(()=>{updateCredit();dialog.ariaLabel=body.ariaLabel=t("Lyrics");close.title=close.ariaLabel=t("Close");smaller.title=smaller.ariaLabel=t("Smaller lyrics");larger.title=larger.ariaLabel=t("Larger lyrics");resume.textContent=resume.title=resume.ariaLabel=t("Follow current line");if(host)heading.textContent=t("Lyrics");});
  return {
    open(){if(host){load();body.focus();return;}dialog.showModal();load();},
    mount(target){host=target;if(dialog.open)dialog.close();host.append(content);load();},
    unmount(){++request;if(frame)cancelAnimationFrame(frame);frame=0;host=null;id=null;dialog.append(content);},
    update
  };
}
