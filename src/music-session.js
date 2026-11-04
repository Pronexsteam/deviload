import {tracks} from "./music-state.js";
import {sanitizeMusicTrack} from "./music-profile.js";

const KEY="deviload-music-session-v1";
let sessionTracks=new WeakMap();
export function readMusicSession(storage){
  const empty={queue:[],id:null,position:0,duration:0,repeat:"off",shuffle:false,autoplay:true};
  try{
    const raw=storage?.getItem(KEY);if(!raw)return empty;
    const value=JSON.parse(raw);
    const queue=tracks(value.queue).map(sanitizeMusicTrack);
    return {queue,id:queue.some(item=>item.id===value.id)?value.id:null,
      position:Number.isFinite(value.position)?Math.max(0,Math.min(86400,value.position)):0,
      duration:Number.isFinite(value.duration)?Math.max(0,Math.min(86400,value.duration)):0,
      repeat:["off","all","one"].includes(value.repeat)?value.repeat:"off",shuffle:value.shuffle===true,autoplay:value.autoplay!==false,order:value.order};
  }catch{return empty;}
}
export function saveMusicSession(storage,value){
  const nextCache=new WeakMap();
  const queue=tracks(value.queue).map(item=>{
    // Metadata changes invalidate the cached sanitized copy. Expiring stream URLs
    // are neither part of this fingerprint nor part of the persisted track.
    let signature;try{signature=JSON.stringify([item.id,item.title,item.subtitle,item.artists,item.image,item.album,item.duration]);}catch{return sanitizeMusicTrack(item);}
    const cached=sessionTracks.get(item),entry=cached?.signature===signature?cached:{signature,value:sanitizeMusicTrack(item)};
    nextCache.set(item,entry);return entry.value;
  });
  storage?.setItem(KEY,JSON.stringify({...value,queue}));sessionTracks=nextCache;
}

