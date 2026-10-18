import {t} from "./i18n.js";
import {sanitizeInterestMixes,interestSources,MAX_INTEREST_MIXES,MAX_INTEREST_PLAYLISTS} from "./music-interest-mixes.js";

export function createInterestMixesUI({saved,button,cover,commit,onOpen,notify}){
  const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!=null)node.textContent=text;return node;};
  const playlists=()=>(Array.isArray(saved.playlists)?saved.playlists:[]).filter(list=>list&&typeof list.id==="string"&&typeof list.name==="string"&&Array.isArray(list.items));
  const configs=()=>sanitizeInterestMixes(saved.interestMixes,playlists());
  let activeDialog=null;
  function dialog(title,build){
    if(activeDialog?.open)activeDialog.close();
    const modal=el("dialog","music-library-dialog music-interest-dialog"),head=el("header","music-library-dialog-head"),heading=el("h3","",title),body=el("div","music-library-dialog-body");
    modal.setAttribute("aria-label",title);head.append(heading,button(t("Close"),"x-circle",()=>modal.close()));modal.append(head,body);document.body.append(modal);
    const previous=document.activeElement;activeDialog=modal;
    modal.addEventListener("close",()=>{if(activeDialog===modal)activeDialog=null;modal.remove();if(previous?.isConnected)previous.focus();});
    build(body,()=>modal.close(),modal);modal.showModal();return modal;
  }
  function showError(modal,message){
    notify?.(message,true);let alert=modal?.querySelector("[role=alert]");
    if(modal&&!alert){alert=el("p","music-status error");alert.setAttribute("role","alert");modal.append(alert);}
    if(alert)alert.textContent=message;
  }
  function update(next,modal){
    try{if(commit(sanitizeInterestMixes(next,playlists(),{strict:true}))===true)return true;}catch{/* The dialog keeps the user's draft when storage/validation fails. */}
    showError(modal,t("Could not save this interest mix."));return false;
  }
  function newId(values){
    const base="interest-"+(globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`),used=new Set(values.map(value=>value.id));
    for(let i=0;i<=MAX_INTEREST_MIXES;i++){const key=i?base.slice(0,60)+"-"+i:base;if(!used.has(key))return key;}
  }
  function remove(id){
    const existing=configs().find(value=>value.id===id);if(!existing){notify?.(t("That interest mix no longer exists."),true);return;}
    return dialog(t("Delete interest mix"),(body,close,modal)=>{
      body.append(el("p","",t("Delete “{name}”? The source playlists and music will stay.",{name:existing.name})));
      const actions=el("div","music-library-actions");actions.append(button(t("Cancel"),null,close,"quiet small"),button(t("Delete interest mix"),null,()=>{
        if(update(configs().filter(value=>value.id!==id),modal)){close();notify?.(t("Interest mix deleted."));onOpen?.(null);}
      },"music-primary"));body.append(actions);
    });
  }
  function edit(id=null,playlistId=null){
    const current=configs(),existing=id?current.find(value=>value.id===id):null;
    if(id&&!existing){notify?.(t("That interest mix no longer exists."),true);return;}
    if(!existing&&current.length>=MAX_INTEREST_MIXES){notify?.(t("Your library can hold up to 8 interest mixes."),true);return;}
    let nameInput;
    const modal=dialog(existing?t("Edit interest mix"):t("Create interest mix"),(body,close,modal)=>{
      const form=el("form","music-playlist-form music-interest-form"),label=el("label","",t("Mix name")),name=el("input","");nameInput=name;
      name.type="text";name.required=true;name.maxLength=40;name.value=existing?.name||"";label.append(name);form.append(label);
      form.append(el("p","music-interest-help",t("Each mix uses its own playlist sources and listening discoveries.")));
      const choices=playlists(),available=new Set(choices.map(value=>value.id));
      const selected=new Set((existing?.playlistIds||(available.has(playlistId)?[playlistId]:[])).filter(key=>available.has(key)));
      const fieldset=el("fieldset","music-interest-choices"),legend=el("legend","",t("Choose up to 8 playlists.")),counter=el("p","music-interest-count");
      fieldset.append(legend);counter.setAttribute("role","status");counter.setAttribute("aria-live","polite");
      const boxes=[];
      const actions=el("div","music-library-actions"),submit=el("button","music-primary",t("Save mix"));submit.type="submit";
      function controls(){
        for(const box of boxes)box.disabled=!box.checked&&selected.size>=MAX_INTEREST_PLAYLISTS;
        counter.textContent=selected.size?t("{count} playlists selected",{count:selected.size}):t("Choose at least one playlist.");
        submit.disabled=!name.value.trim()||!selected.size;
      }
      for(const list of choices){
        const row=el("label","music-interest-choice"),box=el("input",""),copy=el("span","");box.type="checkbox";box.value=list.id;box.checked=selected.has(list.id);
        const title=el("strong","",list.name);title.setAttribute("translate","no");
        copy.append(title,el("small","",t("{count} tracks",{count:list.items.length})));row.append(box,copy);fieldset.append(row);boxes.push(box);
        box.addEventListener("change",()=>{if(box.checked){if(selected.size>=MAX_INTEREST_PLAYLISTS){box.checked=false;}else selected.add(list.id);}else selected.delete(list.id);controls();});
      }
      if(!choices.length)fieldset.append(el("p","music-interest-help",t("Create a playlist first, then build an interest mix from it.")));
      actions.append(button(t("Cancel"),null,close,"quiet small"));
      if(existing)actions.append(button(t("Delete interest mix"),null,()=>{close();remove(existing.id);},"quiet small music-interest-delete"));
      actions.append(submit);form.append(fieldset,counter,actions);body.append(form);name.addEventListener("input",controls);controls();
      form.addEventListener("submit",event=>{
        event.preventDefault();const title=name.value.trim();if(!title){name.focus();return;}
        const latest=configs(),liveExisting=existing?latest.find(value=>value.id===existing.id):null;
        if(existing&&!liveExisting){showError(modal,t("That interest mix no longer exists."));return;}
        if(!existing&&latest.length>=MAX_INTEREST_MIXES){showError(modal,t("Your library can hold up to 8 interest mixes."));return;}
        const availableNow=new Set(playlists().map(value=>value.id)),refs=[...selected].filter(key=>availableNow.has(key));
        if(!refs.length){showError(modal,t("Choose at least one playlist."));return;}
        // Use the latest config so audible discoveries saved while this editor
        // was open are not overwritten by an older draft of learnedIds.
        const value={...(liveExisting||{id:newId(latest)}),name:title,playlistIds:refs};
        const next=liveExisting?latest.map(row=>row.id===value.id?value:row):[value,...latest];
        if(update(next,modal)){close();notify?.(t("Interest mix saved."));onOpen?.(value.id);}
      });
    });
    nameInput.focus();return modal;
  }
  function render(root,{compact=false}={}){
    const values=configs();if(compact&&!values.length)return null;
    const section=el("section","music-interest-section"),head=el("div","music-library-intro music-interest-head");
    head.append(el("h4","",t("Interest mixes")));
    if(!compact){
      const create=button(t("Create interest mix"),"plus",()=>edit(),"music-primary music-text-button");
      create.disabled=!playlists().length||values.length>=MAX_INTEREST_MIXES;
      if(!playlists().length)create.title=t("Create a playlist first, then build an interest mix from it.");
      else if(values.length>=MAX_INTEREST_MIXES)create.title=t("Your library can hold up to 8 interest mixes.");head.append(create);
    }
    section.append(head);
    if(!compact)section.append(el("p","music-interest-help",t("Each mix uses its own playlist sources and listening discoveries.")));
    if(!values.length){const empty=el("div","music-empty");empty.append(el("h4","",t("No interest mixes yet.")),el("p","",playlists().length?t("Choose playlists to keep different listening interests separate."):t("Create a playlist first, then build an interest mix from it.")));section.append(empty);}
    else{
      const grid=el("div","music-interest-grid");
      for(const value of values){
        const members=interestSources(saved,value.id),card=el("article","music-interest-card"),art=el("div","music-playlist-art music-interest-art");
        for(const item of members.slice(0,4)){const image=cover?.(item);if(image)art.append(image);}if(!art.children.length){const image=cover?.(null);if(image)art.append(image);}
        const text=el("div","music-interest-copy"),name=el("strong","",value.name);name.setAttribute("translate","no");
        text.append(name,el("span","",t("{count} playlists · {tracks} source tracks",{count:value.playlistIds.length,tracks:members.length})));
        const canOpen=members.length>0||!!value.learnedIds?.length;
        if(!canOpen)text.append(el("small","",t("Choose playlists to use this mix again.")));
        const actions=el("div","music-interest-actions"),open=button(t("Open mix"),"play",()=>onOpen?.(value.id),"music-primary music-text-button small");open.disabled=!canOpen;
        actions.append(open,button(t("Edit interest mix"),null,()=>edit(value.id),"outline small"));card.append(art,text,actions);grid.append(card);
      }
      section.append(grid);
    }
    root.append(section);return section;
  }
  return {render,edit};
}
