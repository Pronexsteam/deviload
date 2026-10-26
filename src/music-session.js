import {tracks} from "./music-state.js";
import {sanitizeMusicTrack} from "./music-profile.js";

const KEY="deviload-music-session-v1";
export function readMusicSession(storage){
  const empty={queue:[],id:null,position:0,duration:0,repeat:"off",shuffle:false,autoplay:true};
  try{
    const raw=storage?.getItem(KEY);if(!raw||raw.length>400000)return empty;
    const value=JSON.parse(raw);
    const queue=tracks(value.queue).slice(0,200).map(sanitizeMusicTrack);
    return {queue,id:queue.some(item=>item.id===value.id)?value.id:null,
      position:Number.isFinite(value.position)?Math.max(0,Math.min(86400,value.position)):0,
      duration:Number.isFinite(value.duration)?Math.max(0,Math.min(86400,value.duration)):0,
      repeat:["off","all","one"].includes(value.repeat)?value.repeat:"off",shuffle:value.shuffle===true,autoplay:value.autoplay!==false};
  }catch{return empty;}
}
export function saveMusicSession(storage,value){
  const all=tracks(value.queue),position=all.findIndex(item=>item.id===value.id);
  const start=Math.max(0,Math.min(position,all.length-200));
  storage?.setItem(KEY,JSON.stringify({...value,queue:all.slice(start,start+200).map(sanitizeMusicTrack)}));
}

// Peeking does not consume a song: preloading and Next use the same choice.
export function createPlaybackOrder(random=Math.random,sourceKey=item=>item.id){
  let seen=new Set(),history=[],cursor=-1,choice=null,planned=[];
  const key=item=>sourceKey(item)||item.id;
  return {
    reset(id){seen=new Set();history=[];cursor=-1;choice=null;planned=[];if(id){history.push(id);cursor=0;}},
    plan(ids){planned=[...new Set(ids)];choice=null;},
    preview(queue,index,repeat,shuffle,limit=32){
      const next=this.next(queue,index,repeat,shuffle);if(next<0)return [];
      if(!shuffle){const items=queue.slice(next,next+limit);return items;}
      const first=queue[next],currentKey=queue[index]?key(queue[index]):null;
      const candidates=[...new Map(queue.map(item=>[key(item),item])).values()].filter(item=>key(item)!==currentKey&&(choice?.cycle||!seen.has(key(item))));
      const byId=new Map(candidates.map(item=>[item.id,item])),used=new Set([key(first)]),result=[first];
      for(const id of planned){const item=byId.get(id);if(item&&!used.has(key(item))&&result.length<limit){result.push(item);used.add(key(item));}}
      const rest=candidates.filter(item=>!used.has(key(item)));
      while(rest.length&&result.length<limit){const draw=Number(random()),offset=Number.isFinite(draw)?Math.max(0,Math.min(rest.length-1,Math.floor(draw*rest.length))):0;result.push(rest.splice(offset,1)[0]);}
      planned=result.map(item=>item.id);return result;
    },
    visit(id,queue){
      const item=queue.find(item=>item.id===id),previous=queue.find(item=>item.id===history[cursor]);
      if(choice?.cycle&&choice.id===id){seen.clear();if(previous)seen.add(key(previous));}
      choice=null;
      planned=planned.filter(value=>value!==id);
      if(item)seen.add(key(item));
      if(history[cursor]===id)return;
      if(history[cursor+1]===id){cursor++;return;}
      history=history.slice(0,cursor+1);history.push(id);
      if(history.length>200)history.shift();cursor=history.length-1;
    },
    previous(queue){
      choice=null;
      while(cursor>0){const id=history[--cursor];if(queue.some(item=>item.id===id))return id;}
      return null;
    },
    next(queue,index,repeat,shuffle){
      const current=queue[index],currentKey=current?key(current):null;
      if(current)seen.add(currentKey);
      const forward=history.slice(cursor+1).find(id=>id!==current?.id&&queue.some(item=>item.id===id&&(!shuffle||key(item)!==currentKey)));
      if(forward)return queue.findIndex(item=>item.id===forward);
      if(!shuffle)return index+1<queue.length?index+1:repeat&&queue.length?0:-1;
      const unique=[...new Map(queue.map(item=>[key(item),item])).values()];
      let candidates=unique.filter(item=>!seen.has(key(item))&&key(item)!==currentKey),cycle=false;
      if(!candidates.length&&repeat){candidates=unique.filter(item=>key(item)!==currentKey);cycle=true;}
      if(!candidates.length)return repeat&&queue.length===1?0:-1;
      const signature=JSON.stringify([currentKey,repeat,candidates.map(item=>[item.id,key(item)])]);
      if(choice?.signature!==signature){
        const draw=Number(random()),offset=Number.isFinite(draw)?Math.max(0,Math.min(candidates.length-1,Math.floor(draw*candidates.length))):0;
        const reserved=planned.find(id=>candidates.some(item=>item.id===id));
        choice={signature,id:reserved||candidates[offset].id,cycle};
      }
      const id=choice.id;
      return queue.findIndex(item=>item.id===id);
    }
  };
}
