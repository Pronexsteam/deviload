import {tracks} from "./music-state.js";

// Equal turns prevent one upstream seed from occupying every tied position.
// This merges candidates only; local taste and diversity decide their ranking.
export function mergeRecommendationPools(pools,limit=2000){
  const lists=pools.filter(Array.isArray).slice(0,8).map(items=>tracks(items).slice(0,2000));
  const result=[],seen=new Set();limit=Number.isFinite(limit)?Math.max(0,Math.min(2000,Math.floor(limit))):2000;
  for(let offset=0;result.length<limit&&lists.some(items=>offset<items.length);offset++){
    for(const items of lists){const item=items[offset];if(item&&!seen.has(item.id)){seen.add(item.id);result.push(item);if(result.length===limit)break;}}
  }
  return result;
}

export function recommendationLabel(reason,t=(text,params={})=>text.replace(/\{(\w+)\}/g,(_,key)=>params[key]??`{${key}}`)){
  switch(reason?.code){
    case "liked":return t("From your liked songs");
    case "followed_artist":return reason.artist?t("You follow {artist}",{artist:reason.artist}):t("From artists you follow");
    case "related_artist":return reason.artist?t("More from {artist}",{artist:reason.artist}):t("From your listening history");
    case "listening_history":return t("From your listening history");
    case "discovery":return t("An artist new to your listening");
    default:return t("From this station");
  }
}
