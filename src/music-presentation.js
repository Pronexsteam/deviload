import {createMotionCover} from './music-motion.js';
import {t,onLanguageChange} from "./i18n.js";
import {flyFrom,fadeIn} from "./music-transitions.js";
import {createMusicClip} from "./music-clip.js";
import {createClipView} from "./music-clip-view.js";

// Move the existing controls into a modal, so both views share one audio player.
export function createNowPlaying({invoke,language=()=>'en',getAudio=()=>null,getLatency=()=>0,audios=[],convertFileSrc,dock,identity,artwork,info,like,transport,extras,queuePanel,button,cover,renderDockArtwork,onDownload,onHideSong,onHideArtist,onArtist,onDismissQueue}) {
  const make=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node;};
  const stage=make("dialog","music-stage is-immersive"),background=make("div","music-stage-background"),header=make("header","music-stage-header");
  stage.id="music-now-playing";background.setAttribute("aria-hidden","true");
  const brand=make("span","music-stage-brand");brand.textContent="Devil Music";
  const heading=make("span","music-eyebrow"),close=button(t("Back to browsing"),"caret-down",()=>stage.close());header.append(brand,heading,close);
  close.classList.add('music-stage-tool');
  const layout=make("div","music-stage-layout"),art=make("div","music-stage-art"),details=make("div","music-stage-details");
  const caption=make("span","music-eyebrow"),controls=make("div","music-stage-controls"),actions=make("div","music-stage-actions");
  const download=button(t("Download MP3"),"download-simple",onDownload);
  download.classList.add('music-stage-download');
  const dislike=button(t("Do not recommend this song"),"eye-slash",onHideSong),block=button(t("Do not recommend this artist"),"user-minus",onHideArtist);
  const notice=make("div","music-stage-notice");notice.hidden=true;notice.setAttribute("role","status");
  actions.append(download,dislike,block);details.append(caption,controls,actions,notice);layout.append(art,details);
  const lyricsPanel=make("aside","music-stage-lyrics");lyricsPanel.hidden=true;lyricsPanel.setAttribute("aria-label",t("Lyrics"));layout.append(lyricsPanel);
  art.inert=true;stage.append(background,header,layout);document.body.append(stage);
  const expand=button(t("Now playing"),"arrows-out",()=>open());expand.id="music-expand";
  // The music video rises out of the player's cover into its own stage above the dock.
  const dockClip=button(t('Music video'),'video-camera',()=>setClip(!clip.enabled));dockClip.id='music-clip-open';for(const name of ['pointerenter','focus'])dockClip.addEventListener(name,()=>{if(!clipView.isOpen)clip.prepare(current);});dockClip.classList.add('music-clip-toggle');
  extras.append(expand,dockClip);
  const preview=make("aside","music-playing-preview is-immersive-preview"),previewArt=button(t("Now playing"),null,()=>open(),"music-preview-art"),previewTitle=make("strong",""),previewArtist=make("span",""),previewOpen=button(t("Lyrics"),"arrows-out",()=>open(),"music-preview-open");
  const previewHeading=make("span","music-eyebrow"),previewLabel=make("span","");previewOpen.append(previewLabel);preview.hidden=true;
  previewOpen.setAttribute('aria-haspopup','dialog');previewArt.setAttribute('aria-haspopup','dialog');expand.setAttribute('aria-haspopup','dialog');
  previewArtist.setAttribute('role','button');previewArtist.tabIndex=0;previewArtist.className='music-artist-link';
  previewArtist.addEventListener('click',()=>onArtist?.(current));
  previewArtist.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onArtist?.(current);}});
  const ambient=make("div","music-preview-ambient"),scene=make('div','music-scene-backdrop'),facts=make("p","music-playing-facts"),reason=make("p","music-playing-reason");ambient.setAttribute("aria-hidden","true");scene.setAttribute('aria-hidden','true');
  const flip=make('div','music-preview-flip'),faces=make('div','music-preview-faces'),inlineLyrics=make('section','music-preview-lyrics');inlineLyrics.hidden=true;inlineLyrics.setAttribute('aria-label',t('Lyrics'));
  const flipButton=button(t('Show lyrics'),'music-notes',()=>setPreviewLyrics(!previewLyricsOn),'music-preview-toggle');
  // A word next to the note icon, so the way to the lyrics is obvious.
  const flipLabel=make('span','music-preview-toggle-label');flipButton.append(flipLabel);
  const previewTop=make('div','music-preview-top'),previewTools=make('div','music-preview-tools');previewTools.append(flipButton,previewOpen);previewTop.append(previewHeading,previewTools);faces.append(previewArt,inlineLyrics);flip.append(faces);
  preview.append(ambient,previewTop,flip,previewTitle,previewArtist,facts,reason);
  artwork.setAttribute("role","button");artwork.tabIndex=0;artwork.setAttribute("aria-haspopup","dialog");
  artwork.addEventListener("click",()=>{if(!stage.open)open();});
  artwork.addEventListener("keydown",event=>{if(!stage.open&&(event.key==="Enter"||event.key===" ")){event.preventDefault();open();}});
  let current=null,currentImage='',returnFocus=null,lyrics=null,lyricsTrigger=null,previewLyricsOn=false,flipCleanup=0;
  function setPreviewLyrics(value){
    clearTimeout(flipCleanup);previewLyricsOn=value;preview.classList.toggle('showing-lyrics',value);faces.classList.toggle('is-flipped',value);previewArt.inert=value;inlineLyrics.inert=!value;
    showMedia(current);
    flipButton.setAttribute('aria-pressed',String(value));flipButton.title=flipButton.ariaLabel=value?t('Show cover'):t('Show lyrics');flipLabel.textContent=value?t('Cover'):t('Lyrics');
    const glyph=flipButton.querySelector('.icon');if(glyph)glyph.dataset.icon=value?'image':'music-notes';
    if(value){inlineLyrics.hidden=false;if(lyrics&&!stage.open)lyrics.mount(inlineLyrics);}
    else {
      // Keep the back face painted until the return turn finishes. Hiding or
      // unmounting it immediately makes the card disappear halfway through.
      const finish=()=>{if(previewLyricsOn)return;inlineLyrics.hidden=true;if(lyrics&&!stage.open)lyrics.unmount();};
      if(matchMedia('(prefers-reduced-motion: reduce)').matches)finish();else flipCleanup=setTimeout(finish,450);
    }
  }
  let idleTimer=null,playing=false;
  const motion=createMotionCover({invoke,convertFileSrc,getHost:()=>stage.open?artwork:previewArt,isVisible:()=>stage.open||(!preview.hidden&&!previewLyricsOn&&preview.getClientRects().length>0),isPlaying:()=>playing});

  const clipView=createClipView({dock,origin:()=>artwork,button,onClose:()=>setClip(false),onQuality:height=>clip.setQuality(height),onFullscreen:on=>invoke("window_action",{action:on?"enter_fullscreen":"exit_fullscreen"}).catch(()=>{}),onLyrics:()=>syncClipLyrics()});
  // Lyrics flow to the video's captions only while the video is up and they are switched on.
  let clipLyrics=null;
  function syncClipLyrics(){
    const wanted=!!lyrics&&clipView.isOpen&&clipView.lyricsOn;
    if(wanted&&!clipLyrics)clipLyrics=lyrics.watch(state=>clipView.setLyrics(state));
    else if(!wanted&&clipLyrics){clipLyrics();clipLyrics=null;}
  }
  function setClip(on){
    if(on===clipView.isOpen)return;
    // The picture stays while the stage sinks back; the video is let go once it is gone.
    if(!on){dockClip.setAttribute('aria-pressed','false');void clipView.hide().then(()=>{syncClipLyrics();if(!clipView.isOpen&&clip.enabled)clip.toggle();});return;}
    // The full player borrows the cover; it returns to the dock before the video rises from it.
    if(stage.open){stage.close();requestAnimationFrame(()=>setClip(true));return;}
    clipView.setItem(current);clipView.show();syncClipLyrics();if(clip.enabled)clip.update(current);else clip.toggle();
  }
  const clip=createMusicClip({invoke,language,getAudio,getLatency,audios,getItem:()=>current,getHost:()=>clipView.frame,
    isVisible:()=>clipView.isOpen&&!stage.open,
    onBuffering:on=>clipView.setBuffering(on),
    onState:state=>{dockClip.setAttribute('aria-pressed',String(state.enabled));dockClip.classList.toggle('is-loading',!!state.loading);clipView.setState(state);}});
  function showMedia(item){motion.update(item);if(clipView.isOpen)clipView.setItem(item);clip.update(item);}
  const previewVisibility=new ResizeObserver(()=>showMedia(current));previewVisibility.observe(preview);
  function wake(){stage.classList.remove("music-stage-idle");clearTimeout(idleTimer);if(stage.open&&playing)idleTimer=setTimeout(()=>{if(!stage.contains(document.activeElement)||document.activeElement===close)stage.classList.add("music-stage-idle");},3500);}
  stage.addEventListener("pointermove",wake);stage.addEventListener("pointerdown",wake);stage.addEventListener("keydown",wake);
  let lyricsWanted=false;
  function syncRail(){
    const queueVisible=stage.open&&!queuePanel.hidden,visible=stage.open&&lyricsWanted&&!queueVisible;
    stage.classList.toggle('showing-stage-queue',queueVisible);stage.classList.toggle('has-lyrics',visible||queueVisible);
    if(!lyrics)return;lyricsTrigger?.setAttribute('aria-pressed',String(visible));
    if(lyricsPanel.hidden===!visible)return;lyricsPanel.hidden=!visible;
    if(visible)lyrics.mount(lyricsPanel);else lyrics.unmount();
  }
  function showLyrics(value){
    lyricsWanted=value;syncRail();
  }
  function open(){
    if(!current||stage.open)return;
    returnFocus=document.activeElement;
    const origin=artwork.getBoundingClientRect();
    artwork.replaceChildren(cover(current,"",1024));
    background.replaceChildren(cover(current,"",320));
    art.append(artwork);details.insertBefore(info,controls);controls.append(transport);actions.prepend(like);details.append(extras);
    layout.append(queuePanel);document.body.classList.add("music-stage-open");stage.showModal();if(previewLyricsOn&&!queuePanel.hidden)lyrics?.unmount();showLyrics(true);close.focus();showMedia(current);wake();fadeIn(stage);flyFrom(artwork,origin,{radius:'50%'});
  }
  stage.addEventListener("close",()=>{
    clearTimeout(idleTimer);stage.classList.remove("music-stage-idle");
    showMedia(current);background.replaceChildren();
    showLyrics(false);if(previewLyricsOn)lyrics?.mount(inlineLyrics);lyricsTrigger?.removeAttribute("aria-pressed");
    identity.append(artwork,info,like);dock.append(identity,transport,extras);document.body.append(queuePanel);
    if(renderDockArtwork)renderDockArtwork(current);else artwork.replaceChildren(cover(current,"",128));
    document.body.classList.remove("music-stage-open");showMedia(current);returnFocus?.focus();fadeIn(dock,200);
  });
  function labels(){
    stage.setAttribute("aria-label",t("Now playing"));heading.textContent=t("NOW PLAYING");caption.textContent=t("YOUR OWN FREQUENCY");lyricsPanel.setAttribute("aria-label",t("Lyrics"));
    for(const [node,label]of [[expand,t("Now playing")],[close,t("Back to browsing")],[download,t("Download MP3")],[dislike,t("Do not recommend this song")],[block,t("Do not recommend this artist")]])node.title=node.ariaLabel=label;
    previewHeading.textContent=t("NOW PLAYING");flipLabel.textContent=previewLyricsOn?t('Cover'):t('Lyrics');previewLabel.textContent=t("Open player and lyrics");previewOpen.title=previewOpen.ariaLabel=t("Open player and lyrics");previewArt.title=previewArt.ariaLabel=artwork.title=artwork.ariaLabel=t("Open player and lyrics");
    flipButton.title=flipButton.ariaLabel=previewLyricsOn?t('Show cover'):t('Show lyrics');
    dockClip.title=dockClip.ariaLabel=t('Music video');flipButton.setAttribute('aria-pressed',String(previewLyricsOn));
  }
  labels();onLanguageChange(labels);
  const api={open,syncQueueVisibility(){if(stage.open)syncRail();},attachPreview(workspace){workspace.append(scene,preview);},attachLyrics(controller,trigger){lyrics=controller;lyricsTrigger=trigger;},togglePreviewLyrics(){if(stage.open||!preview.isConnected||!preview.getClientRects().length||getComputedStyle(preview).display==='none')return false;setPreviewLyrics(!previewLyricsOn);return true;},
    toggleLyrics(){if(!stage.open)return false;if(!queuePanel.hidden){lyricsWanted=true;onDismissQueue?.();}else showLyrics(lyricsPanel.hidden);wake();return true;},update(item,downloading=false,meta={}){
    const trackChanged=current?.id!==item?.id,imageChanged=currentImage!==(item?.image||'');
    if(trackChanged||imageChanged){if(stage.open)background.replaceChildren(cover(item,"",320));previewArt.replaceChildren(cover(item,"",640));ambient.replaceChildren(cover(item,"",320));scene.replaceChildren(cover(item,"",320));}scene.hidden=!item;
    if(trackChanged){notice.hidden=true;for(const node of [previewArt,info,artwork]){node.classList.remove("music-track-arriving");requestAnimationFrame(()=>node.classList.add("music-track-arriving"));}}
    if(stage.open&&(trackChanged||imageChanged))artwork.replaceChildren(cover(item,"",1024));
    currentImage=item?.image||'';
    if(playing!==meta.playing){playing=!!meta.playing;wake();}
    const duration=Number(meta.duration)||0;facts.textContent=[duration?`${Math.floor(duration/60)}:${String(Math.floor(duration%60)).padStart(2,"0")}`:"",meta.offline?t("Downloaded music"):""].filter(Boolean).join(" · ");facts.hidden=!facts.textContent;
    reason.textContent=meta.reason||"";reason.hidden=!meta.reason;
    preview.hidden=!item;preview.parentElement?.classList.toggle("has-playing-preview",!!item);previewTitle.textContent=item?.title||"";previewArtist.textContent=item?.artists?.join(", ")||"";previewArtist.hidden=!previewArtist.textContent;artwork.setAttribute("aria-disabled",String(!item));
    current=item;showMedia(item);expand.disabled=!item;download.disabled=!item||downloading;dislike.disabled=!item;block.disabled=!item?.artists?.length;
    if(!item&&stage.open)stage.close();
  },notify(text,undo){const message=make("span","");message.textContent=text;notice.replaceChildren(message);if(undo)notice.append(button(t("Undo"),"arrow-clockwise",()=>{undo();notice.hidden=true;}));notice.hidden=false;},close(){if(stage.open)stage.close();}};
  return api;
}
