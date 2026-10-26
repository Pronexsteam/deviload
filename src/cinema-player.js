import {createCinemaQueue,localCinemaEntries,localCinemaOrder} from "./cinema-queue.js";
import {cinemaInput} from "./cinema-discovery.js";
import {createYouTubePlayer} from './cinema-youtube-player.js';

export function createCinema({invoke,convertFileSrc,t,errorText,getJobs,getIds,getPositions,persistPositions,onCut,onShare,onActivity,onSearch=()=>{},onCurrent=()=>{},onClose=()=>{},createOnlinePlayer=createYouTubePlayer}) {
  const $=id=>document.getElementById(id), dialog=$("player-dialog"), video=$("player-video"), audio=$("player-audio"), image=$("player-image");
  const queue=createCinemaQueue();
  // Cancels are global on the native side. A late cancel from an older
  // selection must finish before the newest stream can be dispatched.
  let playbackCancellation=Promise.resolve();
  function cancel(args={discovery:false}){
    if(args.playback===false)return invoke("cinema_cancel",args).catch(()=>{});
    playbackCancellation=playbackCancellation.then(()=>invoke("cinema_cancel",args)).catch(()=>{});
    return playbackCancellation;
  }
  let discovery=0, pendingDiscovery=false, onlineAddress="", nextPage=null, autoplay=true, lastSave="", metadataCleanup=()=>{}, playWhenReady=false;
  const element=()=>!video.hidden?video:!audio.hidden?audio:null;
  const make=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;if(text!=null)el.textContent=text;return el;};
  let renderedRows=[];
  const status=(text,error=false)=>{$("player-status").textContent=text;$("player-status").classList.toggle("is-error",error);};
  const youtube=createOnlinePlayer({dialog,invoke,t,onState(state){
    if(!dialog.open||queue.current?.kind!=="online-video")return;
    if(state===1)document.dispatchEvent(new CustomEvent("deviload:cinema-intent"));
    if([1,2,5].includes(state)){const first=queue.current.status!=="ready";queue.current.status="ready";render();status(t("Use the YouTube player controls for quality, volume and fullscreen."));if(first)onCurrent(queue.current);}
    if(state===0&&autoplay&&queue.current.status==="ready"){const next=queue.next();if(next>=0)select(next,true);}
  },onError(code){if(dialog.open)failed(t(code===101||code===150?"The owner does not allow this video in embedded players. Open it on YouTube.":code===100?"This video is unavailable on YouTube.":code===153?"YouTube could not identify the embedded player. Open the video on YouTube.":"Could not load the YouTube player. Check your connection or open the video on YouTube."));},onBlocked(){if(dialog.open)status(t("Press play in the YouTube player to start."));}});
  function show(){if(!dialog.open)dialog.showModal();onActivity(true);}
  function save(){
    const item=queue.current, media=element();if(!item||item.kind!=="local-job"||!item.file||!media||!Number.isFinite(media.currentTime))return;
    const second=media.ended?0:Math.floor(media.currentTime), key=item.file+":"+second;
    if(key===lastSave)return;lastSave=key;getPositions()[item.file]=second;persistPositions();
  }
  function stop(keepOnline=false){
    if(keepOnline)youtube.suspend();else youtube.stop();
    metadataCleanup();metadataCleanup=()=>{};playWhenReady=false;
    for(const media of [video,audio]){media.pause();media.removeAttribute("src");media.load();media.hidden=true;}
    image.removeAttribute("src");image.hidden=true;video.querySelectorAll("track").forEach(track=>track.remove());
    $("player-chapters").replaceChildren();$("player-chapters").hidden=true;
  }
  function render(){
    const list=$("cinema-items"), fragment=document.createDocumentFragment();
    const rebuild=renderedRows.length!==queue.items.length||renderedRows.some((row,i)=>row.item!==queue.items[i]);
    if(rebuild){renderedRows=[];for(const [position,item] of queue.items.entries()){
      const button=make("button","cinema-item"+(position===queue.index?" selected":""));button.type="button";
      button.setAttribute("aria-current",position===queue.index?"true":"false");
      const number=make("span","cinema-number",String(item.index||position+1));
      const thumb=make("span","cinema-thumb");
      if(item.kind==="online-video"&&/^[\w-]{11}$/.test(item.id)){const cover=make("img","");cover.src=`https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;cover.alt="";cover.loading="lazy";cover.addEventListener("error",()=>cover.remove(),{once:true});thumb.append(cover);}
      else thumb.textContent="▶";
      const copy=make("span","cinema-copy"), title=make("span","cinema-item-title",item.title);
      const label=item.status==="unavailable"?t("Unavailable video"):item.status==="error"?t("Could not play"):item.status==="loading"?t("Preparing video…"):item.kind==="online-video"?t("Online"):t("Downloaded");
      const meta=make("span","cinema-item-meta",label);copy.append(title,meta);button.append(number,thumb,copy);
      button.disabled=item.unavailable;button.title=item.title;
      button.addEventListener("click",()=>select(position,true));fragment.append(button);
      renderedRows.push({item,button,meta});
    }list.replaceChildren(fragment);}
    for(const [position,{item,button,meta}]of renderedRows.entries()){
      button.classList.toggle('selected',position===queue.index);button.setAttribute('aria-current',String(position===queue.index));
      meta.textContent=item.status==="unavailable"?t("Unavailable video"):item.status==="error"?t("Could not play"):item.status==="loading"?t("Preparing video…"):item.kind==="online-video"?t("Online"):t("Downloaded");
    }
    $("cinema-prev").disabled=queue.next(-1)<0;$("cinema-next").disabled=queue.next(1)<0;
    $("cinema-position").textContent=queue.current?`${queue.index+1} / ${queue.items.length}`:"";
    const local=queue.current?.kind==="local-job";
    $("cinema-browser").hidden=local||!queue.current;
    $("player-share").hidden=!local;$("player-cut").hidden=!local||!(/\.(mp4|mkv|webm|mov|avi|m4v)$/i.test(queue.current?.file||""));
    $("cinema-more").hidden=!nextPage;
  }
  function failed(message){
    if(queue.current)queue.current.status="error";render();status(message,true);$("cinema-retry").hidden=false;
    // Stop on a preparation/decoder failure. Automatically skipping failures
    // can silently walk the entire online queue and issue unwanted requests.
  }
  async function select(position,shouldPlay=false){
    save();const token=queue.select(position);if(token===null)return;
    stop(queue.current?.kind==="online-video");show();
    const item=queue.current;item.status="loading";render();
    // Let stream extraction finish before competing with a related-video search.
    onCurrent(null);
    $("player-title").textContent=item.title;$("cinema-source").textContent=t(item.kind==="online-video"?"Online":"Downloaded");
    $("cinema-retry").hidden=true;status(t("Preparing video…"));
    document.dispatchEvent(new CustomEvent("deviload:cinema-intent"));
    await cancel();
    if(!queue.valid(token)||!dialog.open)return;
    try{
      let file,media;
      if(item.kind==="online-video"){
        await youtube.start(item.id,shouldPlay);return;
      }else{
        file=await invoke("media_source",{id:item.id});if(!queue.valid(token)||!dialog.open)return;
        media=/\.(gif|jpg|jpeg|png|webp|bmp|avif)$/i.test(file)?image:/\.(mp3|flac|wav|m4a|ogg|opus|aac|aiff)$/i.test(file)?audio:video;
        file=convertFileSrc(file);
      }
      media.hidden=false;playWhenReady=shouldPlay;
      if(media!==image){
        const ready=()=>{
          if(!queue.valid(token)||!dialog.open)return;
          const saved=Number(getPositions()[item.file]||0);
          if(saved>0&&saved<media.duration)media.currentTime=saved;
          item.status="ready";render();status(t("Use the player buttons to control playback."));
          onCurrent(item);
          if(playWhenReady)media.play().catch(()=>{if(queue.valid(token))status(t("Press play to start the video."));});
        };
        media.addEventListener("loadedmetadata",ready,{once:true});metadataCleanup=()=>media.removeEventListener("loadedmetadata",ready);
      }else {item.status="ready";render();status("");}
      media.src=file;if(media!==image)media.load();
      if(media===video&&item.kind==="local-job"){
        const metadata=await invoke("player_metadata",{id:item.id}).catch(()=>null);
        if(!metadata||!queue.valid(token)||!dialog.open)return;
        const chapters=$("player-chapters");
        for(const chapter of metadata.chapters||[]){const button=make("button","",chapter.title||t("Chapter · {time}",{time:Math.floor(chapter.start/60)+":"+String(Math.floor(chapter.start%60)).padStart(2,"0")}));button.type="button";button.addEventListener("click",()=>{video.currentTime=chapter.start;video.play().catch(()=>{});});chapters.append(button);}
        chapters.hidden=!chapters.childElementCount;
        if(metadata.subtitles){const track=document.createElement("track");track.kind="subtitles";track.label=t("Subtitles");track.srclang=metadata.subtitleLanguage||"und";track.src=metadata.subtitles;video.append(track);}
      }
    }catch(error){if(queue.valid(token)&&dialog.open)failed(errorText(error));}
  }
  async function discover(more=false){
    const request=++discovery,address=more?onlineAddress:cinemaInput($("cinema-url").value).value;
    if(!address)return;
    if(!more&&cinemaInput(address).kind==="text"){dialog.close();onSearch(address);return;}
    const start=more?nextPage:1;if(!start)return;
    pendingDiscovery=true;$("cinema-submit").disabled=true;$("cinema-more").disabled=true;$("cinema-discovery-status").textContent=t("Opening video list…");
    try{
      const result=await invoke("cinema_entries",{address,start});if(request!==discovery||!dialog.open)return;
      const entries=result.entries.map(entry=>({...entry,kind:"online-video"}));
      if(more)queue.append(entries);else {save();queue.invalidate();stop();await cancel();if(request!==discovery||!dialog.open)return;queue.replace(entries);onlineAddress=address;}
      nextPage=result.next;render();
      $("cinema-discovery-status").textContent=nextPage?t("More videos are available. Load the next page below."):result.title;
      if(!more){const first=entries.findIndex(entry=>!entry.unavailable);if(first>=0)select(first,true);else status(t("No playable videos in this list."),true);}
    }catch(error){if(request===discovery)$("cinema-discovery-status").textContent=errorText(error);}
    finally{if(request===discovery){pendingDiscovery=false;$("cinema-submit").disabled=false;$("cinema-more").disabled=false;}}
  }
  $("cinema-online-form").addEventListener("submit",event=>{event.preventDefault();discover();});
  $("cinema-more").addEventListener("click",()=>discover(true));
  $("cinema-retry").addEventListener("click",()=>{youtube.stop();select(queue.index,true);});
  $("cinema-browser").addEventListener("click",()=>{if(queue.current?.kind==="online-video"){youtube.pause();invoke("cinema_open_youtube",{id:queue.current.id}).catch(error=>status(errorText(error),true));}});
  $("cinema-prev").addEventListener("click",()=>{const next=queue.next(-1);if(next>=0)select(next,true);});
  $("cinema-next").addEventListener("click",()=>{const next=queue.next();if(next>=0)select(next,true);});
  $("cinema-autoplay").addEventListener("change",event=>{autoplay=event.target.checked;});
  $("close-player").addEventListener("click",()=>dialog.close());
  $("player-share").addEventListener("click",()=>{if(queue.current?.kind==="local-job")onShare(queue.current.id);});
  $("player-cut").addEventListener("click",()=>{if(queue.current?.kind==="local-job"){const id=queue.current.id;dialog.close();onCut(id);}});
  dialog.addEventListener("close",()=>{save();queue.invalidate();++discovery;pendingDiscovery=false;stop();onClose();cancel({discovery:true});$("cinema-submit").disabled=false;$("cinema-more").disabled=false;onActivity(false);});
  document.addEventListener("deviload:music-play",()=>{
    youtube.pause();
    playWhenReady=false;video.pause();audio.pause();
    if(dialog.open&&(pendingDiscovery||queue.current?.status==="loading")){
      ++discovery;pendingDiscovery=false;$("cinema-submit").disabled=false;$("cinema-more").disabled=false;$("cinema-discovery-status").textContent="";
      cancel({discovery:true,playback:queue.current?.status==="loading"});
    }
    if(dialog.open&&queue.current?.status==="loading"){
      queue.invalidate();metadataCleanup();
      queue.current.status="ready";render();status(t("Press play to start the video."));$("cinema-retry").hidden=false;
    }
  });
  for(const media of [video,audio]){
    media.addEventListener("timeupdate",()=>{if(Math.floor(media.currentTime)%5===0)save();});
    media.addEventListener("ended",()=>{if(element()!==media||!media.ended||!dialog.open||queue.current?.status!=="ready")return;save();const next=queue.next();if(autoplay&&next>=0)select(next,true);});
    media.addEventListener("error",()=>{if(element()===media&&media.error&&media.getAttribute("src")&&dialog.open){console.warn("Cinema media failure",{code:media.error.code,readyState:media.readyState,networkState:media.networkState});failed(t("Could not play this video. Retry or choose another item."));}});
  }
  return {
    playEntries(entries,index=0,playlist=null){
      if(index<0||!entries[index]||entries[index].unavailable)return;
      ++discovery;pendingDiscovery=false;save();queue.invalidate();stop();
      invoke("cinema_cancel",{discovery:true,playback:false}).catch(()=>{});
      $("cinema-submit").disabled=false;$("cinema-more").disabled=false;
      queue.replace(entries.map(item=>({...item,kind:"online-video"})),index);
      onlineAddress=playlist?.address||"";nextPage=playlist?.next||null;
      $("cinema-discovery-status").textContent="";select(index,true);
    },
    playRelated(item){
      ++discovery;pendingDiscovery=false;invoke("cinema_cancel",{discovery:true,playback:false}).catch(()=>{});
      $("cinema-submit").disabled=false;$("cinema-more").disabled=false;
      let index=queue.items.findIndex(row=>row.kind==="online-video"&&row.id===item.id);
      if(index<0){queue.append([{...item,kind:"online-video"}]);index=queue.items.length-1;}
      select(index,true);
    },
    openLocal(id){
      ++discovery;pendingDiscovery=false;cancel({discovery:true});save();stop();
      $("cinema-submit").disabled=false;$("cinema-more").disabled=false;
      const snapshot=localCinemaOrder(getJobs(),getIds(),id);
      queue.replace(localCinemaEntries(getJobs(),snapshot),snapshot.indexOf(id));nextPage=null;$("cinema-discovery-status").textContent="";select(queue.index,true);
    },
    openOnline(){show();$("cinema-url").focus();},
    open(){const ids=getIds();if(ids.length)this.openLocal(ids[0]);else this.openOnline();}
  };
}
