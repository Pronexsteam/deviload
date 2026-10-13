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
  storage?.setItem(KEY,JSON.stringify({...value,queue:tracks(value.queue).slice(0,200).map(sanitizeMusicTrack)}));
}

// Peeking does not consume a song: preloading and Next use the same choice.
export function createPlaybackOrder(random=Math.random){
  let seen=new Set(),history=[],cursor=-1;
  return {
    reset(id){seen=new Set();history=[];cursor=-1;if(id){seen.add(id);history.push(id);cursor=0;}},
    visit(id,queue){
      if(history[cursor]===id)return;
      if(history[cursor+1]===id){cursor++;return;}
      if(queue.length&&queue.every(item=>seen.has(item.id)))seen.clear();
      seen.add(id);history=history.slice(0,cursor+1);history.push(id);
      if(history.length>200)history.shift();cursor=history.length-1;
    },
    previous(queue){
      while(cursor>0){const id=history[--cursor];if(queue.some(item=>item.id===id))return id;}
      return null;
    },
    next(queue,index,repeat,shuffle){
      const forward=history.slice(cursor+1).find(id=>queue.some(item=>item.id===id));
      if(forward)return queue.findIndex(item=>item.id===forward);
      if(!shuffle)return index+1<queue.length?index+1:repeat&&queue.length?0:-1;
      let candidates=queue.filter(item=>!seen.has(item.id)&&item.id!==queue[index]?.id);
      if(!candidates.length&&repeat)candidates=queue.filter(item=>item.id!==queue[index]?.id);
      if(!candidates.length)return repeat&&queue.length===1?0:-1;
      const id=candidates[Math.min(candidates.length-1,Math.floor(random()*candidates.length))].id;
      return queue.findIndex(item=>item.id===id);
    }
  };
}
