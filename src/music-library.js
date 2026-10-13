import {t} from "./i18n.js";
import {tracks,reorderTrack} from "./music-state.js";
import {movePlaylistTracks,transferPlaylistTracks,duplicateGroups} from "./music-library-model.js";

export function createMusicLibrary({saved,commit,onOpen,notify,button,cover}){
  saved.playlists??=[];
  const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!=null)node.textContent=text;return node;};
  const find=id=>saved.playlists.find(list=>list.id===id);
  let previous=null;
  function update(lists,remember=true){
    let message="";
    if(lists.length>30||lists.reduce((sum,list)=>sum+list.items.length,0)>500)message=t("Your library holds up to 30 playlists and 500 playlist entries.");
    else {const before=saved.playlists;if(commit(lists)){if(remember)previous=before;return true;}message=t("Could not save your music preferences.");}

    notify(message,true);const modal=document.querySelector(".music-library-dialog[open]");
    if(modal){let error=modal.querySelector("[role=alert]");if(!error){error=el("p","music-status error");error.setAttribute("role","alert");modal.append(error);}error.textContent=message;}
    return false;
  }
  function dialog(title,build){
    const modal=el("dialog","music-library-dialog"),heading=el("h3","",title),body=el("div","music-library-dialog-body");modal.setAttribute("aria-label",title);
    const close=button(t("Close"),"x-circle",()=>modal.close());
    const head=el("header","music-library-dialog-head");head.append(heading,close);modal.append(head,body);document.body.append(modal);
    const previous=document.activeElement;
    modal.addEventListener("close",()=>{modal.remove();if(previous?.isConnected)previous.focus();});
    build(body,()=>modal.close());modal.showModal();return modal;
  }
  function edit(id,item){
    const existing=find(id);
    const modal=dialog(existing?t("Edit playlist"):t("Create playlist"),(body,close)=>{
      const form=el("form","music-playlist-form"),label=el("label","",t("Playlist name")),name=el("input","");
      name.type="text";name.required=true;name.maxLength=60;name.value=existing?.name||"";label.append(name);
      const descriptionLabel=el("label","",t("Description")),description=el("textarea","");description.maxLength=300;description.rows=3;description.value=existing?.description||"";descriptionLabel.append(description);
      let artwork=existing?.cover||"";
      const image=el("input","");image.type="file";image.accept="image/png,image/jpeg,image/webp";image.hidden=true;
      const preview=el("div","music-playlist-edit-art");const redraw=()=>{preview.replaceChildren();if(artwork){const img=el("img","");img.src=artwork;img.alt="";preview.append(img);}else preview.append(cover(existing?.items[0]));};redraw();
      const upload=button(t("Choose cover"),null,()=>image.click(),"outline small"),reset=button(t("Use track artwork"),null,()=>{artwork="";redraw();},"quiet small"),imageStatus=el("p","");imageStatus.setAttribute("role","status");
      image.addEventListener("change",async()=>{const file=image.files[0];image.value="";if(!file)return;upload.disabled=true;submit.disabled=true;try{if(file.size>8*1024*1024||!/^image\/(png|jpeg|webp)$/.test(file.type))throw Error(t("Choose a PNG, JPEG or WebP image up to 8 MB."));const bitmap=await createImageBitmap(file);try{const canvas=document.createElement("canvas");canvas.width=canvas.height=320;const size=Math.min(bitmap.width,bitmap.height);canvas.getContext("2d").drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,320,320);const value=canvas.toDataURL("image/webp",.75);if(value.length>110000)throw Error(t("This cover is too detailed. Choose a smaller image."));artwork=value;redraw();imageStatus.textContent="";}finally{bitmap.close();}}catch(error){imageStatus.textContent=error.message;}finally{upload.disabled=false;submit.disabled=false;}});
      const artworkActions=el("div","setting-actions");artworkActions.append(upload,reset,image);form.append(preview,artworkActions,imageStatus);
      const actions=el("div","music-library-actions");actions.append(button(t("Cancel"),null,close,"quiet small"));
      const submit=el("button","music-primary",t("Save playlist"));submit.type="submit";actions.append(submit);form.append(label,descriptionLabel,actions);body.append(form);
      form.addEventListener("submit",event=>{
        event.preventDefault();const title=name.value.trim();if(!title){name.focus();return;}
        const playlist={...(existing||{id:crypto.randomUUID(),items:item?[item]:[]}),name:title,description:description.value.trim(),cover:artwork};
        const lists=existing?saved.playlists.map(list=>list.id===id?playlist:list):[playlist,...saved.playlists];
        if(update(lists)){close();onOpen(playlist.id);}
      });
    });
    modal.querySelector("input[type=text]").focus();
  }
  function picker(item){
    dialog(t("Add to playlist"),(body,close)=>{
      body.append(el("p","music-dialog-track",item.title));
      body.append(button(t("Create playlist"),"plus",()=>{close();edit(null,item);},"music-library-create"));
      for(const list of saved.playlists){
        const included=list.items.some(track=>track.id===item.id);
        const select=button(list.name,null,()=>{
          if(update(saved.playlists.map(value=>value.id===list.id?{...value,items:tracks([...value.items,item])}:value))){close();notify(t("Added to playlist: {name}",{name:list.name}));}
        },"music-playlist-choice");
        select.append(el("span","",included?t("Already added"):t("{count} tracks",{count:list.items.length})));select.disabled=included;body.append(select);
      }
    });
  }
  function overview(root){
    const intro=el("div","music-library-intro");intro.append(el("p","",t("Your playlists. Your order. Always here.")),button(t("Create playlist"),"plus",()=>edit(),"music-primary music-text-button"));root.append(intro);
    if(!saved.playlists.length){const empty=el("div","music-empty");empty.append(el("h4","",t("Make room for your favorites")),el("p","",t("Create a playlist, then add songs from search or your liked songs.")));root.append(empty);return;}
    const grid=el("div","music-playlists-grid");
    for(const list of [...saved.playlists].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned))){
      const card=button(list.name,null,()=>onOpen(list.id),"music-playlist-tile"),art=artwork(list);
      card.replaceChildren(art,el("strong","",(list.pinned?"★ ":"")+list.name),el("span","",t("{count} tracks",{count:list.items.length})));grid.append(card);
    }
    root.append(grid);
  }
  function remove(id){
    const list=find(id);if(!list)return;
    dialog(t("Delete playlist"),(body,close)=>{
      body.append(el("p","",t("Delete “{name}”? Downloaded music will stay on this computer.",{name:list.name})));
      const actions=el("div","music-library-actions");actions.append(button(t("Cancel"),null,close,"quiet small"),button(t("Delete playlist"),null,()=>{if(update(saved.playlists.filter(value=>value.id!==id))){close();onOpen(null);}},"music-primary"));body.append(actions);
    });
  }
  function artwork(list){const art=el("div","music-playlist-art");if(list.cover){const img=el("img","");img.src=list.cover;img.alt="";art.append(img);}else{for(const item of list.items.slice(0,4))art.append(cover(item));if(!list.items.length)art.append(cover(null));}return art;}
  function removeTracks(id,ids){const chosen=new Set(ids);if(update(saved.playlists.map(list=>list.id===id?{...list,items:list.items.filter(item=>!chosen.has(item.id))}:list))){onOpen(id);notify(t("Tracks removed. You can undo this change."));return true;}return false;}
  function transfer(id,ids,move){dialog(move?t("Move to playlist"):t("Copy to playlist"),(body,close)=>{const targets=saved.playlists.filter(list=>list.id!==id);if(!targets.length)body.append(el("p","",t("Create another playlist first.")));for(const list of targets)body.append(button(list.name,null,()=>{if(update(transferPlaylistTracks(saved.playlists,id,list.id,ids,move))){close();onOpen(id);notify(t("Playlist updated."));}},"music-playlist-choice"));});}
  function duplicates(id){const groups=duplicateGroups(find(id)?.items||[]);dialog(t("Review similar tracks"),(body,close)=>{if(!groups.length){body.append(el("p","",t("No similar duplicates found.")));return;}body.append(el("p","",t("Tracks with matching titles and artists may be different versions. Select only the copies you want to remove.")));const selected=new Set();for(const group of groups){const section=el("div","music-duplicate-group");section.append(el("strong","",group[0].title));for(const item of group){const label=el("label","");const box=el("input","");box.type="checkbox";box.addEventListener("change",()=>box.checked?selected.add(item.id):selected.delete(item.id));label.append(box,el("span","",item.subtitle||item.title),cover(item));section.append(label);}body.append(section);}body.append(button(t("Remove selected"),null,()=>{if(selected.size){if(removeTracks(id,[...selected]))close();}},"music-primary"));});}
  return {find,overview,picker,artwork,duplicates,transfer,removeTracks,create:()=>edit(),rename:id=>edit(id),remove,
    invalidateUndo(){previous=null;},
    canUndo:()=>!!previous,
    undo(id){if(previous&&update(previous,false)){previous=null;onOpen(find(id)?id:null);}},
    pin(id){const list=find(id);if(list&&update(saved.playlists.map(x=>x.id===id?{...x,pinned:!x.pinned}:x)))onOpen(id);},
    reorder(id,ids,before){const list=find(id);if(list&&update(saved.playlists.map(x=>x.id===id?{...x,items:movePlaylistTracks(x.items,ids,before)}:x)))onOpen(id);},
    removeTrack(id,trackId){removeTracks(id,[trackId]);},
    move(id,trackId,position){const list=find(id);if(list&&update(saved.playlists.map(value=>value.id===id?{...value,items:reorderTrack(value.items,trackId,position)}:value)))onOpen(id);}
  };
}
