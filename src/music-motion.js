const decorativeMedia=new WeakSet();
export const isMotionCover=node=>!!node&&decorativeMedia.has(node)&&node.muted;
// Muted picture beside the song (a moving cover or a music video) never takes over from the music.
export const markDecorative=node=>{decorativeMedia.add(node);return node;};
export function createMotionCover({invoke,convertFileSrc,host,getHost=()=>host,isVisible,isPlaying,onAvailable=()=>{}}){
  const cache=new Map(),pending=new Map(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let track=null,key='',serial=0,video=null,enabled=true,disposed=false;
  function clear(){if(video){video.pause();video.removeAttribute('src');video.load();video.remove();video=null;}}
  function sync(){
    if(!video)return;
    if(!enabled||document.hidden||reduced.matches||!isVisible()){clear();return;}
    const target=getHost();if(!target.contains(video))target.append(video);
    if(isPlaying()){if(video.paused)video.play().catch(()=>{});}else video.pause();
  }
  async function update(item){
    track=item;const next=JSON.stringify([item?.id,item?.title,item?.artists,item?.album]);
    if(next!==key){key=next;serial++;clear();onAvailable(false);}
    if(!item||!enabled||document.hidden||reduced.matches||!isVisible()){serial++;clear();return;}
    if(video){sync();return;}
    const token=++serial,album=typeof item.album==='string'?item.album:item.album?.title||item.album?.name||'';
    if(!cache.has(key)&&!pending.has(key)){
      const requestKey=key;
      pending.set(key,Promise.resolve().then(()=>invoke('music_motion',{title:item.title,artist:item.artists?.join(', ')||'',album})).catch(()=>null).then(path=>{
        if(cache.size>=24)cache.delete(cache.keys().next().value);cache.set(requestKey,path);return path;
      }).finally(()=>pending.delete(requestKey)));
    }
    const path=cache.has(key)?cache.get(key):await pending.get(key);
    if(disposed||token!==serial||!path||!isVisible()||document.hidden||!enabled||reduced.matches)return;
    video=document.createElement('video');decorativeMedia.add(video);video.className='music-motion-cover';video.muted=true;video.loop=true;video.playsInline=true;video.preload='metadata';video.setAttribute('aria-hidden','true');
    const node=video;node.addEventListener('loadeddata',()=>{if(video===node){node.classList.add('is-ready');onAvailable(true);}});
    node.addEventListener('error',()=>{if(video===node){cache.set(key,null);clear();onAvailable(false);}});
    node.src=convertFileSrc(path);getHost().append(node);sync();
  }
  const visibility=()=>update(track);document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',visibility);
  return {update,sync,stop(){serial++;clear();},setEnabled(value){enabled=value;update(track);},dispose(){disposed=true;serial++;clear();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',visibility);}};
}
