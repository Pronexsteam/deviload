export const cinemaTime=value=>{const n=Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;return n>=3600?`${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`:`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
export const seekTarget=(position,delta,duration)=>Math.max(0,Math.min(Number.isFinite(duration)?duration:0,(Number(position)||0)+delta));

export function wireCinemaControls({dialog,video,audio,invoke,t,onLanguageChange=()=>{}}){
 const stage=dialog.querySelector('.cinema-stage'),head=dialog.querySelector('.dialog-head');if(!stage||!head)return null;
 const make=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node;};
 const labels=[];
 function label(node,value){node.title=node.ariaLabel=t(value);}
 function button(name,glyph,action,parent){const node=make('button','cinema-control-button');node.type='button';const icon=make('span','icon');icon.dataset.icon=glyph;icon.ariaHidden='true';node.append(icon);label(node,name);labels.push([node,name]);node.addEventListener('click',action);parent.append(node);return node;}
 const headActions=make('div','cinema-window-actions');head.insertBefore(headActions,head.lastElementChild);
 button('Maximize or restore window','arrows-out',()=>invoke('window_action',{action:'toggle_maximize'}).catch(()=>{}),headActions);
 head.title=t('Drag to move the window');head.addEventListener('pointerdown',e=>{if(e.button===0&&!e.target.closest('button,input,select,a'))invoke('window_action',{action:'start_dragging'}).catch(()=>{});});
 head.addEventListener('dblclick',e=>{if(!e.target.closest('button,input,select,a'))invoke('window_action',{action:'toggle_maximize'}).catch(()=>{});});
 const controls=make('div','cinema-media-controls'),seek=make('input','cinema-seek');seek.type='range';seek.min='0';seek.max='1';seek.step='any';seek.value='0';label(seek,'Playback position');
 const row=make('div','cinema-control-row');controls.append(seek,row);stage.append(controls);stage.tabIndex=0;
 const current=()=>!video.hidden?video:!audio.hidden?audio:null;
 let dragging=false,frame=0,lastFrame=0,hideTimer=0,lastVolume=.7;
 const flash=()=>{stage.classList.add('controls-visible');clearTimeout(hideTimer);if(current()&&!current().paused)hideTimer=setTimeout(()=>stage.classList.remove('controls-visible'),2200);};
 const move=delta=>{const m=current();if(m&&Number.isFinite(m.duration))m.currentTime=seekTarget(m.currentTime,delta,m.duration);flash();};
 const toggle=()=>{const m=current();if(!m||!m.getAttribute('src'))return;m.paused?m.play().catch(()=>flash()):m.pause();};
 const play=button('Play','play',toggle,row);
 const backward=button('Back 10 seconds','skip-back',()=>move(-10),row),forward=button('Forward 10 seconds','skip-forward',()=>move(10),row);
 const mute=button('Mute','speaker-high',()=>{const m=current();if(m){m.muted=!m.muted;if(!m.muted&&m.volume===0)m.volume=lastVolume||.7;}},row);
 const volume=make('input','cinema-volume');volume.type='range';volume.min='0';volume.max='1';volume.step='.01';volume.value='.7';label(volume,'Volume');row.append(volume);
 const clock=make('span','cinema-clock');row.append(clock);
 const rate=make('select','cinema-rate');label(rate,'Playback speed');for(const value of [.5,.75,1,1.25,1.5,1.75,2]){const option=make('option','');option.value=String(value);option.textContent=value+'×';option.selected=value===1;rate.append(option);}row.append(rate);
 const captions=button('Subtitles','music-notes',()=>{const track=video.textTracks[0];if(track){track.mode=track.mode==='showing'?'hidden':'showing';paint();}},row);
 const theater=button('Theater mode','mini-player',()=>{dialog.classList.toggle('cinema-theater');theater.setAttribute('aria-pressed',String(dialog.classList.contains('cinema-theater')));flash();},row);
 const full=button('Fullscreen','arrows-out',()=>{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});else stage.requestFullscreen?.().catch(()=>{});},row);
 document.addEventListener('fullscreenchange',()=>{full.setAttribute('aria-pressed',String(document.fullscreenElement===stage));flash();});
 let gain=.7;try{const saved=Number(localStorage.getItem('deviload-cinema-volume'));if(localStorage.getItem('deviload-cinema-volume')!==null&&Number.isFinite(saved))gain=Math.max(0,Math.min(1,saved));}catch{}
 for(const m of [video,audio]){m.controls=false;m.volume=gain;}
 function paint(){const m=current(),duration=m?.duration||0,position=m?.currentTime||0,ready=!!m?.getAttribute('src');play.disabled=backward.disabled=forward.disabled=rate.disabled=!ready;seek.disabled=!ready||!Number.isFinite(duration)||duration<=0;
  if(!dragging)seek.value=Number.isFinite(duration)&&duration>0?String(position/duration):'0';seek.style.setProperty('--played',Number(seek.value)*100+'%');
  clock.textContent=cinemaTime(dragging?Number(seek.value)*duration:position)+' / '+cinemaTime(duration);label(play,m&&!m.paused?'Pause':'Play');play.firstChild.dataset.icon=m&&!m.paused?'pause':'play';stage.classList.toggle('is-paused',!m||m.paused);stage.classList.toggle('has-media',ready);
  volume.value=String(m?.volume??gain);volume.style.setProperty('--played',Number(volume.value)*100+'%');mute.setAttribute('aria-pressed',String(!!m?.muted||m?.volume===0));label(mute,m?.muted?'Unmute':'Mute');if(m)rate.value=String(m.playbackRate);
  captions.disabled=m!==video||!video.textTracks.length;captions.setAttribute('aria-pressed',String(video.textTracks[0]?.mode==='showing'));
 }
 function loop(at){frame=0;if(!dialog.open||!current()||current().paused||document.hidden)return;if(at-lastFrame>33){paint();lastFrame=at;}frame=requestAnimationFrame(loop);}
 function update(){paint();cancelAnimationFrame(frame);frame=0;if(dialog.open&&current()&&!current().paused&&!document.hidden)frame=requestAnimationFrame(loop);}
 function setVolume(value){gain=Math.max(0,Math.min(1,value));if(gain>0)lastVolume=gain;for(const m of [video,audio]){m.volume=gain;m.muted=false;}try{localStorage.setItem('deviload-cinema-volume',String(gain));}catch{}paint();}
 volume.addEventListener('input',()=>setVolume(Number(volume.value)));volume.addEventListener('wheel',e=>{e.preventDefault();setVolume(Number(volume.value)+(e.deltaY<0?.05:-.05));},{passive:false});
 seek.addEventListener('input',()=>{dragging=true;paint();});seek.addEventListener('change',()=>{const m=current();if(m&&Number.isFinite(m.duration))m.currentTime=Number(seek.value)*m.duration;dragging=false;paint();});seek.addEventListener('blur',()=>{dragging=false;paint();});
 rate.addEventListener('change',()=>{for(const m of [video,audio])m.playbackRate=Number(rate.value);});
 for(const m of [video,audio])for(const name of ['play','pause','loadedmetadata','emptied','timeupdate','volumechange','ratechange','ended'])m.addEventListener(name,()=>{update();if(name==='play'||name==='pause')flash();});
 video.textTracks.addEventListener('addtrack',paint);video.textTracks.addEventListener('removetrack',paint);
 video.addEventListener('click',toggle);video.addEventListener('dblclick',()=>full.click());stage.addEventListener('pointermove',flash);stage.addEventListener('focusin',flash);document.addEventListener('visibilitychange',update);
 dialog.addEventListener('keydown',e=>{if(e.ctrlKey||e.altKey||e.metaKey||e.target.closest('input,textarea,select,[contenteditable=true]'))return;const key=e.key.toLowerCase();if(e.target.closest('button')&&(key===' '||key==='enter'))return;
  if(key===' '||key==='k')toggle();else if(key==='arrowleft'||key==='j')move(key==='j'?-10:-5);else if(key==='arrowright'||key==='l')move(key==='l'?10:5);else if(key==='m')mute.click();else if(key==='f')full.click();else if(key==='t')theater.click();else if(key==='arrowup'||key==='arrowdown')setVolume(Number(volume.value)+(key==='arrowup'?.05:-.05));else return;e.preventDefault();flash();
 });
 dialog.addEventListener('close',()=>{cancelAnimationFrame(frame);clearTimeout(hideTimer);dragging=false;if(document.fullscreenElement===stage)document.exitFullscreen().catch(()=>{});});
 onLanguageChange(()=>{for(const [node,value]of labels)label(node,value);label(seek,'Playback position');label(volume,'Volume');label(rate,'Playback speed');head.title=t('Drag to move the window');paint();});
 paint();return {update};
}