// Peeking does not consume a song: preloading and Next use the same choice.
export function createPlaybackOrder(random=Math.random,sourceKey=item=>item.id){
  let seen=new Set(),history=[],cursor=-1,choice=null,planned=[],priority=[],overrideHistory=false;
  const key=item=>sourceKey(item)||item.id;
  return {
    reset(id,preservePriority=false){seen=new Set();history=[];cursor=-1;choice=null;planned=[];overrideHistory=false;if(!preservePriority)priority=[];if(id){history.push(id);cursor=0;}},
    enqueue(id){priority=[id,...priority.filter(value=>value!==id)];choice=null;overrideHistory=true;},
    sequential(){priority=[];planned=[];choice=null;overrideHistory=false;history=history.slice(0,cursor+1);},
    plan(ids){const ordered=[...new Set(ids)],included=new Set(ordered);planned=[...ordered,...planned.filter(id=>!included.has(id))];priority=[...ordered,...priority.filter(id=>!included.has(id))];choice=null;overrideHistory=true;},
    snapshot(queue){
      const ids=new Set(queue.map(item=>item.id)),keys=new Set(queue.map(key));
      return {seen:[...seen].filter(value=>keys.has(value)),history:[...history],cursor,
        planned:[...new Set([...(choice?[choice.id]:[]),...planned])].filter(id=>ids.has(id)),priority:priority.filter(id=>ids.has(id)),overrideHistory};
    },
    restore(state,queue,currentId){
      this.reset(currentId);if(!state||typeof state!=="object")return;
      const ids=new Set(queue.map(item=>item.id)),keys=new Set(queue.map(key)),clean=(list,allowed)=>Array.isArray(list)?[...new Set(list.filter(id=>typeof id==="string"&&allowed.has(id)))]:[];
      seen=new Set(clean(state.seen,keys));planned=clean(state.planned,ids);priority=clean(state.priority,ids).filter(id=>id!==currentId);overrideHistory=state.overrideHistory===true;
      if(Array.isArray(state.history)&&state.history.length<=200&&state.history.every(id=>typeof id==="string"&&ids.has(id))&&Number.isInteger(state.cursor)&&state.cursor>=0&&state.cursor<state.history.length&&state.history[state.cursor]===currentId){history=[...state.history];cursor=state.cursor;}
    },
    preview(queue,index,repeat,shuffle,limit=32){
      const next=this.next(queue,index,repeat,shuffle);if(next<0)return [];
      if(!shuffle){const items=queue.slice(next,next+limit);return items;}
      const first=queue[next],currentKey=queue[index]?key(queue[index]):null;
      const forward=history.slice(cursor+1),reserved=new Set([...priority,...forward]);
      const candidates=[...new Map(queue.map(item=>[key(item),item])).values()].filter(item=>key(item)!==currentKey&&(reserved.has(item.id)||choice?.cycle||!seen.has(key(item))));
      const byId=new Map(candidates.map(item=>[item.id,item])),used=new Set([key(first)]),result=[first];
      const reservedOrder=overrideHistory?[...priority,...forward]:[...forward,...priority];
      for(const id of [...reservedOrder,...planned]){if(result.length>=limit)break;const item=byId.get(id);if(item&&!used.has(key(item))){result.push(item);used.add(key(item));}}
      const rest=candidates.filter(item=>!used.has(key(item)));
      // Partial Fisher-Yates: drawing a full queue stays linear instead of
      // shifting thousands of remaining entries after every random selection.
      while(rest.length&&result.length<limit){const draw=Number(random()),offset=Number.isFinite(draw)?Math.max(0,Math.min(rest.length-1,Math.floor(draw*rest.length))):0;result.push(rest[offset]);rest[offset]=rest[rest.length-1];rest.pop();}
      const visible=result.map(item=>item.id),visibleIds=new Set(visible);
      planned=[...visible,...planned.filter(id=>!visibleIds.has(id)&&byId.has(id))];return result;
    },
    visit(id,queue){
      const item=queue.find(item=>item.id===id),previous=queue.find(item=>item.id===history[cursor]);
      if(choice?.cycle&&choice.id===id){seen.clear();if(previous)seen.add(key(previous));}
      choice=null;overrideHistory=false;
      planned=planned.filter(value=>value!==id);priority=priority.filter(value=>value!==id);
      if(item)seen.add(key(item));
      if(history[cursor]===id)return;
      if(history[cursor+1]===id){cursor++;return;}
      history=history.slice(0,cursor+1);history.push(id);
      if(history.length>200)history.shift();cursor=history.length-1;
    },
    previous(queue){
      choice=null;overrideHistory=false;
      while(cursor>0){const id=history[--cursor];if(queue.some(item=>item.id===id))return id;}
      return null;
    },
    next(queue,index,repeat,shuffle){
      const current=queue[index],currentKey=current?key(current):null;
      if(current)seen.add(currentKey);
      if(!shuffle&&!priority.length&&cursor>=history.length-1)return index+1<queue.length?index+1:repeat&&queue.length?0:-1;
      const positions=new Map(queue.map((item,position)=>[item.id,position]));
      let urgent=-1;for(const id of priority){const position=positions.get(id);if(position!==undefined&&key(queue[position])!==currentKey){urgent=position;break;}}
      if(overrideHistory&&urgent>=0){choice=null;return urgent;}
      const forward=history.slice(cursor+1).find(id=>id!==current?.id&&positions.has(id)&&(!shuffle||key(queue[positions.get(id)])!==currentKey));
      if(forward)return positions.get(forward);
      if(urgent>=0){choice=null;return urgent;}
      if(!shuffle)return index+1<queue.length?index+1:repeat&&queue.length?0:-1;
      const unique=[...new Map(queue.map(item=>[key(item),item])).values()];
      let candidates=unique.filter(item=>!seen.has(key(item))&&key(item)!==currentKey),cycle=false;
      if(!candidates.length&&repeat){candidates=unique.filter(item=>key(item)!==currentKey);cycle=true;}
      if(!candidates.length)return repeat&&queue.length===1?0:-1;
      const signature=JSON.stringify([currentKey,repeat,candidates.map(item=>[item.id,key(item)])]);
      if(choice?.signature!==signature){
        const draw=Number(random()),offset=Number.isFinite(draw)?Math.max(0,Math.min(candidates.length-1,Math.floor(draw*candidates.length))):0;
        const candidateIds=new Set(candidates.map(item=>item.id));
        const reserved=planned.find(id=>candidateIds.has(id));
        choice={signature,id:reserved||candidates[offset].id,cycle};
      }
      const id=choice.id;
      return positions.get(id)??-1;
    }
  };
}
