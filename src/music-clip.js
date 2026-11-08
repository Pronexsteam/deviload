import {isLocalMusicId} from './music-track-id.js';
import {markDecorative} from './music-motion.js';

const plain=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const compact=value=>plain(value).replace(/ /g,'');
const phrase=words=>new RegExp('(?<![\p{L}\p{N}])('+words.join('|')+')(?![\p{L}\p{N}])','iu');
// Uploads that are never the song's video, whoever posts them.
const NOT_VIDEO=phrase(['lyrics?','letras?','paroles','testo','\u043f\u0435\u0440\u0435\u0432\u043e\u0434','\u0442\u0435\u043a\u0441\u0442','karaoke','instrumental','reaction','tutorial','lesson','slowed','sped up','speed up','nightcore','8d','fan ?made','remix','mashup','parody','ai cover','official audio','audio only','audio oficial','bass ?boosted','boosted','reverb','daycore','1 hour','10 hours','loop','\d+ ?hz']);
// Another performance of the song: fine only when the song is that performance itself.
const OTHER_TAKE=phrase(['cover','acoustic','unplugged','live','en vivo','ao vivo','concert','session']);
// The picture follows the song's own clock, so the video must be the same recording: an end card may add a
// little, but a much longer video has an intro or another edit and would run out of step.
const LONGER_BY=20,SHORTER_BY=5,QUALITY_KEY='deviload-music-clip-quality',USED_KEY='deviload-music-clip-used';
const FOUND_KEY='deviload-music-clip-ids',FOUND_LIMIT=300,CLIP_ID=/^[A-Za-z0-9_-]{11}$/;
const channelOf=name=>compact(name).replace(/(vevo|official|oficial|officiel|music|tv|channel)$/,'').replace(/^official/,'');
const secondsIn=text=>{const m=String(text||'').match(/(?:^|\D)(?:(\d+):)?(\d{1,2}):(\d{2})(?:\D|$)/);return m?Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]):0;};

// The song's music video from a video search: the artist's own upload of exactly this song, or none at all.
export function pickClip(song,items){
  const title=compact(song?.title),artists=(song?.artists||[]).map(compact).filter(Boolean),songWords=String(song?.title||'');
  if(!title||!artists.length)return null;
  const length=Number(song?.duration)||0;
  const marked=(pattern,text)=>pattern.test(text)&&!pattern.test(songWords);
  return items.find(item=>{
    if(!item?.id||item.kind!=='song')return false;
    const words=String(item.title||'');if(marked(NOT_VIDEO,words)||marked(OTHER_TAKE,words))return false;
    const channels=[...(item.artists||[]),String(item.subtitle||'').split(/\s+[\u2022\u00b7|-]\s+/)[0]].map(channelOf).filter(Boolean);
    if(!channels.some(channel=>artists.includes(channel)))return false;
    let core=compact(words);for(const name of [...artists,...channels])core=core.split(name).join('');
    if(core.replace(/^(official|musicvideo|video)+|(officialmusicvideo|officialvideo|musicvideo|video|official|hd|4k)+$/g,'')!==title)return false;
    const seconds=Number(item.duration)||secondsIn(item.subtitle);
    return !length||!seconds||seconds-length<=LONGER_BY&&length-seconds<=SHORTER_BY;
  })||null;
}

