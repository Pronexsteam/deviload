import {sanitizeMusicTrack} from './music-profile.js';

// Collection transfers are additive. Device preferences and learned taste never enter this format.
export function readCollectionTransfer(source){
 const o=JSON.parse(source);
 if(o?.format!=='devil-music-collection'||o.version!==1)throw Error('Invalid music collection.');
 const tracks=values=>{
  if(!Array.isArray(values))throw Error('Invalid music collection.');
  return [...new Map(values.map(value=>{const t=sanitizeMusicTrack(value);if(!/^[\w-]{11}$/.test(t.id))throw Error('Invalid music collection.');return [t.id,t];})).values()];
 };
 if(!Array.isArray(o.playlists))throw Error('Invalid music collection.');
 const ids=new Set();
 return {favorites:tracks(o.favorites),playlists:o.playlists.map(p=>{
  if(!p||typeof p.id!=='string'||!/^[-\w]{1,64}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim())throw Error('Invalid music collection.');
  ids.add(p.id);return {id:p.id,name:p.name.trim().slice(0,160),items:tracks(p.items)};
 })};
}
export function mergeCollectionTransfer(current,incoming){
 const union=(old,added)=>{const seen=new Set();return [...old,...added].filter(t=>!seen.has(t.id)&&seen.add(t.id));};
 const playlists=current.saved.playlists.map(p=>({...p,items:[...p.items]}));const byId=new Map(playlists.map(p=>[p.id,p]));
 for(const p of incoming.playlists){const old=byId.get(p.id);if(old)old.items=union(old.items,p.items);else {const next={...p,items:[...p.items]};playlists.push(next);byId.set(p.id,next);}}
 return {saved:{...current.saved,favorites:union(current.saved.favorites,incoming.favorites),playlists},taste:current.taste};
}
