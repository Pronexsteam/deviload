import {t,onLanguageChange} from "./i18n.js";
import {shouldShowReleaseNotes,markReleaseNotesSeen} from "./release-notes-state.js";
const instances=new WeakMap();
export function wireReleaseNotes(workspace){
  if(instances.has(workspace))return instances.get(workspace);
  const actions=workspace.querySelector(".topbar-actions");if(!actions)return null;
  const make=(tag,cls="")=>{const node=document.createElement(tag);node.className=cls;return node;};
  const button=make("button","app-release-open");button.type="button";button.setAttribute("aria-haspopup","dialog");button.setAttribute("aria-controls","app-release-notes");
  const card=make("dialog","app-release-notes");card.id="app-release-notes";card.setAttribute("aria-labelledby","app-release-title");
  const header=make("header","app-release-header"),eyebrow=make("span","app-release-version"),title=make("h2"),intro=make("p","app-release-intro"),close=make("button","app-release-close");
  title.id="app-release-title";close.type="button";close.textContent="×";header.append(eyebrow,close,title,intro);
  const sections=make("div","app-release-sections"),changed=make("section"),fixed=make("section"),changedTitle=make("h3"),fixedTitle=make("h3"),changes=make("ul"),fixes=make("ul");
  const changeItems=Array.from({length:4},()=>make("li")),fixItems=Array.from({length:3},()=>make("li"));changes.append(...changeItems);fixes.append(...fixItems);changed.append(changedTitle,changes);fixed.append(fixedTitle,fixes);sections.append(changed,fixed);
  const done=make("button","app-release-done");done.type="button";card.append(header,sections,done);document.body.append(card);actions.prepend(button);
  let version=null,returnFocus=null,autoPending=false,storage;try{storage=localStorage;}catch{/* Optional persistence. */}
  const translate=()=>{
    button.textContent=title.textContent=t("What's new");eyebrow.textContent=version?"Deviload "+version:"Deviload";
    intro.textContent=t("A closer look at what changed and what was fixed.");close.ariaLabel=t("Dismiss release notes");done.textContent=t("Got it");
    changedTitle.textContent=t("What changed");fixedTitle.textContent=t("What was fixed");
    changeItems[0].textContent=t("Ambient connects the workspace with cover colors and audio-reactive light.");
    changeItems[1].textContent=t("Read lyrics beside your library or in the full player, with word highlights when timings are available.");
    changeItems[2].textContent=t("Switch to a compact mini-player with vinyl artwork and all playback controls.");
    changeItems[3].textContent=t("Scan the remote QR on the same Wi-Fi to control music from your phone. Sound stays on the computer.");
    fixItems[0].textContent=t("Readable navigation in narrow windows, smoother sliders and correct switching between player windows.");
    fixItems[1].textContent=t("Discovery follows your listening without regional chart shelves.");
    fixItems[2].textContent=t("Debian 13 GNOME/Wayland now applies the reported renderer workaround at startup; confirmation on the affected machine is still pending.");
  };
  const open=()=>{if(card.open)return;returnFocus=document.activeElement;card.showModal();button.setAttribute("aria-expanded","true");markReleaseNotesSeen(storage,version);autoPending=false;done.focus();};
  const tryAutomatic=()=>{if(!autoPending||document.hidden||document.querySelector('dialog[open]'))return;open();};
  button.addEventListener("click",open);close.addEventListener("click",()=>card.close());done.addEventListener("click",()=>card.close());
  card.addEventListener("close",()=>{button.setAttribute("aria-expanded","false");returnFocus?.focus();});
  document.addEventListener("close",()=>queueMicrotask(tryAutomatic),true);document.addEventListener("visibilitychange",tryAutomatic);
  translate();onLanguageChange(translate);button.setAttribute("aria-expanded","false");
  // Read the installed version, not a feature label that can outlive a release.
  Promise.resolve().then(()=>window.__TAURI__?.app?.getVersion?.()).then(value=>{
    if(typeof value!=="string"||!value.trim())return;version=value;translate();autoPending=shouldShowReleaseNotes(storage,version);requestAnimationFrame(tryAutomatic);
  }).catch(()=>{/* Manual opening still works when version lookup fails. */});
  const result={open};instances.set(workspace,result);return result;
}
