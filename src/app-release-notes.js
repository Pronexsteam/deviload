import {t,onLanguageChange} from "./i18n.js";

const RELEASE_ID="deviload-2.7.1";
const STORAGE_KEY="deviload-app-release-notes";
const instances=new WeakMap();

// A feature identifier deliberately stays separate from the app version.
export function wireReleaseNotes(workspace){
  if(instances.has(workspace))return instances.get(workspace);
  const heading=workspace.querySelector(".topbar"),actions=heading?.querySelector(".topbar-actions");
  if(!heading||!actions)return null;
  const button=document.createElement("button");
  button.type="button";button.className="app-release-open";
  button.setAttribute("aria-controls","app-release-notes");
  const card=document.createElement("section");
  card.id="app-release-notes";card.className="app-release-notes";
  card.setAttribute("aria-labelledby","app-release-title");
  const copy=document.createElement("div"),title=document.createElement("h4"),list=document.createElement("ul");
  title.id="app-release-title";
  const items=Array.from({length:3},()=>document.createElement("li"));
  list.append(...items);copy.append(title,list);
  const close=document.createElement("button");
  close.type="button";close.className="app-release-close";close.textContent="×";
  card.append(copy,close);heading.insertAdjacentElement("afterend",card);actions.prepend(button);
  const translate=()=>{
    button.textContent=t("What's new");title.textContent="Deviload · "+t("What's new");
    close.setAttribute("aria-label",t("Dismiss release notes"));
    items[0].textContent=t("Import Spotify albums into your music library.");
    items[1].textContent=t("Save up to 100 songs from a YouTube Mix.");
    items[2].textContent=t("Fixed Linux AppImage startup permissions.");
  };
  const show=visible=>{card.hidden=!visible;button.setAttribute("aria-expanded",String(visible));};
  let dismissed=false;
  try{dismissed=localStorage.getItem(STORAGE_KEY)===RELEASE_ID;}catch{/* Still usable when local storage is unavailable. */}
  const open=()=>show(true);
  const dismiss=()=>{
    try{localStorage.setItem(STORAGE_KEY,RELEASE_ID);}catch{/* Dismiss for this session even if persistence is blocked. */}
    show(false);button.focus();
  };
  button.addEventListener("click",()=>{if(card.hidden)open();else dismiss();});
  close.addEventListener("click",dismiss);
  card.addEventListener("keydown",event=>{if(event.key==="Escape"){event.stopPropagation();dismiss();}});
  window.addEventListener("storage",event=>{if(event.key===STORAGE_KEY&&event.newValue===RELEASE_ID)show(false);});
  translate();onLanguageChange(translate);show(!dismissed);
  const result={open};instances.set(workspace,result);return result;
}
