// A playback snapshot, independent of the current library filters and sorting.
export function createCinemaQueue() {
  let items=[], index=-1, generation=0;
  return {
    get items(){return items;}, get index(){return index;}, get current(){return items[index]||null;},
    replace(entries, selected=0){items=entries.map(entry=>({...entry,status:entry.unavailable?"unavailable":"ready"}));index=Math.min(Math.max(0,selected),items.length-1);return ++generation;},
    append(entries){items.push(...entries.map(entry=>({...entry,status:entry.unavailable?"unavailable":"ready"})));},
    select(position){if(position<0||position>=items.length)return null;index=position;return ++generation;},
    invalidate(){return ++generation;}, valid(token){return token===generation;},
    next(direction=1){if(direction!==1&&direction!==-1)return -1;for(let i=index+direction;i>=0&&i<items.length;i+=direction)if(!["unavailable","error"].includes(items[i].status))return i;return -1;},
  };
}

export function localCinemaEntries(jobs, ids) {
  const map=new Map(jobs.map(job=>[job.id,job]));
  return ids.map((id,index)=>{const job=map.get(id);return {kind:"local-job",id,index:index+1,title:job?.file?.split(/[\\/]/).pop()||String(id),file:job?.file||"",unavailable:!job||job.status!=="done"};});
}

export function localCinemaOrder(jobs, visibleIds, selectedId) {
  const selected=jobs.find(job=>job.id===selectedId),parentId=selected?.libraryParent||selectedId;
  const parent=jobs.find(job=>job.id===parentId),visible=new Set(visibleIds);visible.add(selectedId);
  if((parent?.downloads?.length||0)>1){
    // The parent can represent the LAST downloaded file with the oldest ID.
    // Use its recorded download order, not child IDs or completion timestamps.
    const order=new Map();for(const [,file]of parent.downloads)if(!order.has(file))order.set(file,order.size);
    return jobs.filter(job=>visible.has(job.id)&&(job.id===parentId||job.libraryParent===parentId))
      .sort((a,b)=>(order.get(a.file)??Infinity)-(order.get(b.file)??Infinity)||a.id-b.id).map(job=>job.id);
  }
  return visibleIds.includes(selectedId)?[...visibleIds]:[selectedId,...visibleIds];
}
