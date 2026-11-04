const KEY='deviload-lyrics-offsets-v1';
export function clampLyricsOffset(value){return Number.isFinite(value)?Math.round(Math.max(-10,Math.min(10,value))*5)/5:0;}
export function readLyricsOffsets(storage){
  try{const raw=storage.getItem(KEY);if(!raw||raw.length>20000)return {};const data=JSON.parse(raw);if(!Array.isArray(data))return {};return Object.fromEntries(data.slice(-100).filter(row=>Array.isArray(row)&&typeof row[0]==='string'&&row[0].length<=100&&Number.isFinite(row[1])).map(([id,value])=>[id,clampLyricsOffset(value)]));}catch{return {};}
}
export function saveLyricsOffset(storage,offsets,id,value){
  if(typeof id!=='string'||!id||id.length>100)return offsets;
  const rows=Object.entries(offsets).filter(([key])=>key!==id);rows.push([id,clampLyricsOffset(value)]);
  const bounded=rows.slice(-100);try{storage.setItem(KEY,JSON.stringify(bounded));}catch{/* Timing remains usable for this session. */}
  return Object.fromEntries(bounded);
}
