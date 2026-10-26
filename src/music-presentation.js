import {t,onLanguageChange} from "./i18n.js";

// Move the existing controls into a modal, so both views share one audio player.
export function createNowPlaying({dock,identity,artwork,info,like,transport,extras,queuePanel,button,cover,renderDockArtwork,onDownload,onHideSong,onHideArtist,onArtist}) {
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
  const lyricsPanel=make("aside","music-stage-lyrics");lyricsPanel.hidden=true;lyricsPanel.setAttribute("aria-label",t("Lyrics"));layout.append(lyricsPanel);
  stage.append(background,header,layout);document.body.append(stage);
  const expand=button(t("Now playing"),"arrows-out",()=>open());expand.id="music-expand";extras.append(expand);
  const preview=make("aside","music-playing-preview"),previewArt=button(t("Now playing"),null,()=>open(),"music-preview-art"),previewTitle=make("strong",""),previewArtist=make("span",""),previewOpen=button(t("Lyrics"),"arrows-out",()=>open(),"music-preview-open");
  const previewHeading=make("span","music-eyebrow"),previewLabel=make("span","");previewOpen.append(previewLabel);preview.hidden=true;
  previewArtist.setAttribute('role','button');previewArtist.tabIndex=0;previewArtist.className='music-artist-link';
  previewArtist.addEventListener('click',()=>onArtist?.(current));
  previewArtist.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onArtist?.(current);}});
  const ambient=make("div","music-preview-ambient"),facts=make("p","music-playing-facts"),reason=make("p","music-playing-reason");ambient.setAttribute("aria-hidden","true");
  const flip=make('div','music-preview-flip'),faces=make('div','music-preview-faces'),inlineLyrics=make('section','music-preview-lyrics');inlineLyrics.hidden=true;inlineLyrics.setAttribute('aria-label',t('Lyrics'));
  const flipButton=button(t('Show lyrics'),'music-notes',()=>setPreviewLyrics(!previewLyricsOn),'music-preview-toggle');
  const previewTop=make('div','music-preview-top');previewTop.append(previewHeading,flipButton);faces.append(previewArt,inlineLyrics);flip.append(faces);
  preview.append(ambient,previewTop,flip,previewTitle,previewArtist,facts,reason,previewOpen);
  artwork.setAttribute("role","button");artwork.tabIndex=0;artwork.setAttribute("aria-haspopup","dialog");
  artwork.addEventListener("click",()=>{if(!stage.open)open();});
  artwork.addEventListener("keydown",event=>{if(!stage.open&&(event.key==="Enter"||event.key===" ")){event.preventDefault();open();}});
  let current=null,returnFocus=null,lyrics=null,lyricsTrigger=null,previewLyricsOn=false,flipCleanup=0;
  function setPreviewLyrics(value){
    clearTimeout(flipCleanup);previewLyricsOn=value;preview.classList.toggle('showing-lyrics',value);faces.classList.toggle('is-flipped',value);previewArt.inert=value;inlineLyrics.inert=!value;
    flipButton.setAttribute('aria-pressed',String(value));flipButton.title=flipButton.ariaLabel=value?t('Show cover'):t('Show lyrics');
    if(value){inlineLyrics.hidden=false;if(lyrics&&!stage.open)lyrics.mount(inlineLyrics);}
    else {
      // Keep the back face painted until the return turn finishes. Hiding or
      // unmounting it immediately makes the card disappear halfway through.
      const finish=()=>{if(previewLyricsOn)return;inlineLyrics.hidden=true;if(lyrics&&!stage.open)lyrics.unmount();};
      if(matchMedia('(prefers-reduced-motion: reduce)').matches)finish();else flipCleanup=setTimeout(finish,450);
    }
  }
  let idleTimer=null,playing=false;
  function wake(){stage.classList.remove("music-stage-idle");clearTimeout(idleTimer);if(stage.open&&playing)idleTimer=setTimeout(()=>{if(!stage.contains(document.activeElement)||document.activeElement===close)stage.classList.add("music-stage-idle");},3500);}
  stage.addEventListener("pointermove",wake);stage.addEventListener("pointerdown",wake);stage.addEventListener("keydown",wake);
  function showLyrics(value){
    if(!lyrics)return;lyricsPanel.hidden=!value;stage.classList.toggle("has-lyrics",value);
    lyricsTrigger?.setAttribute("aria-pressed",String(value));
    if(value)lyrics.mount(lyricsPanel);else if(previewLyricsOn&&!stage.open)lyrics.mount(inlineLyrics);else lyrics.unmount();
  }
  function open(){
    if(!current||stage.open)return;
    returnFocus=document.activeElement;
    artwork.replaceChildren(cover(current,"",1024));
    art.append(artwork);details.insertBefore(info,controls);controls.append(transport);actions.prepend(like);details.append(extras);
    stage.append(queuePanel);document.body.classList.add("music-stage-open");stage.showModal();showLyrics(true);close.focus();wake();
  }
  stage.addEventListener("close",()=>{
    clearTimeout(idleTimer);stage.classList.remove("music-stage-idle");
    showLyrics(false);lyricsTrigger?.removeAttribute("aria-pressed");
    identity.append(artwork,info,like);dock.append(identity,transport,extras);document.body.append(queuePanel);
    if(renderDockArtwork)renderDockArtwork(current);else artwork.replaceChildren(cover(current,"",128));
    document.body.classList.remove("music-stage-open");returnFocus?.focus();
  });
  function labels(){
    stage.setAttribute("aria-label",t("Now playing"));heading.textContent=t("NOW PLAYING");caption.textContent=t("YOUR OWN FREQUENCY");lyricsPanel.setAttribute("aria-label",t("Lyrics"));
    for(const [node,label]of [[expand,t("Now playing")],[close,t("Back to browsing")],[download,t("Download MP3")],[dislike,t("Do not recommend this song")],[block,t("Do not recommend this artist")]])node.title=node.ariaLabel=label;
    previewHeading.textContent=t("NOW PLAYING");previewLabel.textContent=t("Open player and lyrics");previewOpen.title=previewOpen.ariaLabel=t("Open player and lyrics");previewArt.title=previewArt.ariaLabel=artwork.title=artwork.ariaLabel=t("Open player and lyrics");
    flipButton.title=flipButton.ariaLabel=previewLyricsOn?t('Show cover'):t('Show lyrics');flipButton.setAttribute('aria-pressed',String(previewLyricsOn));
  }
  labels();onLanguageChange(labels);
  return {open,attachPreview(workspace){workspace.append(preview);},attachLyrics(controller,trigger){lyrics=controller;lyricsTrigger=trigger;},toggleLyrics(){if(!stage.open)return false;showLyrics(lyricsPanel.hidden);wake();return true;},update(item,downloading=false,meta={}){
    if(current?.id!==item?.id){background.replaceChildren(cover(item));previewArt.replaceChildren(cover(item,"",640));ambient.replaceChildren(cover(item));notice.hidden=true;for(const node of [previewArt,info]){node.classList.remove("music-track-arriving");requestAnimationFrame(()=>node.classList.add("music-track-arriving"));}}
    if(stage.open&&current?.id!==item?.id)artwork.replaceChildren(cover(item,"",1024));
    if(playing!==meta.playing){playing=!!meta.playing;wake();}
    const duration=Number(meta.duration)||0;facts.textContent=[duration?`${Math.floor(duration/60)}:${String(Math.floor(duration%60)).padStart(2,"0")}`:"",meta.offline?t("Downloaded music"):""].filter(Boolean).join(" · ");facts.hidden=!facts.textContent;
    reason.textContent=meta.reason||"";reason.hidden=!meta.reason;
    preview.hidden=!item;preview.parentElement?.classList.toggle("has-playing-preview",!!item);previewTitle.textContent=item?.title||"";previewArtist.textContent=item?.artists?.join(", ")||"";artwork.setAttribute("aria-disabled",String(!item));
    current=item;expand.disabled=!item;download.disabled=!item||downloading;dislike.disabled=!item;block.disabled=!item?.artists?.length;
    if(!item&&stage.open)stage.close();
  },notify(text,undo){const message=make("span","");message.textContent=text;notice.replaceChildren(message);if(undo)notice.append(button(t("Undo"),"arrow-clockwise",()=>{undo();notice.hidden=true;}));notice.hidden=false;},close(){if(stage.open)stage.close();}};
}
