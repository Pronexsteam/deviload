import {t,onLanguageChange} from "./i18n.js";

const STORAGE_KEY="deviload-music-library-panel";
const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const glyph=name=>{const node=el("span","icon");node.dataset.icon=name;node.setAttribute("aria-hidden","true");return node;};
const normalize=value=>String(value||"").normalize("NFKC").toLowerCase().trim();

export function createMusicLibrarySidebar({workspace,saved,onPlaylist,onFavorites,onCreate,cover}){
  const content=el("div","music-main-content"),aside=el("aside","music-library-sidebar"),header=el("div","music-library-sidebar-head"),title=el("h3",""),headActions=el("div","music-library-sidebar-actions");
  aside.id="music-library-panel";title.id="music-library-panel-title";aside.setAttribute("aria-labelledby",title.id);
  content.append(...workspace.childNodes);workspace.append(aside,content);workspace.classList.add("has-library-sidebar");
  const makeButton=(cls,icon,action)=>{const node=el("button",cls);node.type="button";if(icon)node.append(glyph(icon));node.addEventListener("click",action);return node;};
  const media=window.matchMedia("(min-width:960px)");
  let preference=null,active=null,destroyed=false;
  try{const value=localStorage.getItem(STORAGE_KEY);if(value==="open"||value==="closed")preference=value;}catch{/* Local preferences are optional. */}
  let opened=preference?preference==="open":media.matches;
  const toggle=makeButton("music-library-panel-toggle","playlist",()=>setOpen(!opened,true,true)),toggleText=el("span","");toggle.append(toggleText);toggle.setAttribute("aria-controls",aside.id);
  const toolbar=content.querySelector(".music-toolbar");if(toolbar)toolbar.prepend(toggle);else content.prepend(toggle);
  const create=makeButton("music-icon-button","plus",()=>{if(!media.matches)setOpen(false,true,false);onCreate();});
  const close=makeButton("music-icon-button","x-circle",()=>setOpen(false,true,true));
  headActions.append(create,close);header.append(title,headActions);
  const searchWrap=el("div","music-library-sidebar-search"),search=el("input","");search.type="search";search.maxLength=60;search.autocomplete="off";search.spellcheck=false;searchWrap.append(glyph("magnifying-glass"),search);
  const list=el("nav","music-library-sidebar-list"),empty=el("p","music-library-sidebar-empty");empty.setAttribute("role","status");
  aside.append(header,searchWrap,list,empty);
  function setOpen(value,remember=false,focus=false){
    opened=value;aside.hidden=!value;workspace.classList.toggle("library-panel-open",value);toggle.setAttribute("aria-expanded",String(value));
    if(remember){preference=value?"open":"closed";try{localStorage.setItem(STORAGE_KEY,preference);}catch{/* Remain usable with denied storage. */}}
    if(focus){if(value&&!media.matches)search.focus();else if(!value)toggle.focus();}
  }
  function navigate(callback){if(!media.matches)setOpen(false,true,false);callback();}
  function row(name,count,art,action,id,pinned=false){
    const node=makeButton("music-library-nav-item",null,()=>navigate(action)),copy=el("span","music-library-nav-copy"),label=el("strong","",name),meta=el("small","",t("{count} tracks",{count}));
    if(pinned){const pin=el("span","music-library-nav-pin","★");pin.setAttribute("aria-label",t("Pinned playlist"));meta.prepend(pin);}
    copy.append(label,meta);node.append(art,copy);node.title=name;
    node.classList.toggle("selected",active===id);if(active===id)node.setAttribute("aria-current","page");return node;
  }
  function refresh(activeId){
    if(destroyed)return;if(activeId!==undefined)active=activeId;
    const query=normalize(search.value);list.replaceChildren();
    {
      const heart=el("span","music-library-nav-art music-library-liked-art","♥");heart.setAttribute("aria-hidden","true");
      list.append(row(t("Liked songs"),saved.favorites?.length||0,heart,onFavorites,"favorites"));
    }
    const playlists=[...(saved.playlists||[])].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));
    for(const playlist of playlists){
      if(query&&!normalize(playlist.name).includes(query))continue;
      const art=el("span","music-library-nav-art");
      if(typeof playlist.cover==="string"&&playlist.cover.length<=110000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(playlist.cover)){
        const image=el("img","");image.src=playlist.cover;image.alt="";image.loading="lazy";image.decoding="async";art.append(image);
      }else if(cover)art.append(cover(playlist.items?.[0],"",96));else art.append(glyph("playlist"));
      list.append(row(playlist.name,playlist.items?.length||0,art,()=>onPlaylist(playlist.id),playlist.id,playlist.pinned));
    }
    empty.textContent=query?t("No matching playlists."):t("Create a playlist to keep your favorites close.");
    empty.hidden=query?list.childElementCount>0:playlists.length>0;
  }
  function translate(){
    if(destroyed)return;title.textContent=t("Your library");list.setAttribute("aria-label",t("Your library"));toggleText.textContent=t("Your library");toggle.title=t("Show or hide your music library");toggle.setAttribute("aria-label",t("Show or hide your music library"));
    create.title=t("Create playlist");create.setAttribute("aria-label",t("Create playlist"));close.title=t("Close library panel");close.setAttribute("aria-label",t("Close library panel"));
    search.placeholder=t("Search your playlists");search.setAttribute("aria-label",t("Search your playlists"));refresh();
  }
  const onResize=()=>{if(preference===null)setOpen(media.matches);};
  const onEscape=event=>{if(event.key==="Escape"&&opened){event.preventDefault();event.stopPropagation();setOpen(false,true,true);}};
  search.addEventListener("input",()=>refresh());aside.addEventListener("keydown",onEscape);media.addEventListener("change",onResize);onLanguageChange(translate);
  translate();setOpen(opened);
  return {refresh,destroy(){
    if(destroyed)return;destroyed=true;media.removeEventListener("change",onResize);aside.removeEventListener("keydown",onEscape);toggle.remove();aside.remove();
    content.replaceWith(...content.childNodes);workspace.classList.remove("has-library-sidebar","library-panel-open");
  }};
}
