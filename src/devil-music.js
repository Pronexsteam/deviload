import {createMusicNavigation} from "./music-navigation.js";
import {createMusicPresence} from "./music-presence.js";
import {t, language, onLanguageChange, errorText} from "./i18n.js";
import {tracks, remember,reorderTrack,insertNext,restoreRemoved} from "./music-state.js";
import {recordListening,tasteSeeds,recommend,listeningClock,hideRecommendation} from "./music-taste.js";
import {createNowPlaying} from "./music-presentation.js";
import {readMusicProfile,saveMusicProfile,sanitizeMusicCollection} from "./music-profile.js";
import {wireMusicProfile} from "./music-profile-ui.js";
import {wirePlaybackSettings} from "./music-playback-settings.js";
import {createMusicIntent} from "./music-intent.js";
import {readMusicSession,saveMusicSession,createPlaybackOrder} from "./music-session.js";
import {createMusicLibrary} from "./music-library.js";
import {createMusicDecks} from "./music-decks.js";
import {createMusicSound} from "./music-sound.js";
import {createMusicLyrics} from "./music-lyrics.js";

import {selectTrackRange,smartPlaylists,recommendationArtist} from "./music-library-model.js";
import {createWeeklyStats} from "./music-weekly.js";
import {openArtistPicker} from "./music-artist-picker.js";
import {wireMusicImport} from "./music-import-ui.js";
import {mergeMusicImport} from "./music-import-model.js";
import {enhanceMusicShelves} from "./music-shelf-navigation.js";
import {createMusicLibrarySidebar} from "./music-library-sidebar.js";

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
    const img=el("img",""); img.src=item.image; img.alt=""; img.loading="lazy"; img.decoding="async"; img.addEventListener("error",()=>img.remove(),{once:true}); frame.append(img);
  }
  return frame;
}
function displaySubtitle(item){if(item?.kind==="artist")return t("Artist");const names=(item?.artists||[]).filter(name=>typeof name==="string"&&name.trim()).join(", ");return names||(item?.kind==="album"?t("Album"):item?.kind==="playlist"?t("Playlist"):t("Unknown artist"));}
const time = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,"0")}` : "0:00";
function playableCover(item,glyph="play"){
  const art=cover(item),overlay=el("span","music-cover-overlay"),circle=el("span","music-cover-action");
  overlay.setAttribute("aria-hidden","true");circle.append(icon(glyph));overlay.append(circle);art.append(overlay);return art;
}

export function createMusic({invoke,onDownload}) {
  const decks=createMusicDecks();let audio=decks.current;document.body.append(...decks.nodes);
  const listen=(name,handler)=>decks.listen(name,handler);
  let storage;try{storage=localStorage;}catch{/* storage unavailable */}
  // Preferences stay on this device; no account or remote profile is needed.
  const {saved,taste}=readMusicProfile(storage);
  saved.collections??=[];
  const weekly=createWeeklyStats(storage);let privateSession=false,statsSession=null,statsSeconds=0,statsCounted=false;
  const restored=readMusicSession(storage),order=createPlaybackOrder();
  audio.volume=saved.volume;
  const clock=listeningClock(),radioCache=new Map();
  let session=0,checkpoint=0,historyAdded=false,recoveryUsed=false,pendingSeek=0,radioPending=false;
  let view="home", request=0, playRequest=0, current=null, queue=restored.queue, index=-1, sections=[], loaded=false, loading=false, repeat=restored.repeat, shuffle=restored.shuffle;
  let lastQuery={kind:"home",value:""}, homeCache=null, activeMood="", queueOpen=false, streamLoading=false;
  let resolvedTrack=null,autoplay=restored.autoplay;
  let librarySidebar=null;
  let selectedTracks=new Set(),selectionAnchor=null,visibleTrackIds=[],discoveryCandidates=[];
  let playlistId=null,listFilter="",listSort="original",sessionSavedAt=0,sessionTransition=false;
  let knownDuration=restored.duration,resumeSnapshot=null;
  let nativeState="";
  const discordPresence=createMusicPresence({invoke,storage,getPlayback:()=>({privateSession,playing:Boolean(current&&!audio.paused&&!streamLoading&&audio.readyState>=3),title:current?.title||"",artist:(current?.artists||[]).join(", "),image:current?.image||"",position:audio.currentTime||0,duration:Number.isFinite(audio.duration)?audio.duration:0})});
  let removed=null,dragged=null;
  let bufferingTimer=null,retryPosition=0;
  let nextPlan=null,preloadPending=false,preloadAttempts=new Set();
  let radioAhead=null;
  let needsRefresh=false,enginePrepared=false;
  let searchFilter="songs",continuation=null,morePending=false,browseItem=null,offlineItems=[];
  const downloadsPending=new Set();
  const navigation=createMusicNavigation({type:"catalog",kind:"home",value:"",heading:"",filter:"songs",mood:"",item:null});let restoringNavigation=false;
  const backButton=button(t("Back"),null,()=>{const target=navigation.back();if(!target)return;restoringNavigation=true;if(target.type==="local")showLocal(target.view);else if(target.type==="playlist")showPlaylist(target.id);else if(target.type==="offline")showOffline();else{searchFilter=target.filter;activeMood=target.mood;browseItem=target.item;load(target.kind,target.value,target.heading);}},"music-navigation-back");
  const homeButton=button(t("Music home"),null,()=>{activeMood="";browseItem=null;searchFilter="songs";load("home");},"music-navigation-home");
  const musicNavigation=el("nav","music-navigation");musicNavigation.setAttribute("aria-label",t("Music navigation"));musicNavigation.append(backButton,homeButton);$("devil-music").querySelector(".music-toolbar").prepend(musicNavigation);backButton.disabled=true;
  function rememberNavigation(target){if(restoringNavigation)restoringNavigation=false;else navigation.visit(target);backButton.disabled=!navigation.canGoBack();}
  onLanguageChange(()=>{backButton.textContent=backButton.title=backButton.ariaLabel=t("Back");homeButton.textContent=homeButton.title=homeButton.ariaLabel=t("Music home");musicNavigation.setAttribute("aria-label",t("Music navigation"));});
  const intent=createMusicIntent({prepare:async id=>{
    const token=playRequest,result=await playbackSource(id,false,true);
    if(token===playRequest&&!streamLoading&&audio.paused)decks.warm(id,result.url);
  },
    allowed:()=>!streamLoading&&!radioPending&&!preloadPending&&!audio.seeking&&audio.paused&&navigator.onLine!==false&&!navigator.connection?.saveData});
  const dock=el("section","music-dock"); dock.hidden=true; dock.setAttribute("aria-label",t("Music player"));
  const identity=el("div","music-now");
  const artwork=el("div","music-now-art"); artwork.append(cover(null));
  const info=el("div","music-now-info"), title=el("strong","",t("Pick your first track")), artist=el("span","",t("Your soundtrack starts here"));
  const artistLine=el("span","music-dock-artist-line");artistLine.append(equalizer(),artist);info.append(title,artistLine);
  const like=button(t("Like this song"),null,toggleLike); like.textContent="♡";
  identity.append(artwork,info,like);
  const transport=el("div","music-transport"), controls=el("div","music-transport-buttons");
  const shuffleButton=button(t("Shuffle"),"shuffle",()=>{shuffle=!shuffle;order.reset(current?.id);nextPlan=null;syncDock();persistSession();});
  const previous=button(t("Previous track"),"skip-back",()=>{if(audio.currentTime>3){audio.currentTime=0;persistSession();}else{const id=order.previous(queue),position=id?queue.findIndex(item=>item.id===id):index-1;if(position>=0)playAt(position);}});
  const play=button(t("Play"),"play",togglePlay,"music-play-button");
  const next=button(t("Next track"),"skip-forward",()=>advance(true));
  const repeatButton=button(t("Repeat queue"),"repeat",()=>{repeat={off:"all",all:"one",one:"off"}[repeat];nextPlan=null;syncDock();persistSession();});
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
  let previousVolume=audio.volume||.7,volumeSave=null;
  function syncVolume(){volume.value=String(audio.volume);volume.title=Math.round(audio.volume*100)+"%";const label=audio.volume===0?t("Unmute"):t("Mute");volumeMark.title=label;volumeMark.setAttribute("aria-label",label);volumeMark.setAttribute("aria-pressed",String(audio.volume===0));}
  function setVolume(value){decks.stopTail();audio.volume=value;saved.volume=value;if(value>0)previousVolume=value;syncVolume();clearTimeout(volumeSave);volumeSave=setTimeout(persist,200);}
  volume.addEventListener("input",()=>setVolume(Number(volume.value)));
  volume.addEventListener("change",()=>{clearTimeout(volumeSave);persist();});
  const volumeMark=button(t("Mute"),"speaker-high",()=>setVolume(audio.volume===0?previousVolume:0),"music-icon-button music-volume-mark");
  syncVolume();onLanguageChange(()=>{volume.setAttribute("aria-label",t("Volume"));syncVolume();});
  extras.append(queueButton,downloadButton,volumeMark,volume);
  dock.append(identity,transport,extras); document.body.append(dock);
  const queuePanel=el("section","music-queue-panel"); queuePanel.hidden=true; queuePanel.setAttribute("aria-label",t("Play queue")); document.body.append(queuePanel);
  const presentation=createNowPlaying({dock,identity,artwork,info,like,transport,extras,queuePanel,button,cover,
    onDownload:()=>downloadTrack(current),onHideSong:()=>feedback(false),onHideArtist:()=>feedback(true)});
  const library=createMusicLibrary({saved,button,cover,onOpen:showPlaylist,notify:status,commit:playlists=>{
    try{saveMusicProfile(storage,{...saved,playlists},taste);saved.playlists=playlists;return true;}
    catch(error){status(errorText(error),true);return false;}
  }});
  const saveToPlaylist=button(t("Add to playlist"),"playlist",()=>{if(current)library.picker(current);});extras.insertBefore(saveToPlaylist,queueButton);
  const sound=createMusicSound({nodes:decks.nodes,storage,button,notify:status});
  const lyrics=createMusicLyrics({invoke,button,getTrack:()=>current,getAudio:()=>audio});
  const lyricsButton=button(t("Lyrics"),"music-notes",()=>lyrics.open());lyricsButton.dataset.i18nTitle="Lyrics";lyricsButton.dataset.i18nAriaLabel="Lyrics";extras.insertBefore(lyricsButton,queueButton);
  const soundButton=button(t("Sound and transitions"),"equalizer",()=>sound.open());soundButton.dataset.i18nTitle="Sound and transitions";soundButton.dataset.i18nAriaLabel="Sound and transitions";extras.insertBefore(soundButton,queueButton);
  const filters=el("div","music-search-filters");filters.hidden=true;
  for(const [value,label]of [["all",t("All results")],["songs",t("Songs")],["albums",t("Albums")],["artists",t("Artists")]]){
    const node=button(label,null,()=>{searchFilter=value;load("search",lastQuery.value);},"music-filter-chip");node.dataset.filter=value;filters.append(node);
  }
  $("music-library-tools").before(filters);
  const offlineTab=button(t("Downloaded music"),null,showOffline,"music-filter-chip");document.querySelector(".music-tabs").append(offlineTab);
  $("music-discovery").value=taste.mode;
  $("music-regional").checked=saved.showRegional!==false;
  $("music-regional").addEventListener("change",()=>{saved.showRegional=$("music-regional").checked;persist();load("home","","",true);});
  $("music-discovery").addEventListener("change",()=>{taste.mode=$("music-discovery").value;persist();if(view==="home"&&homeCache)personalize(request,homeCache.sections);});
  $("music-restore-hidden").addEventListener("click",()=>{taste.hiddenSongs=[];taste.blockedArtists=[];persist();if(view==="home"&&homeCache)personalize(request,homeCache.sections);status(t("Hidden recommendations restored."));});
  wirePlaybackSettings(invoke);
  wireMusicImport({invoke,button,commit:(batch,options)=>{captureListening();const result=mergeMusicImport(saved,taste,batch,options);saveMusicProfile(storage,result.saved,result.taste);Object.assign(saved,result.saved);Object.assign(taste,result.taste);library.invalidateUndo();clock.reset();session++;checkpoint=0;historyAdded=false;homeCache=null;radioCache.clear();radioAhead=null;showPlaylist(null);return result;}});
  wireMusicProfile({invoke,read:()=>{captureListening();return {saved,taste};},restore:profile=>{
    saveMusicProfile(storage,profile.saved,profile.taste);
    Object.assign(saved,profile.saved);Object.assign(taste,profile.taste);library.invalidateUndo();
    clock.reset();session++;checkpoint=0;historyAdded=false;
    audio.volume=saved.volume;volume.value=String(saved.volume);$("music-discovery").value=taste.mode;
    $("music-regional").checked=saved.showRegional!==false;homeCache=null;radioCache.clear();radioAhead=null;
    syncDock();if(view==="library"||view==="playlist")showPlaylist(library.find(playlistId)?playlistId:null);else if(["favorites","recent"].includes(view))showLocal(view);
    else if(view==="home")load("home");
  }});

  function chooseArtists(){openArtistPicker({invoke,button,cover,collections:()=>saved.collections,save:items=>{const collections=[...saved.collections,...items.filter(item=>!saved.collections.some(x=>x.id===item.id))];saveMusicProfile(storage,{...saved,collections},taste);saved.collections=collections;homeCache=null;load("home");}});}
  $("music-choose-artists").addEventListener("click",chooseArtists);
  $("music-private-session").addEventListener("change",()=>{captureListening();if(statsSession!==session)statsCounted=false;privateSession=$("music-private-session").checked;discordPresence.sync(true);clock.reset();session++;statsSession=session;statsSeconds=0;checkpoint=0;historyAdded=false;});
  function renderWeekly(root){const value=weekly.summary(),card=el("section","music-weekly-card");card.append(el("span","music-eyebrow",t("YOUR LAST 7 DAYS")),el("h4","",t("{minutes} minutes · {plays} listens",{minutes:value.totalMinutes,plays:value.totalQualifiedPlays})),el("p","",value.totalSeconds?t("{tracks} tracks · Top artist: {artist}",{tracks:String(value.uniqueTracks)+(value.uniqueTracksCapped?"+":""),artist:value.topArtist||t("Unknown artist")}):t("Your listening summary will appear here. Only this device is counted.")));root.append(card);}
  function persist() {
    try {
      saveMusicProfile(storage,saved,taste);
    }
    catch { status(t("Could not save your music preferences."),true); }
  }
  function persistSession(){
    if(sessionTransition||privateSession)return;
    try{saveMusicSession(storage,{queue,id:current?.id||null,position:resolvedTrack===current?.id?audio.currentTime:retryPosition,duration:knownDuration,repeat,shuffle,autoplay});sessionSavedAt=Date.now();}
    catch{status(t("Could not save your music preferences."),true);}
  }
  async function playbackSource(id,refresh=false,preload=false){
    if(window.__TAURI__?.core?.convertFileSrc){
      const path=await invoke("music_offline_source",{id});
      if(path)return {url:window.__TAURI__.core.convertFileSrc(path),offline:true};
    }
    return invoke("music_stream",{id,refresh,preload});
  }
  async function showOffline(){
    rememberNavigation({type:"offline"});
    const token=++request;listFilter="";$("music-library-filter").value="";selectView("offline");loading=false;$("music-refresh").disabled=false;status("");
    $("music-heading").textContent=t("Downloaded music");$("music-kicker").textContent=t("ON THIS DEVICE");skeleton();
    try{
      if(!window.__TAURI__?.core?.convertFileSrc)throw Error(t("Open the installed Deviload app to download."));
      const items=await invoke("music_downloaded",{});if(token!==request)return;
      const known=[...saved.favorites,...saved.recent,...(saved.playlists||[]).flatMap(list=>list.items)];
      offlineItems=items.map(item=>known.find(value=>value.id===item.id)||item);
      sections=[{title:t("Available without internet"),items:offlineItems}];render();
    }catch(error){if(token===request){sections=[];render();status(errorText(error),true);}}
  }
  function toggleCollection(item){
    const exists=saved.collections.some(value=>value.id===item.id);
    if(!exists&&saved.collections.length>=200){status(t("Your library can hold up to 200 albums and artists."),true);return;}
    const collections=exists?saved.collections.filter(value=>value.id!==item.id):[sanitizeMusicCollection(item),...saved.collections];
    try{saveMusicProfile(storage,{...saved,collections},taste);saved.collections=collections;render();}
    catch(error){status(errorText(error),true);}
  }
  function feedback(artist,item=current) {
    if(!item)return;
    const hiddenSongs=[...taste.hiddenSongs],blockedArtists=[...taste.blockedArtists];
    hideRecommendation(taste,item,artist);persist();
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
  function equalizer(){const bars=el("span","music-equalizer");bars.setAttribute("aria-hidden","true");for(let n=0;n<4;n++)bars.append(el("i",""));return bars;}
  function markPlayback(node,id){const active=Boolean(current&&id===current.id);node.classList.toggle("active",active);node.classList.toggle("is-playing",active&&!audio.paused&&!streamLoading&&audio.readyState>=3);node.setAttribute("aria-current",String(active));}
  function syncDock() {
    dock.hidden=!current && document.querySelector("main").dataset.page!=="music";
    if(dock.hidden&&queueOpen){queueOpen=false;renderQueue();}
    document.body.classList.toggle("has-music-player",!dock.hidden);
    play.replaceChildren(icon(streamLoading ? "spinner-gap" : audio.paused ? "play" : "pause"));
    play.classList.toggle("loading",streamLoading);
    play.title=play.ariaLabel=streamLoading?t("Cancel loading"):audio.paused?t("Play"):t("Pause");
    const liked=current && saved.favorites.some(item=>item.id===current.id);
    like.textContent=liked?"♥":"♡";like.setAttribute("aria-pressed",String(Boolean(liked)));like.disabled=!current;
    downloadButton.disabled=!current||downloadsPending.has(current.id);
    shuffleButton.setAttribute("aria-pressed",String(shuffle));repeatButton.setAttribute("aria-pressed",String(repeat!=="off"));
    repeatButton.title=repeatButton.ariaLabel=repeat==="one"?t("Repeat one song"):repeat==="all"?t("Repeat queue"):t("Repeat off");
    repeatButton.dataset.repeat=repeat;saveToPlaylist.disabled=!current;
    play.disabled=!current&&!queue.length;previous.disabled=index<0;next.disabled=!current||radioPending||(!autoplay&&plannedNext()<0);
    document.querySelectorAll(".music-track-row,.music-card-song").forEach(row=>markPlayback(row,row.dataset.trackId));
    markPlayback(dock,current?.id);markPlayback(info,current?.id);
    presentation.update(current,Boolean(current&&downloadsPending.has(current.id)));
    syncNativeControls();
    discordPresence.sync();
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
    if(!changeFavorite(current))return;
    syncDock();if(view==="favorites")showLocal("favorites");
  }
  function changeFavorite(item){
    const favorites=saved.favorites.some(value=>value.id===item.id)?saved.favorites.filter(value=>value.id!==item.id):tracks([item,...saved.favorites]);
    try{saveMusicProfile(storage,{...saved,favorites},taste);saved.favorites=favorites;return true;}
    catch(error){status(errorText(error),true);return false;}
  }
  function renderQueue() {
    queuePanel.hidden=!queueOpen;queueButton.setAttribute("aria-expanded",String(queueOpen));
    queuePanel.replaceChildren();if(!queueOpen)return;
    const head=el("div","music-queue-head");head.append(el("h3","",t("Play queue")),button(t("Close"),"x-circle",()=>{queueOpen=false;renderQueue();}));queuePanel.append(head);
    const option=el("label","music-autoplay"),toggle=el("input","");toggle.type="checkbox";toggle.checked=autoplay;
    toggle.addEventListener("change",()=>{autoplay=toggle.checked;if(!autoplay&&radioPending){++playRequest;radioPending=false;status("");}syncDock();persistSession();});
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
  function syncQueue(){index=current?queue.findIndex(item=>item.id===current.id):-1;nextPlan=null;renderQueue();syncDock();persistSession();}
  function move(id,position){queue=reorderTrack(queue,id,position);syncQueue();queuePanel.querySelector(`[data-track-id="${id}"] .music-queue-select`)?.focus();}
  function removeTrack(id){
    const position=queue.findIndex(item=>item.id===id);if(position<0)return;
    removed={item:queue[position],position};queue=queue.filter(item=>item.id!==id);
    if(current?.id===id){
      if(queue.length)playAt(Math.min(position,queue.length-1));
      else {captureListening(true);++playRequest;cancelResolution();clearTimeout(bufferingTimer);audio.pause();audio.removeAttribute("src");audio.load();current=null;resolvedTrack=null;streamLoading=false;radioPending=false;clock.reset();seek.disabled=true;seek.value="0";elapsed.textContent=duration.textContent="0:00";title.textContent=t("Pick your first track");artist.textContent=t("Your soundtrack starts here");artwork.replaceChildren(cover(null));}
    }
    syncQueue();
  }
  function captureListening(skipped=false) {
    if(!current||privateSession)return;
    if(clock.seconds>0&&!historyAdded){saved.recent=remember(saved.recent,current);historyAdded=true;}
    if(statsSession!==session){statsSession=session;statsSeconds=0;statsCounted=false;}
    const delta=Math.max(0,clock.seconds-statsSeconds),qualified=!statsCounted&&(clock.seconds>=30||(audio.duration>0&&clock.seconds/audio.duration>=.8));
    if(delta>0||qualified)weekly.record({item:current,seconds:delta,qualified});
    statsSeconds=clock.seconds;statsCounted ||= qualified;
    if(current&&recordListening(taste,current,{seconds:clock.seconds,duration:audio.duration,skipped,session}))persist();
  }
  function plannedNext() {
    const signature=JSON.stringify([current?.id,queue.map(item=>item.id),repeat,shuffle]);
    if(nextPlan?.signature!==signature){
      const position=order.next(queue,index,repeat==="all",shuffle);
      nextPlan={signature,id:queue[position]?.id};
    }
    return nextPlan.id ? queue.findIndex(item=>item.id===nextPlan.id) : -1;
  }
  function cancelResolution(){intent.leave();invoke("music_cancel_stream",{}).catch(()=>{});}
  function preloadNext() {
    // Resolve one upcoming song and cache its first audio chunk in the relay.
    // Prepare early enough for the Next button, within the five-minute cache life.
    const remaining=audio.duration-audio.currentTime;
    if(!current||streamLoading||radioPending||preloadPending||audio.paused||audio.seeking||audio.readyState<4||navigator.onLine===false||navigator.connection?.saveData||
      !Number.isFinite(remaining)||remaining<=0||remaining>240||audio.currentTime<2)return;
    if(repeat==="one")return;
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
    if(!id||id===current.id||preloadAttempts.has(id)||preloadAttempts.size>=1)return;
    const token=playRequest;
    preloadAttempts.add(id);preloadPending=true;
    const job=Promise.resolve().then(()=>{
      if(token!==playRequest||audio.paused||candidate()?.id!==id)return;
      return window.__TAURI__?.core?.convertFileSrc?playbackSource(id,false,true):invoke("music_stream",{id,refresh:false,preload:true});
    });
    // Foreground selections can cancel extraction in the backend. They reopen
    // through the cache so expired or failed sources are rechecked.
    job.then(result=>{if(result&&token===playRequest&&candidate()?.id===id)decks.warm(id,result.url);}).catch(()=>{/* A speculative failure must not interrupt the current song. */})
      .finally(()=>{preloadPending=false;});
  }
  async function startAudio(){
    sound.resume();
    let timer;
    try{await Promise.race([audio.play(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(t("Audio did not start in time. Press play to retry."))),20000);})]);}
    finally{clearTimeout(timer);}
  }
  async function playAt(position,{refresh=false,resume=0,recovery=false,overlap=0}={}) {
    if(!queue[position])return;
    if(resumeSnapshot&&current&&resumeSnapshot.item.id===current.id)resumeSnapshot.position=resolvedTrack===current.id?audio.currentTime:retryPosition;
    intent.leave();
    if(!recovery){captureListening(true);clock.reset();session++;checkpoint=0;historyAdded=false;recoveryUsed=false;}
    sessionTransition=true;
    const prepared=!refresh?decks.take(queue[position].id,saved.volume,overlap):null;
    if(prepared)audio=prepared;else decks.stopTail();
    if(current?.id!==queue[position].id)knownDuration=0;
    const token=++playRequest;index=position;current=queue[index];order.visit(current.id,queue);resolvedTrack=null;radioPending=false;retryPosition=resume;
    nextPlan=null;preloadAttempts=new Set();radioAhead=null;
    clearTimeout(bufferingTimer);if(!prepared){audio.pause();audio.removeAttribute("src");audio.load();}seek.disabled=true;seek.value=knownDuration?String(resume/knownDuration*1000):"0";elapsed.textContent=time(resume);duration.textContent=time(knownDuration);
    title.textContent=current.title;artist.title="";artist.textContent=t("Opening track…");artwork.replaceChildren(cover(current));status("");
    pendingSeek=resume;streamLoading=true;syncDock();renderQueue();
    sessionTransition=false;persistSession();
    try {
      const id=current.id;
      // Coalesce clicks in the same turn, but never await a superseded track.
      const job=Promise.resolve().then(()=>{
        if(token!==playRequest)throw new DOMException("Superseded","AbortError");
        // Activate a prepared source in the engine as well as the decoder.
        // This adopts its initial buffer and starts the full continuation.
        return playbackSource(id,refresh);
      });
      const result=await job;
      if(token!==playRequest)return;
      if(!prepared||audio.src!==result.url)audio.src=result.url;
      else{knownDuration=audio.duration;if(resume>0&&Number.isFinite(audio.duration)){audio.currentTime=Math.min(resume,Math.max(0,audio.duration-1));pendingSeek=0;}}
      resolvedTrack=current.id;
      await startAudio();
      if(token!==playRequest)return;
      needsRefresh=false;artist.textContent=displaySubtitle(current)||"YouTube Music";status("");
    } catch(error) {
      if(token!==playRequest)return;
      needsRefresh=true;retryPosition=Math.max(retryPosition,audio.currentTime||0);audio.pause();audio.removeAttribute("src");audio.load();resolvedTrack=null;artist.textContent=t("Could not play. Press play to retry.");artist.title=errorText(error);status(errorText(error),true);
    } finally {if(token===playRequest){streamLoading=false;syncDock();}}
  }
  function playItems(items,startId) {
    queue=tracks(items).slice(0,200);order.reset();const position=queue.findIndex(item=>item.id===startId);if(queue.length)playAt(Math.max(0,position));
  }
  function resumeListening(snapshot) {
    if(current?.id===snapshot.item.id){if(streamLoading||!audio.paused)return;return togglePlay();}
    queue=tracks(snapshot.queue).slice(0,200);if(!queue.some(item=>item.id===snapshot.item.id))queue=[snapshot.item,...queue].slice(0,200);order.reset();
    return playAt(queue.findIndex(item=>item.id===snapshot.item.id),{resume:snapshot.position});
  }
  async function togglePlay() {
    if(!current){if(queue.length)playAt(0);return;}
    if(radioPending){++playRequest;radioPending=false;audio.pause();status("");syncDock();return;}
    if(streamLoading){++playRequest;cancelResolution();streamLoading=false;retryPosition=Math.max(retryPosition,audio.currentTime||0);audio.pause();audio.removeAttribute("src");audio.load();resolvedTrack=null;artist.textContent=displaySubtitle(current);syncDock();return;}
    if(!audio.paused){cancelResolution();audio.pause();return;}
    if(resolvedTrack!==current.id){recoveryUsed=false;return playAt(index,{refresh:needsRefresh,resume:retryPosition,recovery:retryPosition>0});}
    if(audio.ended)return playAt(index);
    const token=playRequest;streamLoading=true;syncDock();
    try{await startAudio();if(token===playRequest)status("");}
    catch(error){if(token===playRequest){needsRefresh=true;retryPosition=audio.currentTime||0;audio.pause();resolvedTrack=null;artist.textContent=t("Could not play. Press play to retry.");status(errorText(error),true);}}
    finally{if(token===playRequest){streamLoading=false;syncDock();}}
  }
  async function radio(seed) {
    const key=`${language()}:${seed.id}`,cached=radioCache.get(key);
    if(cached&&Date.now()-cached.at<10*60000)return cached.items;
    const result=await invoke("music_catalog",{kind:"radio",value:seed.id,language:language()});
    const items=tracks(result.sections.flatMap(section=>section.items));
    if(radioCache.size>=8)radioCache.delete(radioCache.keys().next().value);
    radioCache.set(key,{at:Date.now(),items});return items;
  }
  async function radioCandidates(seed) {
    const seeds=tracks([seed,...tasteSeeds(taste,saved.favorites)]).slice(0,2);
    const results=await Promise.allSettled(seeds.map(item=>radio(item)));
    const candidates=results.filter(result=>result.status==="fulfilled").flatMap(result=>result.value);
    if(!candidates.length&&results.every(result=>result.status==="rejected"))throw results[0].reason;
    return recommend(candidates,taste,saved.favorites,{exclude:queue.map(item=>item.id),limit:15,followedArtists:(saved.collections||[]).filter(item=>item.kind==="artist").map(item=>item.title)});
  }
  async function advance(skipped=false){
    if(!current||radioPending)return;
    captureListening(skipped);
    if(!skipped&&repeat==="one"){playAt(index);return;}
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
  listen("ended",()=>advance(false));
  listen("play",()=>{
    document.querySelectorAll("audio, video").forEach(other=>{if(!decks.owns(other))other.pause();});
    if("mediaSession" in navigator && current){
      navigator.mediaSession.metadata=new MediaMetadata({title:current.title,artist:displaySubtitle(current),artwork:current.image?[{src:current.image}]:[]});
    }
    syncDock();
  });
  document.addEventListener("play",event=>{if(!decks.owns(event.target)){decks.stopTail();audio.pause();}},true);
  listen("playing",()=>{clearTimeout(bufferingTimer);if(current&&!historyAdded&&!privateSession){saved.recent=remember(saved.recent,current);historyAdded=true;persist();}clock.sample(audio.currentTime,performance.now(),false);artist.textContent=displaySubtitle(current)||"YouTube Music";syncDock();});
  listen("pause",()=>{decks.stopTail();clearTimeout(bufferingTimer);clock.sample(audio.currentTime,performance.now(),false);captureListening();syncDock();persistSession();});
  listen("waiting",()=>{
    clock.sample(audio.currentTime,performance.now(),false);clearTimeout(bufferingTimer);syncDock();
    if(!current||audio.paused||streamLoading)return;
    const token=playRequest;
    bufferingTimer=setTimeout(()=>{if(token!==playRequest||audio.paused)return;
      if(!recoveryUsed){recoveryUsed=true;playAt(index,{refresh:true,resume:audio.currentTime,recovery:true});}
      else{needsRefresh=true;retryPosition=audio.currentTime||0;audio.pause();resolvedTrack=null;artist.textContent=t("Could not play. Press play to retry.");status(t("Audio did not start in time. Press play to retry."),true);syncDock();}
    },20000);
  });
  listen("loadedmetadata",()=>{if(Number.isFinite(audio.duration))knownDuration=audio.duration;if(pendingSeek>0&&Number.isFinite(audio.duration)){audio.currentTime=Math.min(pendingSeek,Math.max(0,audio.duration-1));pendingSeek=0;}});
  listen("error",()=>{
    if(streamLoading||!current)return;
    if(!recoveryUsed&&clock.seconds>0){recoveryUsed=true;playAt(index,{refresh:true,resume:audio.currentTime,recovery:true});return;}
    needsRefresh=true;retryPosition=audio.currentTime||0;audio.pause();resolvedTrack=null;artist.textContent=t("Could not play. Press play to retry.");syncDock();
  });
  listen("seeked",()=>discordPresence.sync(true));
  listen("timeupdate",()=>{
    discordPresence.sync();
    const seconds=clock.sample(audio.currentTime,performance.now(),!audio.paused&&!audio.seeking&&audio.readyState>=3);
    if(seconds>=30&&seconds-checkpoint>=15){checkpoint=seconds;captureListening();}
    elapsed.textContent=time(audio.currentTime);duration.textContent=time(audio.duration);seek.disabled=!Number.isFinite(audio.duration);if(Number.isFinite(audio.duration))seek.value=String(audio.currentTime/audio.duration*1000);
    preloadNext();lyrics.update();
    const upcoming=plannedNext(),remaining=audio.duration-audio.currentTime;
    if(sound.transition&&repeat!=="one"&&!streamLoading&&!audio.paused&&!audio.seeking&&remaining>0&&remaining<=sound.transition&&upcoming>=0&&decks.ready(queue[upcoming].id)){captureListening();playAt(upcoming,{overlap:remaining});}
    if(Date.now()-sessionSavedAt>=5000)persistSession();
  });
  if("mediaSession" in navigator){for(const [name,action]of Object.entries({play:()=>{if(audio.paused&&!streamLoading)togglePlay();},pause:()=>audio.pause(),previoustrack:()=>previous.click(),nexttrack:()=>advance(true)}))try{navigator.mediaSession.setActionHandler(name,action);}catch{/* unsupported control */}}

  function selectView(next) {
    filters.hidden=next!=="search";offlineTab.setAttribute("aria-current",next==="offline"?"page":"false");
    filters.querySelectorAll("button").forEach(node=>node.setAttribute("aria-pressed",String(node.dataset.filter===searchFilter)));
    view=next;$("music-home-hero").hidden=next!=="home";$("music-moods").hidden=!["home","search"].includes(next);
    document.querySelectorAll("[data-music-view]").forEach(b=>{const selected=b.dataset.musicView===(next==="playlist"?"library":next);b.classList.toggle("selected",selected);b.setAttribute("aria-current",selected?"page":"false");});
    document.querySelectorAll("[data-music-mood]").forEach(b=>{b.classList.toggle("selected",b.dataset.musicMood===activeMood);b.setAttribute("aria-pressed",String(b.dataset.musicMood===activeMood));});
    $("devil-music").dataset.view=next;
    $("music-library-tools").hidden=next==="home"||next==="library";
    $("music-library-filter").value=listFilter;
  }
  function card(item,items,personal=false) {
    const card=el("article",`music-card music-card-${item.kind}`);if(item.kind==="song"){card.dataset.trackId=item.id;markPlayback(card,item.id);}
    const action=button(item.kind==="song"?t("Play {title}",{title:item.title}):t("Open {title}",{title:item.title}),null,()=>{
      if(item.kind==="song")playItems(items,item.id);
      else {browseItem=item;load("browse",item.id,item.title);}
    },"music-card-main");
    const art=playableCover(item,item.kind==="song"?"play":"arrow-right");
    action.replaceChildren(art,el("strong","music-card-title",item.title),el("span","music-card-subtitle",displaySubtitle(item)));card.append(action);
    if(item.kind==="song") {
      action.querySelector(".music-card-subtitle").prepend(equalizer());
      if(personal){const artist=recommendationArtist(item,taste,saved.favorites),reason=artist?t("Matches your taste: {artist}",{artist}):taste.entries[item.id]?.lastPlayed?t("From your listening history"):t("A new discovery");card.append(el("span","music-recommendation-reason",reason));}
      const cardMenu=trackMenu(item);cardMenu.menu.classList.add("music-card-feedback");card.append(cardMenu.menu);
      action.addEventListener("mouseenter",()=>intent.enter(item.id));
      action.addEventListener("mouseleave",()=>intent.leave());
      action.addEventListener("focus",()=>intent.enter(item.id));
      action.addEventListener("blur",()=>intent.leave());
      const add=button(t("Add to play queue"),"plus",()=>{queue=tracks([...queue,item]).slice(0,200);syncQueue();status(t("Added to play queue"));},"music-card-add");card.append(add);
      card.append(button(t("Add to playlist"),"playlist",()=>library.picker(item),"music-card-save-playlist"));
      const next=button(t("Play next"),"skip-forward",()=>{queue=insertNext(queue,current?.id,item);syncQueue();status(t("Added to play next"));},"music-card-next");card.append(next);
      card.append(button(t("Download MP3"),"download-simple",()=>downloadTrack(item),"music-card-download"));
    }else if(["album","artist","playlist"].includes(item.kind)){
      const savedButton=button(item.kind==="artist"?t("Follow artist"):t("Save album"),"plus",()=>toggleCollection(item),"music-card-add");
      savedButton.setAttribute("aria-pressed",String(saved.collections.some(value=>value.id===item.id)));card.append(savedButton);
    }
    return card;
  }
  function render() {
    librarySidebar?.refresh(view==="favorites"?"favorites":view==="playlist"?playlistId:null);
    intent.leave();
    const root=$("music-shelves");root.replaceChildren();enhanceMusicShelves(root);
    root.classList.toggle("music-results",view!=="home");
    if(view==="library"){
      renderWeekly(root);renderSmartLibrary(root);library.overview(root);if(library.canUndo())root.append(button(t("Undo library change"),null,()=>library.undo(null),"music-filter-chip"));
      for(const [kind,label]of [["artist",t("Followed artists")],["album",t("Saved albums")],["playlist",t("Saved playlists")]]){
        const items=saved.collections.filter(item=>item.kind===kind);if(!items.length)continue;
        const shelf=el("section","music-shelf"),grid=el("div","music-card-grid");shelf.append(el("h4","",label),grid);items.forEach(item=>grid.append(card(item,items)));root.append(shelf);
      }return;
    }
    if(view==="browse"&&browseItem?.id===lastQuery.value){
      const banner=el("div","music-collection-banner"),copy=el("div","");
      copy.append(el("h2","",browseItem.title),el("p","",displaySubtitle(browseItem)));
      const songs=tracks(sections.flatMap(section=>section.items));
      const start=button(t("Play"),"play",()=>playItems(songs),"music-primary music-text-button");start.disabled=!songs.length;
      const save=button(browseItem.kind==="artist"?t("Follow artist"):t("Save album"),"plus",()=>toggleCollection(browseItem),"music-filter-chip");
      save.setAttribute("aria-pressed",String(saved.collections.some(value=>value.id===browseItem.id)));copy.append(start,save);
      if(browseItem.kind==="artist")copy.append(button(t("Find all albums"),null,()=>{searchFilter="albums";load("search",browseItem.title);},"music-filter-chip"));
      banner.append(cover(browseItem),copy);root.append(banner);
    }
    if(view==="home"&&saved.showRegional===false&&!sections.some(section=>section.items.length)){
      const empty=el("div","music-empty");empty.append(el("h4","",t("Start with music you love")),el("p","",t("Search for an artist and listen or like a song. Your personal recommendations will grow here.")));root.append(empty);return;
    }
    if(view==="home"&&!saved.favorites.length&&!saved.collections.some(x=>x.kind==="artist")&&!Object.keys(taste.entries).length){const prompt=el("div","music-resume-card");prompt.append(el("strong","",t("Make your first mix personal")),button(t("Choose favorite artists"),null,chooseArtists,"music-primary"));root.append(prompt);}
    if(view==="home"&&current){const snapshot=resumeSnapshot={item:current,queue:[...queue],position:resolvedTrack===current.id?audio.currentTime:retryPosition};const resume=el("div","music-resume-card"),copy=el("div","");copy.append(el("span","music-eyebrow",t("CONTINUE LISTENING")),el("strong","",snapshot.item.title),el("small","",displaySubtitle(snapshot.item)));resume.append(cover(snapshot.item),copy,button(t("Resume listening"),"play",()=>resumeListening(snapshot),"music-primary music-text-button"));root.append(resume);}
    if(view==="playlist"){
      const playlist=getPlaylist(playlistId);if(!playlist){showPlaylist(null);return;}
      const banner=el("div","music-playlist-banner music-playlist-feature"),copy=el("div","music-playlist-feature-copy"),actions=el("div","music-playlist-feature-actions");
      banner.append(library.artwork(playlist));copy.append(el("span","music-eyebrow",playlist.smart?t("MADE FOR YOU"):t("YOUR PLAYLIST")),el("h2","",playlist.name));if(playlist.description)copy.append(el("p","",playlist.description));copy.append(el("span","music-playlist-count",t("{count} tracks",{count:playlist.items.length})));
      const start=button(t("Play"),"play",()=>playItems(playlist.items),"music-primary music-text-button");start.disabled=!playlist.items.length;actions.append(start);
      if(!playlist.smart){const pin=button(playlist.pinned?t("Unpin playlist"):t("Pin playlist"),null,()=>library.pin(playlist.id),"music-filter-chip");pin.setAttribute("aria-pressed",String(!!playlist.pinned));actions.append(pin,button(t("Edit playlist"),"pencil-simple",()=>library.rename(playlist.id)),button(t("Review similar tracks"),null,()=>library.duplicates(playlist.id),"music-filter-chip"),button(t("Delete playlist"),"trash",()=>library.remove(playlist.id)));}
      copy.append(actions);banner.append(copy);root.append(banner);
      if(!playlist.smart){const controls=el("div","music-batch-actions");controls.append(el("strong","",t("{count} selected",{count:selectedTracks.size})),button(t("Select visible tracks"),null,()=>{const ids=visibleTrackIds;if(ids.every(id=>selectedTracks.has(id)))ids.forEach(id=>selectedTracks.delete(id));else ids.forEach(id=>selectedTracks.add(id));render();},"quiet small"));for(const [label,action]of [[t("Copy to playlist"),()=>library.transfer(playlist.id,[...selectedTracks],false)],[t("Move to playlist"),()=>library.transfer(playlist.id,[...selectedTracks],true)],[t("Remove selected"),()=>library.removeTracks(playlist.id,[...selectedTracks])]]){const control=button(label,null,action,"outline small");control.disabled=!selectedTracks.size;controls.append(control);}if(library.canUndo())controls.append(button(t("Undo library change"),null,()=>library.undo(playlistId),"quiet small"));root.append(controls);}
      if(!playlist.items.length){const empty=el("div","music-empty");empty.append(el("h4","",playlist.smart?t("Your mix is still growing"):t("Make room for your favorites")),el("p","",playlist.smart?t("Keep listening and liking songs. This playlist updates from your history."):t("Create a playlist, then add songs from search or your liked songs.")));root.append(empty);return;}
    }
    if(!sections.some(section=>section.items.length)){
      const empty=el("div","music-empty");empty.append(icon("music-notes"),el("h4","",view==="favorites"?t("Keep the songs you love"):view==="recent"?t("Your listening story starts here"):t("No music found")),
        el("p","",view==="favorites"?t("Tap the heart to save a song on this device."):view==="recent"?t("Songs you have played on this device appear here."):t("Try another artist, album or song.")));root.append(empty);return;
    }
    const all=sections.flatMap(section=>section.items);
    for(const section of sections){
      const shelf=el("section","music-shelf");
      if(section.title)shelf.append(el("h4","",section.title));
      let items=section.items;
      if(view!=="home"){
        const query=listFilter.trim().toLocaleLowerCase();items=items.filter(item=>`${item.title} ${item.subtitle||""}`.toLocaleLowerCase().includes(query));
        if(listSort!=="original")items=[...items].sort((a,b)=>(listSort==="artist"?(a.artists?.[0]||a.subtitle||""):(a.title||"")).localeCompare(listSort==="artist"?(b.artists?.[0]||b.subtitle||""):(b.title||""),language()));
      }
      const songs=items.filter(item=>item.kind==="song"),others=items.filter(item=>item.kind!=="song");
      if(view!=="home"&&songs.length){const list=el("div","music-track-list");visibleTrackIds=songs.map(item=>item.id);songs.forEach((item,position)=>list.append(trackRow(item,songs,position)));shelf.append(list);}
      const grid=el("div","music-card-grid");for(const item of view==="home"?items:others)grid.append(card(item,all,view==="home"&&section.title===t("For you")));if(grid.childElementCount)shelf.append(grid);
      if(!items.length)shelf.append(el("p","music-empty-copy",t("No music found")));
      root.append(shelf);
    }
    enhanceMusicShelves(root);
    if(continuation&&["search","browse"].includes(view)){
      const more=button(t("Load more"),null,loadMore,"music-filter-chip");more.disabled=morePending;root.append(more);
    }
  }
  async function loadMore(){
    if(morePending||!continuation)return;morePending=true;const token=request,next=continuation;render();
    try{
      const result=await invoke("music_catalog",{...lastQuery,language:language(),filter:searchFilter,continuation:next});if(token!==request)return;
      const seen=new Set(sections.flatMap(section=>section.items.map(item=>item.id)));
      const items=result.sections.flatMap(section=>section.items).filter(item=>!seen.has(item.id)&&seen.add(item.id));
      if(items.length)sections.push({title:"",items});
      continuation=items.length&&seen.size<1000&&result.continuation!==next?result.continuation:null;status("");
    }catch(error){if(token===request)status(errorText(error),true);}
    finally{if(token===request){morePending=false;render();}}
  }
  function trackMenu(item){
    const menu=el("details","music-track-menu"),summary=el("summary","music-icon-button"),options=el("div","music-track-options");menu.name="music-track-actions";summary.title=t("More actions");summary.setAttribute("aria-label",t("More actions"));summary.append(icon("dots-three"));menu.append(summary,options);
    let prepared=false;
    const prepare=()=>{if(prepared)return;prepared=true;
    const liked=saved.favorites.some(value=>value.id===item.id);
    options.prepend(
      button(t("Add to playlist"),"plus",()=>library.picker(item)),
      button(liked?t("Remove from liked songs"):t("Like this song"),"heart",()=>{if(changeFavorite(item)){syncDock();if(view==="favorites")showLocal(view);else render();}}),
      button(t("Play next"),"skip-forward",()=>{queue=insertNext(queue,current?.id,item).slice(0,200);syncQueue();status(t("Added to play next"));}),
      button(t("Add to play queue"),"queue",()=>{queue=tracks([...queue,item]).slice(0,200);syncQueue();status(t("Added to play queue"));}),
      button(t("Song radio"),"music-notes",()=>{browseItem=null;load("radio",item.id,t("Song radio"));}),
      button(t("Less like this"),"eye-slash",()=>feedback(false,item)),
      button(t("Do not recommend this artist"),"user-minus",()=>feedback(true,item)),
      button(t("Download MP3"),"download-simple",()=>downloadTrack(item)),
      button(t("Copy song link"),"copy",async()=>{try{await navigator.clipboard.writeText("https://music.youtube.com/watch?v="+encodeURIComponent(item.id));status(t("Song link copied"));}catch{status(t("Could not copy the song link."),true);}})
    );
    for(const action of options.querySelectorAll("button")){action.classList.remove("music-icon-button");action.classList.add("music-menu-action");action.append(el("span","music-menu-label",action.getAttribute("aria-label")));}
    };
    menu.addEventListener("toggle",()=>{if(!menu.open)return;prepare();const rect=summary.getBoundingClientRect();options.style.maxHeight=Math.max(80,innerHeight-32)+"px";options.style.left=Math.max(8,Math.min(innerWidth-240,rect.right-232))+"px";const bottom=innerHeight-(dock.hidden?0:dock.offsetHeight)-16;options.style.maxHeight=Math.max(80,bottom-16)+"px";options.style.top=Math.max(8,rect.bottom+4+options.offsetHeight>bottom?rect.top-options.offsetHeight-4:rect.bottom+4)+"px";});
    options.addEventListener("click",event=>{if(event.target.closest("button"))menu.open=false;});
    menu.addEventListener("keydown",event=>{if(event.key==="Escape"){menu.open=false;summary.focus();event.stopPropagation();}});
    return {menu,options};
  }
  function trackRow(item,items,position){
    const row=el("article","music-track-row");row.dataset.trackId=item.id;markPlayback(row,item.id);
    const select=button(t("Play {title}",{title:item.title}),null,event=>{if(view==="playlist"&&!getPlaylist(playlistId)?.smart&&(event.ctrlKey||event.metaKey||event.shiftKey)){chooseTrack(item.id,event.shiftKey);return;}playItems(items,item.id);},"music-track-select");
    const text=el("span","music-track-copy");text.append(el("strong","",item.title),el("span","",displaySubtitle(item)));text.lastElementChild.prepend(equalizer());select.replaceChildren(el("span","music-track-number",String(position+1).padStart(2,"0")),playableCover(item),text);
    select.addEventListener("mouseenter",()=>intent.enter(item.id));select.addEventListener("mouseleave",()=>intent.leave());select.addEventListener("focus",()=>intent.enter(item.id));select.addEventListener("blur",()=>intent.leave());
    const actions=el("div","music-track-actions");
    const heart=button(t("Like this song"),null,()=>{if(!changeFavorite(item))return;syncDock();if(view==="favorites")showLocal(view);else render();});
    const liked=saved.favorites.some(value=>value.id===item.id);heart.textContent=liked?"♥":"♡";heart.setAttribute("aria-pressed",String(liked));
    const {menu,options}=trackMenu(item);
    const addToPlaylist=button(t("Add to playlist"),"plus",()=>library.picker(item),"music-icon-button music-track-add-playlist");actions.append(heart,addToPlaylist,menu);
    if(view==="playlist"&&!getPlaylist(playlistId)?.smart){
      row.classList.toggle("selected",selectedTracks.has(item.id));const checkbox=el("input","music-track-checkbox");checkbox.type="checkbox";checkbox.checked=selectedTracks.has(item.id);checkbox.setAttribute("aria-label",t("Select {title}",{title:item.title}));checkbox.addEventListener("click",event=>chooseTrack(item.id,event.shiftKey));row.append(checkbox);
      if(!listFilter&&listSort==="original"){row.draggable=true;row.addEventListener("dragstart",event=>{const ids=selectedTracks.has(item.id)?[...selectedTracks]:[item.id];event.dataTransfer.setData("application/x-devil-music-tracks",JSON.stringify({playlistId,ids}));event.dataTransfer.effectAllowed="move";});row.addEventListener("dragover",event=>{if(event.dataTransfer.types.includes("application/x-devil-music-tracks")){event.preventDefault();event.dataTransfer.dropEffect="move";row.classList.add("drop-target");}});row.addEventListener("dragleave",()=>row.classList.remove("drop-target"));row.addEventListener("drop",event=>{event.preventDefault();row.classList.remove("drop-target");try{const value=JSON.parse(event.dataTransfer.getData("application/x-devil-music-tracks"));if(value.playlistId===playlistId&&Array.isArray(value.ids))library.reorder(playlistId,value.ids,item.id);}catch{}});}
      const original=library.find(playlistId).items,offset=original.findIndex(value=>value.id===item.id);
      if(!listFilter&&listSort==="original"){
        const up=button(t("Move up"),"arrow-up",()=>library.move(playlistId,item.id,offset-1)),down=button(t("Move down"),"arrow-down",()=>library.move(playlistId,item.id,offset+1));up.disabled=offset===0;down.disabled=offset===original.length-1;options.append(up,down);
      }
      options.append(button(t("Remove from playlist"),"x-circle",()=>library.removeTrack(playlistId,item.id)));
    }
    row.append(select,actions);return row;
  }
  function skeleton() {const grid=el("div","music-card-grid");for(let i=0;i<6;i++)grid.append(el("div","music-skeleton"));$("music-shelves").replaceChildren(grid);}
  async function load(kind,value="",heading="",refresh=false) {
    rememberNavigation({type:"catalog",kind,value,heading,filter:searchFilter,mood:activeMood,item:browseItem});
    window.scrollTo({top:0});
    listFilter="";listSort="original";$("music-library-sort").value=listSort;
    const token=++request;lastQuery={kind,value,heading};selectView(kind==="browse"?"browse":kind==="search"?"search":"home");
    continuation=null;morePending=false;
    $("music-heading").textContent=heading||(kind==="search"?t("Results for “{query}”",{query:value}):t("Discover your next favorite"));
    $("music-kicker").textContent=kind==="home"?t("PRESS PLAY"):kind==="search"?t("SEARCH"):t("EXPLORE");
    loading=true;$("music-refresh").disabled=true;status(t("Finding your music…"));skeleton();
    try{
      if(!invoke)throw new Error(t("Open Deviload to browse and play music."));
      const result=kind==="home"&&saved.showRegional===false?{sections:[]}:kind==="home" && homeCache && !refresh?homeCache:await invoke("music_catalog",{kind,value,language:language(),filter:searchFilter});
      if(token!==request)return;
      if(kind==="home")homeCache=result;
      continuation=result.continuation||null;
      sections=kind==="home"?homeSections(result.sections):result.sections;status("");render();loaded=true;
      if((kind==="browse"||kind==="search"&&searchFilter==="songs")&&audio.paused){const first=tracks(sections.flatMap(section=>section.items))[0];if(first)intent.enter(first.id);}
      if(kind==="home")personalize(token,result.sections);
    }catch(error){if(token!==request)return;status(errorText(error),true);$("music-shelves").replaceChildren(button(t("Try again"),null,()=>load(kind,value,heading,true),"music-primary"));}
    finally{if(token===request){loading=false;$("music-refresh").disabled=false;}}
  }
  async function personalize(token,base) {
    captureListening();
    const seeds=tasteSeeds(taste,saved.favorites);
    const followed=(saved.collections||[]).filter(item=>item.kind==="artist"&&!taste.blockedArtists?.includes(item.title.toLocaleLowerCase()));
    const selected=[...followed].sort(()=>Math.random()-.5).slice(0,2);
    const artistResults=await Promise.allSettled(selected.map(item=>invoke("music_catalog",{kind:"browse",value:item.id,language:language()})));
    if(token!==request)return;
    const artistItems=artistResults.filter(result=>result.status==="fulfilled").flatMap(result=>result.value.sections.flatMap(section=>section.items));
    if(!seeds.length){for(const item of artistItems.filter(item=>item.kind==="song").slice(0,2))seeds.push(item);}
    if(!seeds.length){sections=homeSections(base);render();prepareHomeSelection();return;}
    const results=await Promise.allSettled(seeds.map(seed=>radio(seed)));
    if(token!==request)return;
    const candidates=[...artistItems.filter(item=>item.kind==="song"),...results.filter(result=>result.status==="fulfilled").flatMap(result=>result.value)];
    const items=recommend(candidates,taste,saved.favorites,{exclude:current?[current.id]:[],limit:18,followedArtists:followed.map(item=>item.title)});
    discoveryCandidates=items;sections=homeSections(base,items);
    const albums=artistItems.filter(item=>item.kind==="album");
    if(albums.length)sections.splice(items.length?1:0,0,{title:t("Albums from artists you follow"),items:albums.slice(0,12)});render();prepareHomeSelection();
  }
  function prepareHomeSelection(){
    if(!audio.paused)return;
    const first=current||tracks(sections.flatMap(section=>section.items))[0];
    if(first)intent.enter(first.id);
  }
  function homeSections(base,personal=[]){
    const result=[];
    if(personal.length)result.push({title:t("For you"),items:personal});
    if(saved.recent.length)result.push({title:t("Recently played"),items:saved.recent.slice(0,12)});
    if(saved.showRegional!==false)result.push(...base);
    return result;
  }
  function showLocal(kind) {
    rememberNavigation({type:"local",view:kind});
    listFilter="";$("music-library-filter").value="";
    ++request;loading=false;loaded=true;$("music-refresh").disabled=false;selectView(kind);status("");
    $("music-kicker").textContent=t("YOUR MUSIC");$("music-heading").textContent=kind==="favorites"?t("Liked songs"):t("Recently played");
    sections=[{title:"",items:kind==="favorites"?saved.favorites:saved.recent}];render();
  }
  const smartDefinitions=()=>({frequent:{name:t("On repeat"),description:t("Your most played songs with positive listening signals.")},rediscover:{name:t("Rediscover favorites"),description:t("Songs you enjoyed and have not played for at least two weeks.")},liked:{name:t("Recently liked"),description:t("Your latest likes, gathered in one place.")},discover:{name:t("New to you"),description:t("Recommendations you have not played or liked yet.")}});
  function getPlaylist(id){if(!id?.startsWith("smart:"))return library.find(id);const key=id.slice(6),definition=smartDefinitions()[key];if(!definition)return;return {id,...definition,smart:true,items:smartPlaylists(saved,taste,discoveryCandidates)[key]};}
  function renderSmartLibrary(root){const shelf=el("section","music-smart-library");shelf.append(el("h4","",t("Made from your listening")));const grid=el("div","music-smart-grid");for(const [key,definition]of Object.entries(smartDefinitions())){const list=getPlaylist("smart:"+key),tile=button(definition.name,null,()=>showPlaylist(list.id),"music-smart-tile");tile.dataset.mix=key;tile.replaceChildren(el("span","music-eyebrow",t("SMART PLAYLIST")),el("strong","",definition.name),el("small","",definition.description),el("span","",t("{count} tracks",{count:list.items.length})));grid.append(tile);}shelf.append(grid);root.append(shelf);}
  function chooseTrack(id,range){selectedTracks=selectTrackRange(selectedTracks,id,visibleTrackIds,selectionAnchor,range);if(!range)selectionAnchor=id;render();}
  document.addEventListener("keydown",event=>{if(view!=="playlist"||getPlaylist(playlistId)?.smart||document.querySelector("main").dataset.page!=="music"||document.querySelector("dialog[open]")||event.target.closest("input,textarea,select"))return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="a"){event.preventDefault();selectedTracks=new Set(visibleTrackIds);render();}else if(event.key==="Escape"&&selectedTracks.size){selectedTracks.clear();render();}});
  function showPlaylist(id){
    rememberNavigation({type:"playlist",id:id||null});
    ++request;loading=false;loaded=true;playlistId=id;listFilter="";$("music-refresh").disabled=false;
    selectedTracks.clear();selectionAnchor=null;const list=getPlaylist(id);selectView(list?"playlist":"library");status("");
    $("music-kicker").textContent=t("YOUR MUSIC");$("music-heading").textContent=list?.name||t("Your library");
    sections=list?[{title:"",items:list.items}]:[];render();
  }
  $("music-library-filter").addEventListener("input",()=>{listFilter=$("music-library-filter").value;render();});
  $("music-library-sort").addEventListener("change",()=>{listSort=$("music-library-sort").value;render();});
  $("music-search").addEventListener("submit",event=>{event.preventDefault();const query=$("music-query").value.trim();activeMood="";if(query)load("search",query);});
  document.querySelectorAll("[data-music-view]").forEach(b=>b.addEventListener("click",()=>b.dataset.musicView==="home"?load("home"):b.dataset.musicView==="library"?showPlaylist(null):showLocal(b.dataset.musicView)));
  document.querySelectorAll("[data-music-mood]").forEach(b=>b.addEventListener("click",()=>{activeMood=b.dataset.musicMood;activeMood?load("search",moods[activeMood],b.textContent):load("home");}));
  $("music-refresh").addEventListener("click",()=>view==="offline"?showOffline():["library","playlist"].includes(view)?showPlaylist(playlistId):["favorites","recent"].includes(view)?showLocal(view):load(lastQuery.kind,lastQuery.value,lastQuery.heading,true));
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
  document.addEventListener("pointerdown",event=>document.querySelectorAll(".music-track-menu[open]").forEach(menu=>{if(!menu.contains(event.target))menu.open=false;}));
  new MutationObserver(syncDock).observe(document.querySelector("main"),{attributes:true,attributeFilter:["data-page"]});
  window.addEventListener("pagehide",()=>{captureListening();persistSession();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)persistSession();});
  onLanguageChange(()=>{
    offlineTab.textContent=t("Downloaded music");offlineTab.title=t("Downloaded music");offlineTab.setAttribute("aria-label",t("Downloaded music"));
    const labels={all:"All results",songs:"Songs",albums:"Albums",artists:"Artists"};for(const node of filters.children){const label=t(labels[node.dataset.filter]);node.textContent=label;node.title=label;node.setAttribute("aria-label",label);}

    for(const [node,label]of [[like,t("Like this song")],[shuffleButton,t("Shuffle")],[previous,t("Previous track")],[next,t("Next track")],[repeatButton,t("Repeat queue")],[queueButton,t("Play queue")],[saveToPlaylist,t("Add to playlist")],[downloadButton,t("Download MP3")]]){node.title=label;node.setAttribute("aria-label",label);}
    dock.setAttribute("aria-label",t("Music player"));queuePanel.setAttribute("aria-label",t("Play queue"));seek.setAttribute("aria-label",t("Playback position"));volume.setAttribute("aria-label",t("Volume"));
    if(current&&!streamLoading)artist.textContent=displaySubtitle(current);
    if(!current){title.textContent=t("Pick your first track");artist.textContent=t("Your soundtrack starts here");}
    homeCache=null;if(loaded && document.querySelector("main").dataset.page==="music"){view==="offline"?showOffline():["library","playlist"].includes(view)?showPlaylist(playlistId):["favorites","recent"].includes(view)?showLocal(view):load(lastQuery.kind,lastQuery.value,lastQuery.heading,true);}syncDock();renderQueue();
  });
  librarySidebar=createMusicLibrarySidebar({workspace:$("devil-music"),saved,onPlaylist:showPlaylist,onFavorites:()=>showLocal("favorites"),onCreate:()=>library.create(),cover,button});
  index=queue.findIndex(item=>item.id===restored.id);current=queue[index]||null;order.reset(current?.id);
  if(current){retryPosition=restored.position;title.textContent=current.title;artist.textContent=displaySubtitle(current);artwork.replaceChildren(cover(current));elapsed.textContent=time(retryPosition);duration.textContent=time(knownDuration);seek.value=knownDuration?String(retryPosition/knownDuration*1000):"0";}
  window.__TAURI__?.event?.listen("music-control",({payload})=>{
    if(payload==="previous")previous.click();
    else if(payload==="play")play.click();
    else if(payload==="next")next.click();
  }).then(()=>syncDock()).catch(()=>{});
  return {open(){syncDock();if(!enginePrepared){enginePrepared=true;invoke?.("music_prepare",{}).catch(()=>{});}if(!loaded&&!loading)load("home");}};
}
