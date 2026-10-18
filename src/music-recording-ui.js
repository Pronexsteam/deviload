import {t,language,errorText} from "./i18n.js";
import {recordingAlternatives,recordingDescriptor,resolveRecordingSource} from "./music-recordings.js";

const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!=null)node.textContent=text;return node;};
function durationLabel(item){
  const seconds=recordingDescriptor(item).duration;
  if(seconds===null)return t("Duration unknown");
  const value=Math.round(seconds),minutes=Math.floor(value/60),tail=String(value%60).padStart(2,"0");
  return minutes>=60?`${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,"0")}:${tail}`:`${minutes}:${tail}`;
}

export function openRecordingPicker({item,invoke,button,cover,bindings,save}){
  const previous=document.activeElement,modal=el("dialog","music-library-dialog music-recording-dialog"),head=el("header","music-library-dialog-head"),body=el("div","music-library-dialog-body");
  modal.setAttribute("aria-label",t("Choose recording source"));
  head.append(el("h3","",t("Choose recording source")),button(t("Close"),"x-circle",()=>modal.close()));
  body.append(el("p","",t("Choose the recording you want to play. Your likes, history and playlists keep this song.")));
  const current=()=>resolveRecordingSource(item,bindings?.()||[]);
  function trackSummary(track,label){
    const section=el("section","music-duplicate-group");
    if(label)section.append(el("strong","",label));
    const row=el("div","music-artist-choice"),copy=el("div","");copy.style.minWidth="0";copy.style.flex="1";copy.style.overflowWrap="anywhere";
    const title=el("strong","",track.title),artists=el("p","",(track.artists||[]).filter(name=>typeof name==="string").join(", ")||t("Unknown artist"));
    title.setAttribute("translate","no");if((track.artists||[]).some(name=>typeof name==="string"&&name.trim()))artists.setAttribute("translate","no");
    copy.append(title,artists,el("small","",durationLabel(track)));
    row.append(cover(track),copy);section.append(row);return section;
  }
  body.append(trackSummary(item,t("Your song")));
  const chosen=current();if(chosen.id!==item.id)body.append(trackSummary(chosen,t("Current source")));
  const form=el("form",""),input=el("input","");input.type="search";input.required=true;input.maxLength=180;
  input.placeholder=t("Search by title and artist");input.setAttribute("aria-label",t("Search by title and artist"));
  input.value=[...(item.artists||[]).filter(name=>typeof name==="string"),item.title].join(" ").replace(/\s+/gu," ").trim().slice(0,180);
  const search=el("button","outline small",t("Search"));search.type="submit";form.append(input,search);body.append(form);
  const status=el("p","music-status"),results=el("div","");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  body.append(el("h4","",t("Available recordings")),results,status);
  let request=0,closed=false,saving=false,pending="";
  function message(value,error=false){status.textContent=value;status.className=error?"music-status error":"music-status";status.setAttribute("role",error?"alert":"status");}
  function choose(source){
    if(closed||saving)return;
    saving=true;
    try{if(save(source)===true)modal.close();else message(t("Could not save your music preferences."),true);}
    catch(error){message(errorText(error),true);}
    finally{saving=false;}
  }
  const reset=button(t("Use original source"),null,()=>choose(null),"outline small");reset.disabled=chosen.id===item.id;
  const actions=el("div","music-library-actions");actions.append(reset,button(t("Cancel"),null,()=>modal.close(),"quiet small"));body.append(actions);
  function showRow(row){
    const section=trackSummary(row.item),matched=row.confidence==="high";
    section.append(el("p","",matched?t("Matching metadata"):t("Check this recording")));
    const reasons=new Set(row.reasons),warnings=[];
    if(reasons.has("version_mismatch"))warnings.push(t("This is a different version."));
    if(reasons.has("artist_mismatch")||reasons.has("artist_overlap"))warnings.push(t("The artist credits differ."));
    if(reasons.has("duration_mismatch"))warnings.push(t("The duration differs."));
    if(warnings.length)section.append(el("p","music-import-review",warnings.join(" ")));
    const used=current().id===row.item.id;
    const label=used?t("Currently used"):warnings.length?t("Choose this different version"):t("Use this source");
    const use=button(label,null,()=>choose(row.item),warnings.length?"outline small":"music-primary");use.disabled=used;section.append(use);results.append(section);
  }
  async function find(){
    const value=input.value.replace(/\s+/gu," ").trim().slice(0,180);if(!value||closed||pending===value)return;
    const token=++request;pending=value;search.disabled=true;results.replaceChildren();message(t("Searching recordings…"));
    try{
      const result=await invoke("music_catalog",{kind:"search",value,filter:"songs",language:language()});
      if(closed||token!==request||!modal.isConnected)return;
      const candidates=(Array.isArray(result?.sections)?result.sections:[]).flatMap(section=>Array.isArray(section?.items)?section.items:[]);
      const rows=recordingAlternatives(item,candidates,{limit:12});for(const row of rows)showRow(row);
      message(rows.length?t("Choose a source after checking the title, artist and version."):t("No alternative recordings found. Try another search."));
    }catch(error){if(!closed&&token===request)message(errorText(error),true);}
    finally{if(!closed&&token===request){pending="";search.disabled=false;}}
  }
  form.addEventListener("submit",event=>{event.preventDefault();find();});
  modal.addEventListener("close",()=>{if(closed)return;closed=true;++request;modal.remove();if(previous?.isConnected)previous.focus();});
  modal.append(head,body);document.body.append(modal);modal.showModal();input.focus();find();return modal;
}
