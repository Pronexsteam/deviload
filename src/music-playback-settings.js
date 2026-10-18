import {t,errorText,onLanguageChange} from "./i18n.js";
export function wirePlaybackSettings(invoke,{diagnostics}={}){
  const dialog=document.getElementById("music-preferences"),open=document.getElementById("music-settings-open");
  open.addEventListener("click",()=>dialog.showModal());
  document.getElementById("music-settings-close").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>open.focus());
  dialog.addEventListener("click",event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  const panel=document.getElementById("music-playback-settings"),status=panel.querySelector("[role=status]"),clear=panel.querySelector("[data-clear-cache]"),update=panel.querySelector("[data-update-engine]");
  const limit=document.getElementById("music-cache-limit");
  const report=document.createElement("button"),reportNote=document.createElement("p"),engineStatus=document.createElement("p");
  let engineRunning=null;
  report.type="button";report.className="outline small";report.dataset.exportPlaybackReport="";
  panel.querySelector(".setting-actions").append(report);panel.append(engineStatus,reportNote);
  const labels=()=>{report.textContent=t("Export playback report");report.title=t("Save recent playback stages and error categories.");reportNote.textContent=t("Reports exclude track names, links, local paths and account data. Recent diagnostics stay in memory for up to two hours.");engineStatus.textContent=engineRunning===null?"":engineRunning?t("Music engine: running."):t("Music engine: not started. It starts when music is played.");};
  labels();onLanguageChange(labels);
  let busy=false,selectedLimit=limit?.value;
  async function run(action){if(busy)return;busy=true;clear.disabled=update.disabled=report.disabled=true;if(limit)limit.disabled=true;try{await action();}catch(error){if(limit)limit.value=selectedLimit;status.textContent=errorText(error);}finally{busy=false;clear.disabled=update.disabled=report.disabled=false;if(limit)limit.disabled=false;}}
  const showUsage=value=>{if(limit){selectedLimit=String(value.limit);limit.value=selectedLimit;}status.textContent=t("Audio cache: {size} MB of {limit} MB.",{size:Math.round(value.bytes/1048576),limit:Math.round(value.limit/1048576)});};
  const usage=async()=>showUsage(await invoke("music_cache",{}));
  limit?.addEventListener("change",()=>run(async()=>showUsage(await invoke("music_cache",{limit:Number(limit.value)}))));
  const showDiagnostics=async()=>{try{const value=await invoke("music_diagnostics",{});engineRunning=Boolean(value.engine.running);}catch{engineRunning=null;}labels();};
  panel.addEventListener("toggle",()=>{if(panel.open)run(async()=>{await usage();await showDiagnostics();});});
  report.addEventListener("click",()=>run(async()=>{
    const saved=await invoke("export_music_diagnostics",{events:diagnostics?.snapshot()||[]});
    if(saved)status.textContent=t("Playback report saved. You can review it before sharing.");
  }));
  clear.addEventListener("click",()=>run(async()=>{await invoke("music_cache",{clear:true});status.textContent=t("Audio cache cleared. The current song can finish playing.");}));
  update.addEventListener("click",()=>run(async()=>{
    status.textContent=t("Checking music engine updates…");const value=await invoke("music_engine_update",{});
    status.textContent=value.status==="staged"?t("Music engine update verified. Restart Deviload to apply it."):value.status==="unpublished"?t("No separate music engine update has been published yet."):t("The music engine is up to date.");
  }));
}
