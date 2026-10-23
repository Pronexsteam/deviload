// Search owns only its draft and route label. It never starts playback or keeps
// a second copy of the catalog, listening history, or a persistent query history.
export function wireMusicSearch({form,input,clear,shortcut,page=globalThis.document,isActive,onSearch,onClear,
  platform=globalThis.navigator?.userAgentData?.platform||globalThis.navigator?.platform||""}){
  let routeQuery="",retryAllowed=false,composing=false;
  const shortcutOptions={capture:true};
  const update=()=>{if(clear)clear.hidden=!input.value;};
  const focus=()=>{input.focus();input.select?.();};
  function clearSearch(){input.value="";update();input.focus();onClear();}
  function submit(event){
    event.preventDefault();if(composing||event.isComposing)return;
    const query=input.value.trim();
    if(!query){clearSearch();return;}
    input.value=query;update();
    if(query===routeQuery&&!retryAllowed)return;
    retryAllowed=false;onSearch(query);
  }
  function nativeSearch(){if(!input.value)clearSearch();}
  const beginComposition=()=>{composing=true;},endComposition=()=>{composing=false;};
  function shortcutKey(event){
    if(event.defaultPrevented||event.isComposing||!isActive()||page.querySelector("dialog[open]"))return;
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key?.toLowerCase()==="k"){
      event.preventDefault();event.stopPropagation();focus();return;
    }
    if(event.key==="Escape"&&event.target===input&&input.getAttribute?.("aria-expanded")!=="true"){
      event.preventDefault();event.stopPropagation();
      if(input.value)clearSearch();else input.blur();
    }
  }
  input.setAttribute("aria-keyshortcuts","Control+K Meta+K");
  if(shortcut)shortcut.textContent=/Mac|iPhone|iPad/i.test(platform)?"⌘ K":"Ctrl K";
  form.addEventListener("submit",submit);input.addEventListener("input",update);input.addEventListener("search",nativeSearch);
  input.addEventListener("compositionstart",beginComposition);input.addEventListener("compositionend",endComposition);
  clear?.addEventListener("click",clearSearch);page.addEventListener("keydown",shortcutKey,shortcutOptions);update();
  return {
    sync(query=""){routeQuery=String(query);retryAllowed=false;input.value=routeQuery;update();},
    allowRetry(){retryAllowed=true;},
    destroy(){form.removeEventListener("submit",submit);input.removeEventListener("input",update);input.removeEventListener("search",nativeSearch);input.removeEventListener("compositionstart",beginComposition);input.removeEventListener("compositionend",endComposition);clear?.removeEventListener("click",clearSearch);page.removeEventListener("keydown",shortcutKey,shortcutOptions);},
  };
}
