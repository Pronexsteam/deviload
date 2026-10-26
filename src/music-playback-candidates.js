// Manual choices are never filtered by recommendation feedback. Only inspect
// automatic entries, and batch alias checks without the session's 2,000 cap
// silently excluding songs near the end of a long queue.
export function playbackCandidates(queue,{automatic,currentId,hidden=[],blocked=[],family=id=>[id],source=item=>item,artistKey=name=>name,allowed=items=>items}){
 if(!automatic.size)return queue;
 const candidates=queue.filter(item=>automatic.has(item.id)&&item.id!==currentId);
 if(!candidates.length)return queue;
 const hiddenIds=new Set(hidden),blockedArtists=new Set(blocked.map(artistKey)),families=new Map(),probes=new Map();
 for(const item of candidates){const ids=family(item.id);families.set(item.id,ids);for(const id of ids)if(!probes.has(id))probes.set(id,id===item.id?item:{...item,id});}
 const values=[...probes.values()],permitted=new Set();
 for(let start=0;start<values.length;start+=2000)for(const item of allowed(values.slice(start,start+2000)))permitted.add(item.id);
 const rejected=new Set();
 for(const item of candidates)if(!families.get(item.id).every(id=>permitted.has(id)&&!hiddenIds.has(id))||
  blockedArtists.size&&[...(item.artists||[]),...(source(item)?.artists||[])].some(name=>blockedArtists.has(artistKey(name))))rejected.add(item.id);
 return rejected.size?queue.filter(item=>!rejected.has(item.id)):queue;
}
