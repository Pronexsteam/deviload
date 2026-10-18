import {tracks} from "./music-state.js";
import {tasteArtistKeys} from "./music-taste.js";

const MINUTE=60000, HOUR=60*MINUTE;
const validId=id=>typeof id==="string"&&/^[\w-]{11}$/.test(id);
const time=value=>Number.isFinite(value)&&value>=0?value:Date.now();
const bounded=value=>Number.isFinite(value)?Math.max(0,Math.min(10,Math.floor(value))):2;
const clean=items=>tracks(Array.isArray(items)?items.slice(0,2000):[]);
function trim(map,now,age,limit){
  for(const [id,row]of map)if(now<row.at||now-row.at>=age)map.delete(id);
  while(map.size>limit)map.delete(map.keys().next().value);
}
function put(map,id,row){map.delete(id);map.set(id,row);}

// This is bounded, session-local recommendation state. It is intentionally not
// part of a profile or backup: impressions, failures and temporary skips are not likes.
export function createRecommendationSession(){
  let context=[],cursor=0,revision=0;
  const shown=new Map(),skips=new Map(),unavailable=new Map();
  function prune(now){trim(shown,now,6*HOUR,500);trim(skips,now,6*HOUR,200);trim(unavailable,now,90*1000,200);}
  function contextItems(){return [...context];}
  function seeds(current,globalSeeds,{limit=2}={}){
    limit=bounded(limit);if(!limit)return [];
    const selected=clean(current?[current]:[]),seen=new Set(selected.flatMap(tasteArtistKeys));
    const contextual=context.filter(item=>!selected.some(row=>row.id===item.id));
    const rotated=contextual.length?[...contextual.slice(cursor%contextual.length),...contextual.slice(0,cursor%contextual.length)]:[];
    const pools=[rotated,clean(globalSeeds)];
    // First represent a distinct artist from this listening context; fall back
    // to a same-artist source only when the context has no other artist.
    for(const pool of pools){
      for(const diverse of [true,false])for(const item of pool){
        if(selected.length>=limit)break;
        if(selected.some(row=>row.id===item.id))continue;
        const keys=tasteArtistKeys(item);
        if(diverse&&keys.some(key=>seen.has(key)))continue;
        selected.push(item);for(const key of keys)seen.add(key);
      }
    }
    cursor++;return selected.slice(0,limit);
  }
  function mergePools(pools){
    const source=(Array.isArray(pools)?pools:[]).slice(0,8).map(pool=>({...pool,items:clean(pool?.items)}));
    const items=[],byId=new Map(),scores=new Map();
    for(let index=0;items.length<2000;index++){
      let found=false;
      for(const pool of source){const item=pool.items[index];if(!item)continue;found=true;if(!byId.has(item.id)){items.push(item);byId.set(item.id,item);if(items.length===2000)break;}}
      if(!found)break;
    }
    // Preserve each upstream rank and origin rather than treating interleaving
    // position as evidence. Keep scores only for retained, bounded candidates.
    for(const pool of source)pool.items.forEach((item,index)=>{
      if(!byId.has(item.id))return;
      const contribution=(pool.contextual===true?1.4:1)/(1+index/10);
      scores.set(item.id,Math.min(3,(scores.get(item.id)||0)+contribution));
    });
    return {items,scores};
  }
  return {
    get revision(){return revision;},
    setContext(items){
      const all=clean(items),representatives=[],seen=new Set();
      for(const item of all){const keys=tasteArtistKeys(item);if(representatives.length&&keys.some(key=>seen.has(key)))continue;representatives.push(item);for(const key of keys)seen.add(key);if(representatives.length===40)break;}
      context=clean([...representatives,...all]).slice(0,40);cursor=0;revision++;
    },
    contextItems,seeds,mergePools,
    markShown(items,now=Date.now()){
      now=time(now);prune(now);
      for(const item of clean(items)){
        const old=shown.get(item.id);
        // Rendering/scrolling the same shelf repeatedly must not multiply evidence.
        if(old&&now-old.at<10*MINUTE)continue;
        put(shown,item.id,{at:now,count:Math.min(3,(old?.count||0)+1)});
      }
      prune(now);
    },
    recordSkip(item,{seconds=0,duration=0,session,intent}={},now=Date.now()){
      if(!validId(item?.id)||intent!=="next"||!Number.isSafeInteger(session)||session<0||!Number.isFinite(seconds)||seconds<2||seconds>=20||
        (Number.isFinite(duration)&&duration>0&&seconds/duration>=.2))return;
      now=time(now);prune(now);const old=skips.get(item.id);
      if(old?.session===session)return;
      put(skips,item.id,{at:now,count:Math.min(3,(old?.count||0)+1),session});prune(now);
    },
    recordListen(item,{seconds=0,duration=0}={}){
      if(validId(item?.id)&&Number.isFinite(seconds)&&(seconds>=30||Number.isFinite(duration)&&duration>0&&seconds/duration>=.8))skips.delete(item.id);
    },
    fail(id,now=Date.now()){if(!validId(id))return;now=time(now);put(unavailable,id,{at:now});prune(now);},
    recover(id){unavailable.delete(id);},
    forgetTrack(id){shown.delete(id);skips.delete(id);unavailable.delete(id);},
    allowed(items,now=Date.now()){
      now=time(now);prune(now);
      const all=clean(items),available=all.filter(item=>!unavailable.has(item.id));
      // Repeated skips temporarily pause this recording, including a saved like.
      // They never mutate that like or create an artist-wide exclusion.
      return available.filter(item=>{const row=skips.get(item.id);return !row||row.count<2||now-row.at>=20*MINUTE;});
    },
    options(now=Date.now()){
      now=time(now);prune(now);const itemAdjustments=new Map();
      for(const [id,row]of shown)itemAdjustments.set(id,-Math.min(3,row.count*1.5)*Math.exp(-(now-row.at)/HOUR));
      for(const [id,row]of skips)itemAdjustments.set(id,Math.max(-6,(itemAdjustments.get(id)||0)-row.count*2*Math.exp(-(now-row.at)/(2*HOUR))));
      return {itemAdjustments};
    },
    reset(){context=[];cursor=0;shown.clear();skips.clear();unavailable.clear();revision++;}
  };
}
