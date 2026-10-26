// Cinema metadata only. Never store signed stream URLs, credentials or music taste.
const KEY='deviload-cinema-discovery-v1';
export function cinemaHistoryRows(rows){
 const seen=new Set();
 return (Array.isArray(rows)?rows:[]).filter(item=>item&&/^[\w-]{11}$/.test(item.id)&&typeof item.title==='string'&&item.title.trim()&&!item.unavailable&&!seen.has(item.id)&&seen.add(item.id)).slice(0,20).map(item=>({id:item.id,title:item.title.slice(0,300),channel:typeof item.channel==='string'?item.channel.slice(0,160):'',duration:Number.isFinite(item.duration)&&item.duration>=0?item.duration:null,kind:'online-video'}));
}
export function createCinemaHistory(storage){
 let rows=[];
 try{const raw=storage.getItem(KEY);if(raw&&raw.length<=32768)rows=cinemaHistoryRows(JSON.parse(raw));}catch{}
 return {get:()=>rows.map(item=>({...item})),remember(items){const next=cinemaHistoryRows(items);if(!next.length)return;rows=next;try{storage.setItem(KEY,JSON.stringify(rows));}catch{}}};
}
