import {t,errorText,onLanguageChange} from './i18n.js';
import {roomPosition,roomCorrection} from './music-room-sync.js';
export function createMusicRoom({invoke,button,extras,getState,getAudio,playTrack,onEnter,onLeave,notify}){
 let mode='',link='',pending=false,starting=false,generation=0,failures=0,lastTrack='',loading=false,retryAt=0;
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const dialog=node('dialog');dialog.className='music-room-dialog music-import-dialog';
 const head=node('header');head.className='music-library-dialog-head';const title=node('h2');
 const close=button(t('Close'),'x-circle',()=>dialog.close());head.append(title,close);
 const help=node('p'),privacy=node('p'),state=node('p');state.role='status';
 const field=node('input');field.type='url';field.autocomplete='off';field.spellcheck=false;field.className='music-room-link';
 const create=button(t('Create listening room'),null,async()=>{
  if(mode||starting)return;starting=true;const token=++generation;refresh();state.textContent=t('Starting the room. The first launch downloads a verified Cloudflare component (53 MB).');
  try{const result=await invoke('music_room_create',{state:getState()});if(token!==generation){await invoke('music_room_stop');return;}mode='host';link=result;field.value=link;lastTrack='';refresh();state.textContent=t('Room ready. Send the full link to your friend.');tick();}
  catch(error){state.textContent=errorText(error);}finally{starting=false;refresh();}
 },'music-primary');
 const join=button(t('Join listening room'),null,async()=>{
  if(mode||starting)return;starting=true;const token=++generation;refresh();state.textContent=t('Connecting to the listening room…');
  try{const invitation=field.value.trim(),packet=await invoke('music_room_poll',{link:invitation});if(token!==generation)return;onEnter();mode='guest';link=invitation;lastTrack='';retryAt=0;failures=0;const applied=await apply(packet,token);if(applied!==false&&token===generation)state.textContent=t('Listening together. The host controls playback; your volume stays yours.');}
  catch(error){state.textContent=errorText(error);}finally{starting=false;refresh();}
 },'outline small');
 async function leave(){const previous=mode;++generation;if(previous==='guest')getAudio().pause();mode='';link='';lastTrack='';retryAt=0;getAudio().playbackRate=1;if(previous==='guest')onLeave();await invoke('music_room_stop').catch(()=>{});state.textContent=t('You left the listening room.');refresh();}
 const stop=button(t('Leave listening room'),null,leave,'outline small');
 const copy=button(t('Copy room link'),null,async()=>{try{if(window.__TAURI__?.clipboardManager)await window.__TAURI__.clipboardManager.writeText(link);else await navigator.clipboard.writeText(link);state.textContent=t('Room link copied.');}catch{field.focus();field.select();state.textContent=t('Select and copy the full room link.');}},'outline small');
 const actions=node('div');actions.className='music-room-actions';actions.append(create,join,copy,stop);dialog.append(head,help,privacy,field,actions,state);document.body.append(dialog);
 const trigger=button(t('Listen together'),'users',()=>{if(!dialog.open)dialog.showModal();field.focus();});trigger.id='music-room-open';trigger.setAttribute('aria-haspopup','dialog');extras.append(trigger);
 function refresh(){title.textContent=t('Listen together');help.textContent=t('Experimental internet room for two PCs. Create a room and send its link; your friend joins in Deviload 2.7.9.');privacy.textContent=t('Cloudflare carries only the track and playback clock. Each PC plays audio from its own source. Keep the host app open. Guest listening does not train recommendations.');field.placeholder=t('Paste a listening room link');field.ariaLabel=t('Paste a listening room link');field.readOnly=!!mode;create.disabled=join.disabled=!!mode||starting;copy.hidden=mode!=='host';stop.hidden=!mode&&!starting;trigger.setAttribute('aria-pressed',String(!!mode));trigger.title=trigger.ariaLabel=t('Listen together');}
 async function apply(packet,token){
  if(token!==generation||mode!=='guest')return;const received=performance.now(),s=packet.state;
  if(!s.id){getAudio().pause();return;}
  if(lastTrack!==s.id){if(performance.now()<retryAt)return false;loading=true;try{await playTrack({kind:'song',id:s.id,title:s.title||s.id,artists:s.artists,image:s.image},roomPosition(packet));if(token!==generation)return;lastTrack=s.id;retryAt=0;}catch(error){retryAt=performance.now()+10000;throw error;}finally{loading=false;}}
  if(token!==generation||mode!=='guest')return;
  const audio=getAudio();if(audio.error){lastTrack='';retryAt=performance.now()+10000;return false;}if(audio.readyState<1)return false;
  const expected=roomPosition(packet,performance.now()-received),correction=roomCorrection(audio.currentTime,expected);
  if(!s.playing&&Math.abs(audio.currentTime-expected)>.05)correction.seek=expected;
  if(correction.seek!==null)audio.currentTime=Math.min(correction.seek,Number.isFinite(audio.duration)?Math.max(0,audio.duration-.05):correction.seek);
  audio.playbackRate=s.playing?correction.rate:1;
  if(s.playing&&audio.paused)await audio.play();else if(!s.playing&&!audio.paused)audio.pause();
 }
 async function tick(){if(!mode||pending||loading)return;pending=true;const token=generation;
  try{if(mode==='host'){const result=await invoke('music_room_update',{state:getState()});if(token===generation)state.textContent=result.connected?t('Your friend is connected.'):t('Room ready. Send the full link to your friend.');}
   else{const packet=await invoke('music_room_poll',{link});if(token!==generation)return;const applied=await apply(packet,token);if(applied!==false&&token===generation){failures=0;state.textContent=t('Listening together. The host controls playback; your volume stays yours.');}}}
  catch(error){if(token!==generation)return;state.textContent=errorText(error);if(mode==='guest'&&++failures>=3){getAudio().pause();state.textContent=t('Room connection lost. Playback paused; reconnecting…');}}
  finally{pending=false;}
 }
 refresh();onLanguageChange(refresh);setInterval(tick,600);
 window.addEventListener('pagehide',()=>{if(mode==='host')invoke('music_room_stop').catch(()=>{});});
 return {isGuest:()=>mode==='guest',leave};
}
