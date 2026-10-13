import {t,onLanguageChange} from "./i18n.js";

// Move the existing controls into a modal, so both views share one audio player.
export function createNowPlaying({dock,identity,artwork,info,like,transport,extras,queuePanel,button,cover,onDownload,onHideSong,onHideArtist}) {
  const make=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node;};
  const stage=make("dialog","music-stage"),background=make("div","music-stage-background"),header=make("header","music-stage-header");
  stage.id="music-now-playing";background.setAttribute("aria-hidden","true");
  const brand=make("span","music-stage-brand");brand.textContent="Devil Music";
  const heading=make("span","music-eyebrow"),close=button(t("Back to browsing"),"caret-down",()=>stage.close());header.append(brand,heading,close);
  const layout=make("div","music-stage-layout"),art=make("div","music-stage-art"),details=make("div","music-stage-details");
  const caption=make("span","music-eyebrow"),controls=make("div","music-stage-controls"),actions=make("div","music-stage-actions");
  const download=button(t("Download MP3"),"download-simple",onDownload);
  const dislike=button(t("Do not recommend this song"),"eye-slash",onHideSong),block=button(t("Do not recommend this artist"),"user-minus",onHideArtist);
  const notice=make("div","music-stage-notice");notice.hidden=true;notice.setAttribute("role","status");
  actions.append(download,dislike,block);details.append(caption,controls,actions,notice);layout.append(art,details);
  stage.append(background,header,layout);document.body.append(stage);
  const expand=button(t("Now playing"),"arrows-out",()=>open());expand.id="music-expand";extras.append(expand);
  let current=null,returnFocus=null;
  function open(){
    if(!current)return;
    returnFocus=document.activeElement;
    art.append(artwork);details.insertBefore(info,controls);controls.append(transport);actions.prepend(like);details.append(extras);
    stage.append(queuePanel);document.body.classList.add("music-stage-open");stage.showModal();close.focus();
  }
  stage.addEventListener("close",()=>{
    identity.append(artwork,info,like);dock.append(identity,transport,extras);document.body.append(queuePanel);
    document.body.classList.remove("music-stage-open");returnFocus?.focus();
  });
  function labels(){
    stage.setAttribute("aria-label",t("Now playing"));heading.textContent=t("NOW PLAYING");caption.textContent=t("YOUR OWN FREQUENCY");
    for(const [node,label]of [[expand,t("Now playing")],[close,t("Back to browsing")],[download,t("Download MP3")],[dislike,t("Do not recommend this song")],[block,t("Do not recommend this artist")]])node.title=node.ariaLabel=label;
  }
  labels();onLanguageChange(labels);
  return {update(item,downloading=false){
    if(current?.id!==item?.id){background.replaceChildren(cover(item));notice.hidden=true;}
    current=item;expand.disabled=!item;download.disabled=!item||downloading;dislike.disabled=!item;block.disabled=!item?.artists?.length;
    if(!item&&stage.open)stage.close();
  },notify(text,undo){const message=make("span","");message.textContent=text;notice.replaceChildren(message);if(undo)notice.append(button(t("Undo"),"arrow-clockwise",()=>{undo();notice.hidden=true;}));notice.hidden=false;},close(){if(stage.open)stage.close();}};
}
