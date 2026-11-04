import {t,onLanguageChange,errorText} from "./i18n.js";
import {exportMusicProfile,importMusicProfile} from "./music-profile.js";
import {readCollectionTransfer,mergeCollectionTransfer} from './music-collection-transfer.js';

export function wireMusicProfile({invoke,read,restore}){
  const root=document.getElementById("music-profile"),file=root.querySelector("input"),summary=root.querySelector("[data-summary]"),preview=root.querySelector("[data-preview]"),status=root.querySelector("[role=status]");
  const exporting=root.querySelector("[data-export]"),importing=root.querySelector("[data-import]"),apply=root.querySelector("[data-restore]"),cancel=root.querySelector("[data-cancel]");
  let candidate=null,busy=false,collection=null;
  const replacementWarning=preview.querySelector("[data-replacement-warning]");
  function describe(){apply.textContent=collection?t("Add collection"):t("Restore music profile");if(replacementWarning)replacementWarning.hidden=!!collection;if(collection){summary.textContent=t("Add {tracks} tracks in {playlists} playlists. Existing music, settings and recommendations stay saved.",{tracks:new Set([...collection.favorites,...collection.playlists.flatMap(p=>p.items)].map(t=>t.id)).size,playlists:collection.playlists.length});return;}if(candidate)summary.textContent=t("Likes: {likes}. History: {history}. Learned tracks: {tracks}. Playlists: {playlists}.",{likes:candidate.saved.favorites.length,history:candidate.saved.recent.length,tracks:Object.keys(candidate.taste.entries).length,playlists:candidate.saved.playlists.length});}
  onLanguageChange(describe);
  async function run(action){
    if(busy)return;busy=true;[exporting,importing,apply,cancel].forEach(button=>button.disabled=true);status.textContent="";
    try{await action();}catch(error){status.textContent=errorText(error);}
    finally{busy=false;[exporting,importing,apply,cancel].forEach(button=>button.disabled=false);}
  }
  exporting.addEventListener("click",()=>run(async()=>{
    const {saved,taste}=read(),data=exportMusicProfile(saved,taste);
    if(window.__TAURI__?.core?.invoke){if(!await invoke("export_music_profile",{text:data}))return;}
    else{
      const url=URL.createObjectURL(new Blob([data],{type:"application/json"})),link=document.createElement("a");
      link.href=url;link.download="devil-music-profile.json";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    status.textContent=t("Music profile exported ({size} KB). Keep the file to restore your preferences.",{size:Math.max(1,Math.ceil(new TextEncoder().encode(data).length/1024))});
  }));
  importing.addEventListener("click",()=>file.click());
  file.addEventListener("change",()=>run(async()=>{
    const selected=file.files[0];file.value="";candidate=null;collection=null;preview.hidden=true;if(!selected)return;
    const source=await selected.text();if(JSON.parse(source)?.format==='devil-music-collection')collection=readCollectionTransfer(source);else candidate=importMusicProfile(source);describe();preview.hidden=false;
  }));
  cancel.addEventListener("click",()=>{candidate=null;collection=null;preview.hidden=true;});
  apply.addEventListener("click",()=>run(async()=>{
    if(collection){await restore(mergeCollectionTransfer(read(),collection));collection=null;preview.hidden=true;status.textContent=t("Collection added. Your listening preferences were kept.");return;}
    if(!candidate)return;await restore(candidate);candidate=null;preview.hidden=true;status.textContent=t("Music profile restored. Recommendations will use these preferences.");
  }));
}
