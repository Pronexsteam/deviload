import {t,errorText} from "./i18n.js";
export function wirePlaybackSettings(invoke){
  const dialog=document.getElementById("music-preferences"),open=document.getElementById("music-settings-open");
  open.addEventListener("click",()=>dialog.showModal());
  document.getElementById("music-settings-close").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>open.focus());
  dialog.addEventListener("click",event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  const panel=document.getElementById("music-playback-settings"),status=panel.querySelector("[role=status]"),clear=panel.querySelector("[data-clear-cache]"),update=panel.querySelector("[data-update-engine]");
  const limit=document.getElementById("music-cache-limit");
  let busy=false,selectedLimit=limit?.value;
  async function run(action){if(busy)return;busy=true;clear.disabled=update.disabled=true;if(limit)limit.disabled=true;try{await action();}catch(error){if(limit)limit.value=selectedLimit;status.textContent=errorText(error);}finally{busy=false;clear.disabled=update.disabled=false;if(limit)limit.disabled=false;}}
  const showUsage=value=>{if(limit){selectedLimit=String(value.limit);limit.value=selectedLimit;}status.textContent=t("Audio cache: {size} MB of {limit} MB.",{size:Math.round(value.bytes/1048576),limit:Math.round(value.limit/1048576)});};
  const usage=async()=>showUsage(await invoke("music_cache",{}));
  limit?.addEventListener("change",()=>run(async()=>showUsage(await invoke("music_cache",{limit:Number(limit.value)}))));
  panel.addEventListener("toggle",()=>{if(panel.open)run(usage);});
  clear.addEventListener("click",()=>run(async()=>{await invoke("music_cache",{clear:true});status.textContent=t("Audio cache cleared. The current song can finish playing.");}));
  update.addEventListener("click",()=>run(async()=>{
    status.textContent=t("Checking music engine updates…");const value=await invoke("music_engine_update",{});
    status.textContent=value.status==="staged"?t("Music engine update verified. Restart Deviload to apply it."):value.status==="unpublished"?t("No separate music engine update has been published yet."):t("The music engine is up to date.");
  }));
}