// Plays the song's music video, muted, and keeps it in step with the audio.
export function createMusicClip({invoke,language,getItem=()=>null,getHost,isVisible,getAudio,audios=[],onState=()=>{},onBuffering=()=>{},storage=globalThis.localStorage}){
  let enabled=false,quality=720;
  let returning=false;
  try{quality=Number(storage?.getItem(QUALITY_KEY))||720;returning=storage?.getItem(USED_KEY)==='1';}catch{}
  // Someone who watches music videos gets the engine's video session ready shortly after start.
  if(returning)setTimeout(()=>invoke('music_clip_stream',{id:null,warm:true}).catch(()=>{}),5000);
  let track=null,key='',serial=0,video=null,ready=false,loading=false,settled='',streaming=false,retried='';
  let offer={height:0,heights:[]},jumpAt=0,cost=1.2,shown=false,used=false,warm=0,warmFor='';
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  // Waiting for picture that should be moving: the stage shows its buffering ring meanwhile.
  let buffering=false;
  function pulse(){
    const audio=getAudio(),busy=enabled&&(loading||!!video&&(!shown||!audio?.paused&&(video.seeking||video.readyState<3)));
    if(busy!==buffering){buffering=busy;onBuffering(busy);}
  }
  const report=state=>{if(state.missing||state.failed)dropOutgoing();onState({...state,quality,offer});pulse();};
  const found=new Map();
  // The music engine streams the video like the audio; the video player's source is the reserve.
  async function source(id,token){
    try{const result=await invoke('music_clip_stream',{id,height:quality});if(result?.url){streaming=true;return result;}}catch{}
    if(token!==serial)return null;
    const reserve=()=>invoke('cinema_stream',{id,quality});
    const result=await reserve().catch(async()=>{await pause(1500);return token===serial?reserve():null;});
    return result&&{url:result.url,height:result.height,heights:result.qualities};
  }
  function stop(){if(streaming){streaming=false;invoke('music_clip_stream',{id:null}).catch(()=>{});}}
  // The picture being replaced either fades to the cover (another song) or holds its last frame until the
  // new one is in place (another quality of the same video).
  let outgoing=null;
  function release(node){node.pause();node.removeAttribute('src');node.load();node.remove();}
  function dropOutgoing(){if(outgoing){release(outgoing);outgoing=null;}}
  function handOver(){if(!outgoing)return;const old=outgoing;outgoing=null;old.classList.add('is-leaving');setTimeout(()=>release(old),700);}
  function clear(mode){
    ready=false;loading=false;jumpAt=0;shown=false;
    if(video){
      const node=video;video=null;dropOutgoing();
      if(mode&&enabled&&node.classList.contains('is-ready')){node.pause();outgoing=node;if(mode==='fade')handOver();}else release(node);
    }else if(!mode)dropOutgoing();
    report({enabled,ready:false,loading:false});
  }
  // Fill the stage when the shapes are close; otherwise show the whole picture.
  function fit(){
    const host=getHost(),shape=video?.videoWidth/video?.videoHeight,room=host?.clientWidth/host?.clientHeight;
    if(shape>0&&room>0)video.style.objectFit=Math.abs(Math.log(shape/room))<.3?'cover':'contain';
  }
  addEventListener('resize',()=>{if(video&&ready)fit();});
  // A jump lands a little ahead of the song, by about as long as the last jump took to load.
  const held=(node,at)=>{for(let i=0;i<node.buffered.length;i++)if(node.buffered.start(i)<=at&&at<node.buffered.end(i)-1)return true;return false;};
  function jump(to){jumpAt=performance.now();video.currentTime=Math.max(0,Math.min(to,(video.duration||to)-.05));}
  function align(force=false){try{follow(force);}finally{pulse();}}
  function follow(force){
    // A lookup that could not start (hidden stage, no track yet) starts once the video has somewhere to show.
    if(enabled&&!video&&!loading&&key&&settled!==key&&isVisible()){update(track);return;}
    const audio=getAudio();if(!video||!ready||!audio)return;
    const host=getHost();if(!host.contains(video))host.append(video);
    if(!isVisible()||document.hidden){if(!video.paused)video.pause();return;}
    const rate=audio.playbackRate||1,target=Math.min(audio.currentTime,Math.max(0,(video.duration||audio.currentTime)-.05)),drift=video.currentTime-target;
    // While the picture loads after a jump it is left alone; jumping again would only restart the load.
    if(!force&&(video.seeking||jumpAt&&video.readyState<3))return;
    // The cover stays until the picture is actually there and in step, so no frozen frame shows while it loads.
    if(!shown&&!force&&video.readyState>=3&&Math.abs(drift)<.35){shown=true;video.classList.add('is-ready');handOver();report({enabled,ready:true,loading:false});}
    if(audio.paused){if(!video.paused)video.pause();if(force)jump(target);return;}
    if(force||drift<-.6||drift>4){jump(target+(held(video,target)?0:Math.min(3,Math.max(.25,cost))*rate));return;}
    // Slightly ahead: the picture waits for the song. Close: it runs a touch faster or slower until they meet.
    if(drift>.6){if(!video.paused)video.pause();return;}
    video.playbackRate=Math.abs(drift)>.06?rate*(drift>0?.95:1.05):rate;
    if(video.paused)video.play().catch(()=>{});
  }
  // Found videos are shared with the mini player's window and kept across restarts; misses stay in this window only.
  const shared=()=>{try{const value=JSON.parse(storage?.getItem(FOUND_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}};
  function remember(song,id){
    if(!CLIP_ID.test(id||''))return;
    try{const map=shared();delete map[song];map[song]=id;const keys=Object.keys(map);for(const key of keys.slice(0,Math.max(0,keys.length-FOUND_LIMIT)))delete map[key];storage?.setItem(FOUND_KEY,JSON.stringify(map));}catch{}
  }
  async function lookup(item){
    if(found.has(item.id))return found.get(item.id);
    const known=shared()[item.id];
    if(CLIP_ID.test(known||'')){found.set(item.id,known);return known;}
    const query=[item.artists?.[0]||'',item.title].join(' ').trim();
    const result=await invoke('music_catalog',{kind:'search',value:query,filter:'videos',language:language()});
    const id=pickClip(item,(result?.sections||[]).flatMap(section=>section.items||[]))?.id||null;
    found.set(item.id,id);if(found.size>100)found.delete(found.keys().next().value);remember(item.id,id);
    return id;
  }
  async function update(item){
    track=item;
    const next=item?.id||'';
    if(next!==key){key=next;serial++;clear('fade');}
    if(!enabled||!item||isLocalMusicId(item.id)){serial++;clear();if(enabled||item?.id!==warmFor)stop();if(used&&item&&!isLocalMusicId(item.id))lookup(item).catch(()=>{});return;}
    if(video){align();return;}
    if(loading||!isVisible())return;
    const token=++serial;loading=true;report({enabled,ready:false,loading:true});
    try{
      const id=await lookup(item);
      if(token!==serial)return;
      if(!id){settled=key;loading=false;report({enabled,ready:false,loading:false,missing:true});return;}
      const stream=await source(id,token);
      if(token!==serial||!enabled||!stream)return;
      offer={height:Number(stream.height)||0,heights:(stream.heights||[]).map(Number).filter(Boolean)};
      const node=markDecorative(document.createElement('video'));node.className='music-clip-video';node.muted=true;node.playsInline=true;node.preload='auto';node.setAttribute('aria-hidden','true');
      node.addEventListener('loadeddata',()=>{if(video!==node)return;ready=true;fit();align(true);});
      for(const name of ['waiting','playing','seeking'])node.addEventListener(name,()=>{if(video===node)pulse();});
      node.addEventListener('canplay',()=>{if(video!==node||!jumpAt)return;cost=cost*.5+(performance.now()-jumpAt)/2000;jumpAt=0;align();});
      // A broken stream is tried once more before the stage says so; the video itself is still the right one.
      node.addEventListener('error',()=>{if(video!==node)return;stop();clear();if(retried!==key){retried=key;settled='';update(track);return;}settled=key;report({enabled,ready:false,loading:false,failed:true});});
      video=node;settled=key;loading=false;node.src=stream.url;getHost().append(node);
    }catch{
      if(token===serial){settled=key;loading=false;report({enabled,ready:false,loading:false,missing:true});}
    }
  }
  for(const audio of audios)for(const name of ['play','pause','seeked','ratechange','timeupdate'])audio.addEventListener(name,event=>{if(event.target===getAudio())align(name==='seeked');});
  document.addEventListener('visibilitychange',()=>align());
  return {
    get enabled(){return enabled;},
    update,align,
    toggle(){enabled=!enabled;if(!used){used=true;try{storage?.setItem(USED_KEY,'1');}catch{}}if(!enabled){serial++;clear();stop();}else{settled='';update(getItem()||track);}report({enabled,ready,loading});},
    // A hand on the switch: find the video and let the engine start on it, so a click shows it sooner.
    prepare(item=getItem()){
      if(enabled||!item?.id||isLocalMusicId(item.id))return;
      clearTimeout(warm);warmFor=item.id;
      lookup(item).then(id=>{if(!id||enabled)return;return invoke('music_clip_stream',{id,height:quality}).then(result=>{if(!result?.url)return;streaming=true;warm=setTimeout(()=>{if(!enabled){warmFor='';stop();}},15000);});}).catch(()=>{});
    },
    // Another quality reloads the same video at the song's position.
    setQuality(height){
      if(!Number.isFinite(height)||height===quality)return;quality=height;
      try{storage?.setItem(QUALITY_KEY,String(height));}catch{}
      if(enabled&&track){serial++;clear('hold');stop();settled='';retried='';update(track);}
    }
  };
}
