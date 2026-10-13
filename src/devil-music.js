import {t, language, onLanguageChange, errorText} from "./i18n.js";
import {tracks, remember, nextIndex,reorderTrack,insertNext,restoreRemoved} from "./music-state.js";
import {recordListening,tasteSeeds,recommend,listeningClock,hideRecommendation} from "./music-taste.js";
import {createNowPlaying} from "./music-presentation.js";
import {readMusicProfile,saveMusicProfile} from "./music-profile.js";
import {wireMusicProfile} from "./music-profile-ui.js";

const $ = id => document.getElementById(id);
const moods = {chill:"chill relaxing music",focus:"instrumental focus music",jazz:"jazz",electronic:"electronic night music",rock:"rock"};
const el = (tag, cls, text) => { const node=document.createElement(tag); node.className=cls; if(text!=null)node.textContent=text; return node; };
const icon = name => { const node=el("span","icon"); node.dataset.icon=name; node.setAttribute("aria-hidden","true"); return node; };
function button(label, glyph, action, cls="music-icon-button") {
  const node=el("button",cls); node.type="button"; node.title=label; node.setAttribute("aria-label",label);
  if(glyph)node.append(icon(glyph)); else node.textContent=label;
  node.addEventListener("click",action); return node;
}
function cover(item, cls="") {
  const frame=el("span",`music-art ${cls}`);
  frame.append(icon("music-notes"));
  if(/^https:\/\/(i\.ytimg\.com|lh3\.googleusercontent\.com|yt3\.googleusercontent\.com)\//.test(item?.image||"")) {
    const img=el("img",""); img.src=item.image; img.alt=""; img.loading="lazy"; img.addEventListener("error",()=>img.remove(),{once:true}); frame.append(img);
  }
  return frame;
}
const time = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,"0")}` : "0:00";

export function createMusic({invoke,onDownload}) {
  const audio=new Audio(); audio.id="music-audio";audio.hidden=true;audio.preload="metadata";document.body.append(audio);
  let storage;try{storage=localStorage;}catch{/* storage unavailable */}
  // Preferences stay on this device; no account or remote profile is needed.
  const {saved,taste}=readMusicProfile(storage);
  audio.volume=saved.volume;
  const clock=listeningClock(),radioCache=new Map();
  let session=0,checkpoint=0,historyAdded=false,recoveryUsed=false,pendingSeek=0,resolution=Promise.resolve(),radioPending=false;
  let view="home", request=0, playRequest=0, current=null, queue=[], index=-1, sections=[], loaded=false, loading=false, repeat=false, shuffle=false;
  let lastQuery={kind:"home",value:""}, homeCache=null, activeMood="", queueOpen=false, streamLoading=false;
  let resolvedTrack=null,autoplay=true;
  let nativeState="";
  let removed=null,dragged=null;
  let bufferingTimer=null,retryPosition=0;
  let nextPlan=null,preloadPending=false,preloadAttempts=new Set();
  let radioAhead=null;
  const downloadsPending=new Set();
  const dock=el("section","music-dock"); dock.hidden=true; dock.setAttribute("aria-label",t("Music player"));
  const identity=el("div","music-now");
  const artwork=el("div","music-now-art"); artwork.append(cover(null));
  const info=el("div","music-now-info"), title=el("strong","",t("Pick your first track")), artist=el("span","",t("Your soundtrack starts here"));
  info.append(title,artist);
  const like=button(t("Like this song"),null,toggleLike); like.textContent="♡";
  identity.append(artwork,info,like);
  const transport=el("div","music-transport"), controls=el("div","music-transport-buttons");
  const shuffleButton=button(t("Shuffle"),"shuffle",()=>{shuffle=!shuffle;shuffleButton.setAttribute("aria-pressed",String(shuffle));}); shuffleButton.setAttribute("aria-pressed","false");
  const previous=button(t("Previous track"),"skip-back",()=>{if(audio.currentTime>3){audio.currentTime=0;}else if(index>0)playAt(index-1);});
  const play=button(t("Play"),"play",togglePlay,"music-play-button");
  const next=button(t("Next track"),"skip-forward",()=>advance(true));
  const repeatButton=button(t("Repeat queue"),"repeat",()=>{repeat=!repeat;repeatButton.setAttribute("aria-pressed",String(repeat));}); repeatButton.setAttribute("aria-pressed","false");
  controls.append(shuffleButton,previous,play,next,repeatButton);
  const progress=el("div","music-progress"), elapsed=el("span","","0:00"), duration=el("span","","0:00"), seek=el("input","");
  seek.type="range"; seek.min="0"; seek.max="1000"; seek.value="0"; seek.disabled=true; seek.setAttribute("aria-label",t("Playback position"));
  seek.addEventListener("input",()=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(seek.value)/1000*audio.duration;});
  progress.append(elapsed,seek,duration); transport.append(controls,progress);
  const extras=el("div","music-dock-extras");
  const queueButton=button(t("Play queue"),"queue",()=>{queueOpen=!queueOpen;renderQueue();}); queueButton.setAttribute("aria-expanded","false");
  const downloadButton=button(t("Download MP3"),"download-simple",()=>downloadTrack(current));
  downloadButton.classList.add("music-dock-download");
  const volume=el("input",""); volume.type="range"; volume.min="0"; volume.max="1"; volume.step=".01"; volume.value=String(audio.volume); volume.setAttribute("aria-label",t("Volume"));
  volume.addEventListener("input",()=>{audio.volume=Number(volume.value);saved.volume=audio.volume;persist();});
  const volumeMark=icon("speaker-high"); volumeMark.classList.add("music-volume-mark");
  extras.append(queueButton,downloadButton,volumeMark,volume);
  dock.append(identity,transport,extras); document.body.append(dock);
  const queuePanel=el("section","music-queue-panel"); queuePanel.hidden=true; queuePanel.setAttribute("aria-label",t("Play queue")); document.body.append(queuePanel);
  const presentation=createNowPlaying({dock,identity,artwork,info,like,transport,extras,queuePanel,button,cover,
    onDownload:()=>downloadTrack(current),onHideSong:()=>feedback(false),onHideArtist:()=>feedback(true)});
  $("music-discovery").value=taste.mode;
  $("music-discovery").addEventListener("change",()=>{taste.mode=$("music-discovery").value;persist();if(view==="home"&&homeCache)personalize(request,homeCache.sections);});
  $("music-restore-hidden").addEventListener("click",()=>{taste.hiddenSongs=[];taste.blockedArtists=[];persist();if(view==="home"&&homeCache)personalize(request,homeCache.sections);status(t("Hidden recommendations restored."));});
  wireMusicProfile({invoke,read:()=>{captureListening();return {saved,taste};},restore:profile=>{
    saveMusicProfile(storage,profile.saved,profile.taste);
    Object.assign(saved,profile.saved);Object.assign(taste,profile.taste);
    clock.reset();session++;checkpoint=0;historyAdded=false;
    audio.volume=saved.volume;volume.value=String(saved.volume);$("music-discovery").value=taste.mode;
    syncDock();if(["favorites","recent"].includes(view))showLocal(view);
    else if(view==="home"&&homeCache)personalize(request,homeCache.sections);
  }});

  function persist() {
    try {
      saveMusicProfile(storage,saved,taste);
    }
    catch { status(t("Could not save your music preferences."),true); }
  }
  function feedback(artist) {
    if(!current)return;
    const hiddenSongs=[...taste.hiddenSongs],blockedArtists=[...taste.blockedArtists];
    hideRecommendation(taste,current,artist);persist();
    const text=artist?t("This artist will not appear in recommendations."):t("This song will not appear in recommendations.");
    presentation.notify(text,()=>{taste.hiddenSongs=hiddenSongs;taste.blockedArtists=blockedArtists;persist();if(view==="home"&&homeCache)personalize(request,homeCache.sections);});
    if(view==="home"&&homeCache)personalize(request,homeCache.sections);
  }
  function status(text,isError=false) { $("music-status").textContent=text;$("music-status").hidden=!text;$("music-status").classList.toggle("error",isError); }
  async function downloadTrack(item) {
    if(!item||downloadsPending.has(item.id))return;
    downloadsPending.add(item.id);syncDock();
    const notify=text=>{status(text);presentation.notify(text);};
    notify(t("Adding MP3 to downloads…"));
    try{
      if(!onDownload)throw new Error(t("Open the installed Deviload app to download."));
      const count=await onDownload(item);
      notify(count?t("MP3 added to downloads: {title}",{title:item.title}):t("These links are already in the queue."));
    }catch(error){const text=errorText(error);status(text,true);presentation.notify(text);}
    finally{downloadsPending.delete(item.id);syncDock();}
  }
  function syncDock() {
    dock.hidden=!current && document.querySelector("main").dataset.page!=="music";
    if(dock.hidden&&queueOpen){queueOpen=false;renderQueue();}
    document.body.classList.toggle("has-music-player",!dock.hidden);
    play.replaceChildren(icon(streamLoading ? "spinner-gap" : audio.paused ? "play" : "pause"));
    play.classList.toggle("loading",streamLoading);
    play.title=play.ariaLabel=audio.paused?t("Play"):t("Pause");
    const liked=current && saved.favorites.some(item=>item.id===current.id);
    like.textContent=liked?"♥":"♡";like.setAttribute("aria-pressed",String(Boolean(liked)));like.disabled=!current;
    downloadButton.disabled=!current||downloadsPending.has(current.id);
    play.disabled=!current&&!queue.length;previous.disabled=index<0;next.disabled=!current||radioPending||(!autoplay&&nextIndex(queue,index,repeat,shuffle)<0);
    presentation.update(current,Boolean(current&&downloadsPending.has(current.id)));
    syncNativeControls();
  }
  function syncNativeControls() {
    if(!window.__TAURI__?.core?.invoke)return;
    const playback={active:Boolean(current),playing:!audio.paused,previousEnabled:!previous.disabled,playEnabled:!play.disabled,nextEnabled:!next.disabled,
      previousLabel:t("Previous track"),playLabel:audio.paused?t("Play"):t("Pause"),nextLabel:t("Next track")};
    const signature=JSON.stringify(playback);
    if(signature===nativeState)return;
    nativeState=signature;
    invoke("set_music_controls",{playback}).catch(()=>{if(nativeState===signature)nativeState="";});
  }
  function toggleLike() {
    if(!current)return;
    saved.favorites=saved.favorites.some(item=>item.id===current.id)?saved.favorites.filter(item=>item.id!==current.id):remember(saved.favorites,current,500);
    persist();
    syncDock();if(view==="favorites")showLocal("favorites");
  }
  function renderQueue() {
    queuePanel.hidden=!queueOpen;queueButton.setAttribute("aria-expanded",String(queueOpen));
    queuePanel.replaceChildren();if(!queueOpen)return;
    const head=el("div","music-queue-head");head.append(el("h3","",t("Play queue")),button(t("Close"),"x-circle",()=>{queueOpen=false;renderQueue();}));queuePanel.append(head);
    const option=el("label","music-autoplay"),toggle=el("input","");toggle.type="checkbox";toggle.checked=autoplay;
    toggle.addEventListener("change",()=>{autoplay=toggle.checked;if(!autoplay&&radioPending){++playRequest;radioPending=false;status("");}syncDock();});
    option.append(toggle,el("span","",t("Keep playing similar music")));queuePanel.append(option);
    if(removed){const undo=button(t("Undo removal"),"arrow-clockwise",()=>{queue=restoreRemoved(queue,removed.item,removed.position);removed=null;syncQueue();},"music-queue-undo");queuePanel.append(undo);}
    if(!queue.length)queuePanel.append(el("p","music-empty-copy",t("Pick a song to start your queue.")));
    for(const [position,item]of queue.entries()) {
      const row=el("div","music-queue-track");row.dataset.trackId=item.id;row.draggable=true;row.classList.toggle("active",item.id===current?.id);
      const select=button(item.title,null,()=>playAt(queue.findIndex(track=>track.id===item.id)),"music-queue-select");select.replaceChildren(cover(item),el("span","",item.title));
      const actions=el("div","music-queue-actions");
      const up=button(t("Move up"),"arrow-up",()=>move(item.id,position-1)),down=button(t("Move down"),"arrow-down",()=>move(item.id,position+1)),remove=button(t("Remove from queue"),"x-circle",()=>removeTrack(item.id));
      const download=button(t("Download MP3"),"download-simple",()=>downloadTrack(item));
      up.disabled=position===0;down.disabled=position===queue.length-1;actions.append(download,up,down,remove);row.append(select,actions);
      row.addEventListener("dragstart",event=>{dragged=item.id;event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",item.id);row.classList.add("dragging");});
      row.addEventListener("dragend",()=>{dragged=null;row.classList.remove("dragging");});
      row.addEventListener("dragover",event=>{if(dragged){event.preventDefault();event.dataTransfer.dropEffect="move";}});
      row.addEventListener("drop",event=>{event.preventDefault();if(dragged)move(dragged,position);dragged=null;});
      queuePanel.append(row);
    }
  }
  function syncQueue(){index=current?queue.findIndex(item=>item.id===current.id):-1;renderQueue();syncDock();}
  function move(id,position){queue=reorderTrack(queue,id,position);syncQueue();queuePanel.querySelector(`[data-track-id="${id}"] .music-queue-select`)?.focus();}
  function removeTrack(id){
    const position=queue.findIndex(item=>item.id===id);if(position<0)return;
    removed={item:queue[position],position};queue=queue.filter(item=>item.id!==id);
    if(current?.id===id){
      if(queue.length)playAt(Math.min(position,queue.length-1));
      else {captureListening(true);++playRequest;clearTimeout(bufferingTimer);audio.pause();audio.removeAttribute("src");audio.load();current=null;resolvedTrack=null;streamLoading=false;radioPending=false;clock.reset();seek.disabled=true;seek.value="0";elapsed.textContent=duration.textContent="0:00";title.textContent=t("Pick your first track");artist.textContent=t("Your soundtrack starts here");artwork.replaceChildren(cover(null));}
    }
    syncQueue();
  }
  function captureListening(skipped=false) {
    if(current&&recordListening(taste,current,{seconds:clock.seconds,duration:audio.duration,skipped,session}))persist();
  }
  function plannedNext() {
    const signature=JSON.stringify([current?.id,queue.map(item=>item.id),repeat,shuffle]);
    if(nextPlan?.signature!==signature){
      const position=nextIndex(queue,index,repeat,shuffle);
      nextPlan={signature,id:queue[position]?.id};
    }
    return nextPlan.id ? queue.findIndex(item=>item.id===nextPlan.id) : -1;
  }
  function preloadNext() {
    // Resolve one upcoming song and cache its first audio chunk in the relay.
    // Wait for steady playback, close enough to the end that the source stays fresh.
    const remaining=audio.duration-audio.currentTime;
    if(!current||streamLoading||radioPending||preloadPending||audio.paused||audio.seeking||audio.readyState<4||navigator.onLine===false||
      !Number.isFinite(remaining)||remaining<=0||remaining>45||audio.currentTime<10)return;
    const position=plannedNext();
    if(position<0&&autoplay&&!radioAhead){
      const token=playRequest,plan={token,items:[],promise:null};radioAhead=plan;
      plan.promise=radioCandidates(current).then(items=>{
        plan.items=items;if(token===playRequest)preloadNext();return items;
      });
      plan.promise.catch(()=>{/* Keep the current song playing if discovery fails. */});
      return;
    }
    const candidate=()=>queue[plannedNext()]||(autoplay?radioAhead?.items[0]:null);
    const id=candidate()?.id;
    if(!id||id===current.id||preloadAttempts.has(id)||preloadAttempts.size>=2)return;
    const token=playRequest;
    preloadAttempts.add(id);preloadPending=true;
    const job=resolution.catch(()=>{}).then(()=>{
      if(token!==playRequest||audio.paused||candidate()?.id!==id)return;
      return invoke("music_stream",{id,refresh:false,preload:true});
    });
    // Foreground selections can cancel extraction in the backend. They reopen
    // through the cache so expired or failed sources are rechecked.
    job.catch(()=>{/* A speculative failure must not interrupt the current song. */})
      .finally(()=>{preloadPending=false;});
  }
  async function startAudio(){
    let timer;
    try{await Promise.race([audio.play(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(t("Audio did not start in time. Press play to retry."))),20000);})]);}
    finally{clearTimeout(timer);}
  }
  async function playAt(position,{refresh=false,resume=0,recovery=false}={}) {
    if(!queue[position])return;
    if(!recovery){captureListening(true);clock.reset();session++;checkpoint=0;historyAdded=false;recoveryUsed=false;}
    const token=++playRequest;index=position;current=queue[index];resolvedTrack=null;radioPending=false;retryPosition=resume;
    nextPlan=null;preloadAttempts=new Set();radioAhead=null;
    clearTimeout(bufferingTimer);audio.pause();audio.removeAttribute("src");audio.load();seek.disabled=true;seek.value="0";elapsed.textContent=duration.textContent="0:00";
    title.textContent=current.title;artist.textContent=t("Opening track…");artwork.replaceChildren(cover(current));
    pendingSeek=resume;streamLoading=true;syncDock();renderQueue();
    try {
      const id=current.id;
      const job=resolution.catch(()=>{}).then(()=>{
        if(token!==playRequest)throw new DOMException("Superseded","AbortError");
        return invoke("music_stream",{id,refresh});
      });
      resolution=job;
      const result=await job;
      if(token!==playRequest)return;
      audio.src=result.url;resolvedTrack=current.id;
      await startAudio();
      if(token!==playRequest)return;
      artist.textContent=current.subtitle||"YouTube Music";status("");
    } catch(error) {
      if(token!==playRequest)return;
      retryPosition=Math.max(retryPosition,audio.currentTime||0);audio.pause();audio.removeAttribute("src");audio.load();resolvedTrack=null;artist.textContent=t("Could not play. Press play to retry.");artist.title=errorText(error);status(errorText(error),true);
    } finally {if(token===playRequest){streamLoading=false;syncDock();}}
  }
  function playItems(items,startId) {
    queue=tracks(items); const position=queue.findIndex(item=>item.id===startId);if(queue.length)playAt(Math.max(0,position));
  }
  async function togglePlay() {
    if(!current){if(queue.length)playAt(0);return;}
    if(radioPending){++playRequest;radioPending=false;audio.pause();status("");syncDock();return;}
    if(streamLoading){++playRequest;streamLoading=false;retryPosition=Math.max(retryPosition,audio.currentTime||0);audio.pause();audio.removeAttribute("src");audio.load();resolvedTrack=null;artist.textContent=current.subtitle;syncDock();return;}
    if(!audio.paused){audio.pause();return;}
    if(resolvedTrack!==current.id){recoveryUsed=false;return playAt(index,{refresh:true,resume:retryPosition,recovery:retryPosition>0});}
    if(audio.ended)return playAt(index);
    const token=playRequest;streamLoading=true;syncDock();
    try{await startAudio();if(token===playRequest)status("");}
    catch(error){if(token===playRequest){retryPosition=audio.currentTime||0;audio.pause();resolvedTrack=null;artist.textContent=t("Could not play. Press play to retry.");status(errorText(error),true);}}
    finally{if(token===playRequest){streamLoading=false;syncDock();}}
  }
  async function radio(seed) {
    const cached=radioCache.get(seed.id);
    if(cached&&Date.now()-cached.at<10*60000)return cached.items;
    const result=await invoke("music_catalog",{kind:"radio",value:seed.id,language:language()});
    const items=tracks(result.sections.flatMap(section=>section.items));
    if(radioCache.size>=8)radioCache.delete(radioCache.keys().next().value);
    radioCache.set(seed.id,{at:Date.now(),items});return items;
  }
  async function radioCandidates(seed) {
    const seeds=tracks([seed,...tasteSeeds(taste,saved.favorites)]).slice(0,2);
    const results=await Promise.allSettled(seeds.map(item=>radio(item)));
    const candidates=results.filter(result=>result.status==="fulfilled").flatMap(result=>result.value);
    if(!candidates.length&&results.every(result=>result.status==="rejected"))throw results[0].reason;
    return recommend(candidates,taste,saved.favorites,{exclude:queue.map(item=>item.id),limit:15});
  }
  async function advance(skipped=false){
    if(!current||radioPending)return;
    captureListening(skipped);
    const next=plannedNext();
    if(next>=0){playAt(next);return;}
    if(!autoplay){syncDock();return;}
    const token=playRequest,seed=current;radioPending=true;syncDock();
    status(t("Finding the next songs for you…"));
    try{
      const candidates=await (radioAhead?.token===token?radioAhead.promise:radioCandidates(seed));
      const items=candidates.filter(item=>!queue.some(queued=>queued.id===item.id)&&!taste.hiddenSongs.includes(item.id)&&!item.artists?.some(artist=>taste.blockedArtists.includes(artist.trim().toLocaleLowerCase())));
      if(token!==playRequest)return;
      if(items.length){const position=queue.length;queue=[...queue,...items];if(queue.length>200){const trim=queue.length-200;queue=queue.slice(trim);index-=trim;playAt(position-trim);}else playAt(position);}
      else status(t("No more songs found. Pick another track."));
    }catch(error){if(token===playRequest){radioAhead=null;status(errorText(error),true);}}
    finally{if(token===playRequest){radioPending=false;syncDock();}}
  }
  audio.addEventListener("ended",()=>advance(false));
  audio.addEventListener("play",()=>{
    document.querySelectorAll("audio, video").forEach(other=>{if(other!==audio)other.pause();});
    if("mediaSession" in navigator && current){
      navigator.mediaSession.metadata=new MediaMetadata({title:current.title,artist:current.subtitle,artwork:current.image?[{src:current.image}]:[]});
    }
    syncDock();
  });
  document.addEventListener("play",event=>{if(event.target!==audio)audio.pause();},true);
  audio.addEventListener("playing",()=>{clearTimeout(bufferingTimer);if(current&&!historyAdded){saved.recent=remember(saved.recent,current);historyAdded=true;persist();}clock.sample(audio.currentTime,performance.now(),false);artist.textContent=current?.subtitle||"YouTube Music";syncDock();});
  audio.addEventListener("pause",()=>{clearTimeout(bufferingTimer);clock.sample(audio.currentTime,performance.now(),false);captureListening();syncDock();});
  audio.addEventListener("waiting",()=>{
    clock.sample(audio.currentTime,performance.now(),false);clearTimeout(bufferingTimer);
    if(!current||audio.paused||streamLoading)return;
    const token=playRequest;
    bufferingTimer=setTimeout(()=>{if(token!==playRequest||audio.paused)return;
      if(!recoveryUsed){recoveryUsed=true;playAt(index,{refresh:true,resume:audio.currentTime,recovery:true});}
      else{retryPosition=audio.currentTime||0;audio.pause();resolvedTrack=null;artist.textContent=t("Could not play. Press play to retry.");status(t("Audio did not start in time. Press play to retry."),true);syncDock();}
    },20000);
  });
  audio.addEventListener("loadedmetadata",()=>{if(pendingSeek>0&&Number.isFinite(audio.duration)){audio.currentTime=Math.min(pendingSeek,Math.max(0,audio.duration-1));pendingSeek=0;}});
  audio.addEventListener("error",()=>{
    if(streamLoading||!current)return;
    if(!recoveryUsed&&clock.seconds>0){recoveryUsed=true;playAt(index,{refresh:true,resume:audio.currentTime,recovery:true});return;}
    retryPosition=audio.currentTime||0;audio.pause();resolvedTrack=null;artist.textContent=t("Could not play. Press play to retry.");syncDock();
  });
  audio.addEventListener("timeupdate",()=>{
    const seconds=clock.sample(audio.currentTime,performance.now(),!audio.paused&&!audio.seeking&&audio.readyState>=3);
    if(seconds>=30&&seconds-checkpoint>=15){checkpoint=seconds;captureListening();}
    elapsed.textContent=time(audio.currentTime);duration.textContent=time(audio.duration);seek.disabled=!Number.isFinite(audio.duration);if(Number.isFinite(audio.duration))seek.value=String(audio.currentTime/audio.duration*1000);
    preloadNext();
  });
  if("mediaSession" in navigator){for(const [name,action]of Object.entries({play:()=>{if(audio.paused&&!streamLoading)togglePlay();},pause:()=>audio.pause(),previoustrack:()=>previous.click(),nexttrack:()=>advance(true)}))try{navigator.mediaSession.setActionHandler(name,action);}catch{/* unsupported control */}}

  function selectView(next) {
    view=next;$("music-home-hero").hidden=next!=="home";$("music-moods").hidden=!["home","search"].includes(next);
    document.querySelectorAll("[data-music-view]").forEach(b=>{b.classList.toggle("selected",b.dataset.musicView===next);b.setAttribute("aria-current",b.dataset.musicView===next?"page":"false");});
    document.querySelectorAll("[data-music-mood]").forEach(b=>{b.classList.toggle("selected",b.dataset.musicMood===activeMood);b.setAttribute("aria-pressed",String(b.dataset.musicMood===activeMood));});
  }
  function card(item,items) {
    const card=el("article",`music-card music-card-${item.kind}`);
    const action=button(item.kind==="song"?t("Play {title}",{title:item.title}):t("Open {title}",{title:item.title}),null,()=>{
      if(item.kind==="song")playItems(items,item.id);
      else load("browse",item.id,item.title);
    },"music-card-main");
    const art=cover(item);art.append(icon(item.kind==="song"?"play":"arrow-right"));art.lastChild.classList.add("music-card-play");
    action.replaceChildren(art,el("strong","music-card-title",item.title),el("span","music-card-subtitle",item.subtitle));card.append(action);
    if(item.kind==="song") {
      const add=button(t("Add to play queue"),"plus",()=>{queue=tracks([...queue,item]);renderQueue();syncDock();status(t("Added to play queue"));},"music-card-add");card.append(add);
      const next=button(t("Play next"),"skip-forward",()=>{queue=insertNext(queue,current?.id,item);syncQueue();status(t("Added to play next"));},"music-card-next");card.append(next);
      card.append(button(t("Download MP3"),"download-simple",()=>downloadTrack(item),"music-card-download"));
    }
    return card;
  }
  function render() {
    const root=$("music-shelves");root.replaceChildren();
    root.classList.toggle("music-results",view!=="home");
    if(!sections.some(section=>section.items.length)){
      const empty=el("div","music-empty");empty.append(icon("music-notes"),el("h4","",view==="favorites"?t("Keep the songs you love"):view==="recent"?t("Your listening story starts here"):t("No music found")),
        el("p","",view==="favorites"?t("Tap the heart to save a song on this device."):view==="recent"?t("Songs you have played on this device appear here."):t("Try another artist, album or song.")));root.append(empty);return;
    }
    const all=sections.flatMap(section=>section.items);
    for(const section of sections){
      const shelf=el("section","music-shelf");
      if(section.title)shelf.append(el("h4","",section.title));
      const grid=el("div","music-card-grid");for(const item of section.items)grid.append(card(item,all));shelf.append(grid);root.append(shelf);
    }
  }
  function skeleton() {const grid=el("div","music-card-grid");for(let i=0;i<6;i++)grid.append(el("div","music-skeleton"));$("music-shelves").replaceChildren(grid);}
  async function load(kind,value="",heading="",refresh=false) {
    window.scrollTo({top:0});
    const token=++request;lastQuery={kind,value,heading};selectView(kind==="browse"?"browse":kind==="search"?"search":"home");
    $("music-heading").textContent=heading||(kind==="search"?t("Results for “{query}”",{query:value}):t("Discover your next favorite"));
    $("music-kicker").textContent=kind==="home"?t("PRESS PLAY"):kind==="search"?t("SEARCH"):t("EXPLORE");
    loading=true;$("music-refresh").disabled=true;status(t("Finding your music…"));skeleton();
    try{
      if(!invoke)throw new Error(t("Open Deviload to browse and play music."));
      const result=kind==="home" && homeCache && !refresh?homeCache:await invoke("music_catalog",{kind,value,language:language()});
      if(token!==request)return;
      if(kind==="home")homeCache=result;
      sections=result.sections;status("");render();loaded=true;
      if(kind==="home")personalize(token,result.sections);
    }catch(error){if(token!==request)return;status(errorText(error),true);$("music-shelves").replaceChildren(button(t("Try again"),null,()=>load(kind,value,heading,true),"music-primary"));}
    finally{if(token===request){loading=false;$("music-refresh").disabled=false;}}
  }
  async function personalize(token,base) {
    captureListening();
    const seeds=tasteSeeds(taste,saved.favorites);
    if(!seeds.length){sections=base;render();return;}
    const results=await Promise.allSettled(seeds.map(seed=>radio(seed)));
    if(token!==request)return;
    const candidates=results.filter(result=>result.status==="fulfilled").flatMap(result=>result.value);
    const items=recommend([...candidates,...base.flatMap(section=>section.items)],taste,saved.favorites,{exclude:current?[current.id]:[],limit:18});
    sections=items.length?[{title:t("For you"),items},...base]:base;render();
  }
  function showLocal(kind) {
    ++request;loading=false;loaded=true;$("music-refresh").disabled=false;selectView(kind);status("");
    $("music-kicker").textContent=t("YOUR MUSIC");$("music-heading").textContent=kind==="favorites"?t("Liked songs"):t("Recently played");
    sections=[{title:"",items:kind==="favorites"?saved.favorites:saved.recent}];render();
  }
  $("music-search").addEventListener("submit",event=>{event.preventDefault();const query=$("music-query").value.trim();activeMood="";if(query)load("search",query);});
  document.querySelectorAll("[data-music-view]").forEach(b=>b.addEventListener("click",()=>b.dataset.musicView==="home"?load("home"):showLocal(b.dataset.musicView)));
  document.querySelectorAll("[data-music-mood]").forEach(b=>b.addEventListener("click",()=>{activeMood=b.dataset.musicMood;activeMood?load("search",moods[activeMood],b.textContent):load("home");}));
  $("music-refresh").addEventListener("click",()=>["favorites","recent"].includes(view)?showLocal(view):load(lastQuery.kind,lastQuery.value,lastQuery.heading,true));
  $("music-start").addEventListener("click",async()=>{
    const token=playRequest, catalogRequest=request;
    $("music-start").disabled=true;
    try{
      let items=tracks(sections.flatMap(s=>s.items));
      if(!items.length){
        const album=sections.flatMap(s=>s.items).find(item=>["album","playlist"].includes(item.kind));
        if(!album){$("music-query").focus();return;}
        status(t("Finding your music…"));
        const result=await invoke("music_catalog",{kind:"browse",value:album.id,language:language()});
        if(token!==playRequest||catalogRequest!==request)return;
        items=tracks(result.sections.flatMap(s=>s.items));
      }
      if(items.length){status("");playItems(items,items[Math.floor(Math.random()*items.length)].id);}
      else status(t("No music found"));
    }catch(error){if(token===playRequest&&catalogRequest===request)status(errorText(error),true);}
    finally{$("music-start").disabled=false;}
  });
  document.addEventListener("keydown",event=>{
    if(document.querySelector("main").dataset.page!=="music"||event.target.closest("input,textarea,select,button")||document.querySelector("dialog[open]"))return;
    if(event.code==="Space"){event.preventDefault();togglePlay();}if(event.key==="Escape"){queueOpen=false;renderQueue();}
  });
  new MutationObserver(syncDock).observe(document.querySelector("main"),{attributes:true,attributeFilter:["data-page"]});
  window.addEventListener("pagehide",()=>captureListening());
  onLanguageChange(()=>{
    for(const [node,label]of [[like,t("Like this song")],[shuffleButton,t("Shuffle")],[previous,t("Previous track")],[next,t("Next track")],[repeatButton,t("Repeat queue")],[queueButton,t("Play queue")],[downloadButton,t("Download MP3")]]){node.title=label;node.setAttribute("aria-label",label);}
    dock.setAttribute("aria-label",t("Music player"));queuePanel.setAttribute("aria-label",t("Play queue"));seek.setAttribute("aria-label",t("Playback position"));volume.setAttribute("aria-label",t("Volume"));
    if(!current){title.textContent=t("Pick your first track");artist.textContent=t("Your soundtrack starts here");}
    homeCache=null;if(loaded && document.querySelector("main").dataset.page==="music"){["favorites","recent"].includes(view)?showLocal(view):load(lastQuery.kind,lastQuery.value,lastQuery.heading,true);}syncDock();renderQueue();
  });
  window.__TAURI__?.event?.listen("music-control",({payload})=>{
    if(payload==="previous")previous.click();
    else if(payload==="play")play.click();
    else if(payload==="next")next.click();
  }).then(()=>syncDock()).catch(()=>{});
  return {open(){syncDock();if(!loaded&&!loading)load("home");}};
}
