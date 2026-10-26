import {cinemaInput,createVideoSearch,videoCards} from "./cinema-discovery.js";
import {createCinemaHistory} from './cinema-history.js';

export function wireCinemaHome({invoke,t,errorText,player,onLibrary,onHome}) {
  const $=id=>document.getElementById(id),make=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const home=createVideoSearch(invoke,"home"),topic=createVideoSearch(invoke,"topic");
  let storage;try{storage=localStorage;}catch{}const history=createCinemaHistory(storage);
  let request=0,relatedRequest=0,urlPending=false,activeTopic="",urlBarrier=Promise.resolve();
  function cancelUrl(){
    if(!urlPending)return;urlPending=false;
    urlBarrier=urlBarrier.then(()=>invoke("cinema_cancel",{homeDiscovery:true,discovery:false,playback:false})).catch(()=>{});
  }
  function resetChips(){for(const chip of $("cinema-topics").children)chip.setAttribute("aria-pressed","false");}
  const themes=[[t("Nature & wildlife"),"nature wildlife documentary"],[t("Science & space"),"space science documentary"],[t("Technology"),"technology engineering documentary"],[t("Film & animation"),"Blender open movies animation"],[t("Travel"),"travel landscapes documentary"]];
  function card(item,click,compact=false){
    const button=make("button",compact?"cinema-related-card":"cinema-video-card");button.type="button";button.title=item.title;
    const picture=make("span","cinema-card-picture"),img=make("img","");img.alt="";img.loading="lazy";img.decoding="async";img.src=`https://i.ytimg.com/vi/${item.id}/${compact?"mqdefault":"hqdefault"}.jpg`;
    img.addEventListener("error",()=>img.remove(),{once:true});picture.append(img);
    if(Number.isFinite(item.duration)){const seconds=Math.floor(item.duration);picture.append(make("span","cinema-duration",`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`));}
    const copy=make("span","cinema-card-copy");copy.append(make("strong","",item.title),make("span","cinema-channel",item.channel||t("Online")));
    button.append(picture,copy);button.addEventListener("click",click);return button;
  }
  function render(rows,playlist=null){
    const grid=$("cinema-grid");grid.replaceChildren();
    for(const item of rows)grid.append(card(item,()=>player.playEntries(playlist?.entries||rows,(playlist?.entries||rows).findIndex(row=>row.id===item.id),playlist)));
  }
  function restoreHome(){const rows=history.get();render(rows);$("cinema-results-title").textContent=t(rows.length?'From your last search':'Explore a topic');$("cinema-home-status").textContent=t(rows.length?'Pick up where you left off, or search for something new.':'Choose a topic or search for a video.');}
  async function search(value,immediate=true){
    const input=cinemaInput(value),token=++request;home.cancel();
    cancelUrl();
    $("cinema-home-status").textContent=input.kind==="empty"?t("Choose a topic or search for a video."):t("Searching videos…");
    $("cinema-results-title").textContent=activeTopic?t(activeTopic):t("Search results");
    if(input.kind==="empty"){restoreHome();return;}
    try{
      if(input.kind==="url"){
        await urlBarrier;if(token!==request)return;
        urlPending=true;const page=await invoke("cinema_entries",{address:input.value,start:1,lane:"home"});if(token!==request)return;
        urlPending=false;const entries=page.entries.map(item=>({...item,kind:"online-video"}));
        history.remember(videoCards(entries));render(videoCards(entries),{entries,address:input.value,next:page.next});$("cinema-results-title").textContent=page.title;
        $("cinema-home-status").textContent=t("Playlist order is preserved. Select a video to play.");
      }else{
        const rows=await home.search(input.value,{immediate});if(token!==request||rows===null)return;
        history.remember(rows);render(rows);$("cinema-home-status").textContent=rows.length?t("Videos matching your search. Not personalized."):t("No videos found. Try another search.");
      }
    }catch(error){if(token===request)$("cinema-home-status").textContent=errorText(error);}
    finally{if(token===request)urlPending=false;}
  }
  $("cinema-home-form").addEventListener("submit",event=>{event.preventDefault();activeTopic="";resetChips();search($("cinema-home-url").value);});
  $("cinema-home-url").addEventListener("input",()=>{
    activeTopic="";resetChips();const value=$("cinema-home-url").value;
    if(cinemaInput(value).kind==="text"&&value.trim().length>=3)search(value,false);
    else{request++;home.cancel();cancelUrl();restoreHome();}
  });
  for(const [label,query]of themes){const button=make("button","cinema-topic",t(label));button.type="button";button.addEventListener("click",()=>{activeTopic=label;$("cinema-home-url").value=query;for(const chip of $("cinema-topics").children)chip.setAttribute("aria-pressed",String(chip===button));search(query);});button.setAttribute("aria-pressed","false");$("cinema-topics").append(button);}
  $("cinema-home-library").addEventListener("click",onLibrary);
  $("cinema-home-open").addEventListener("click",()=>player.openOnline());
  restoreHome();
  return {
    search(value){onHome();$("cinema-home-url").value=value;activeTopic="";resetChips();search(value);},
    async current(item){
      const token=++relatedRequest;topic.cancel();$("cinema-related").replaceChildren();$("cinema-related-status").textContent="";
      if(item?.kind!=="online-video")return;
      const query=String(item.channel||item.title).slice(0,120);$("cinema-related-status").textContent=t("Searching videos…");
      try{
        const rows=await topic.search(query,{immediate:true});if(token!==relatedRequest||rows===null)return;
        $("cinema-related-status").textContent=t("Search based on: {query}",{query});
        for(const row of videoCards(rows,item.id).slice(0,8))$("cinema-related").append(card(row,()=>player.playRelated(row),true));
      }catch(error){if(token===relatedRequest)$("cinema-related-status").textContent=errorText(error);}
    },
    close(){relatedRequest++;topic.cancel();},
    cancel(){request++;home.cancel();cancelUrl();}
  };
}
