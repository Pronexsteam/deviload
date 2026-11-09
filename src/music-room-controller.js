import {t,errorText,onLanguageChange} from './i18n.js';
import {roomPosition,roomCorrection} from './music-room-sync.js';
export function createMusicRoom({invoke,button,extras,getState,getAudio,playTrack,onEnter,onLeave,notify,onModeChange=()=>{}}){
 let mode='',link='',pending=false,starting=false,generation=0,failures=0,lastTrack='',loading=false,retryAt=0,live=false;
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const dialog=node('dialog');dialog.className='music-room-dialog music-import-dialog';
 const head=node('header');head.className='music-library-dialog-head';const title=node('h2');
 const close=button(t('Close'),'x-circle',()=>dialog.close());head.append(title,close);
 const help=node('p'),privacy=node('p'),state=node('p');state.role='status';
 const field=node('input');field.type='url';field.autocomplete='off';field.spellcheck=false;field.className='music-room-link';
 const create=button(t('Create listening room'),null,async()=>{
  if(mode||starting)return;starting=true;const token=++generation;refresh();state.textContent=t('Starting the room. The first launch downloads a verified Cloudflare component (53 MB).');
  try{const result=await invoke('music_room_create',{state:getState()});if(token!==generation){await invoke('music_room_stop');return;}mode='host';onModeChange(mode);link=result;linkField.value=link;lastTrack='';live=false;refresh();state.textContent=t('Room ready. Send the full link to your friend.');tick();}
  catch(error){state.textContent=errorText(error);}finally{starting=false;refresh();}
 },'music-primary');
 const join=button(t('Join listening room'),null,async()=>{
  if(mode||starting)return;starting=true;const token=++generation;refresh();state.textContent=t('Connecting to the listening room…');
  try{const invitation=field.value.trim(),packet=await invoke('music_room_poll',{link:invitation});if(token!==generation)return;onEnter();mode='guest';onModeChange(mode);link=invitation;lastTrack='';retryAt=0;failures=0;const applied=await apply(packet,token);if(applied!==false&&token===generation){live=true;state.textContent=t('Listening together. The host controls playback; your volume stays yours.');}}
  catch(error){state.textContent=errorText(error);}finally{starting=false;refresh();}
 },'outline small');
 async function leave(){const previous=mode;++generation;if(previous==='guest')getAudio().pause();mode='';link='';lastTrack='';retryAt=0;live=false;getAudio().playbackRate=1;onModeChange(mode);if(previous==='guest')onLeave();await invoke('music_room_stop').catch(()=>{});state.textContent=t('You left the listening room.');refresh();}
 const stop=button(t('Leave listening room'),null,leave,'outline small');
 const copy=button(t('Copy room link'),'link-simple',async()=>{try{if(window.__TAURI__?.clipboardManager)await window.__TAURI__.clipboardManager.writeText(link);else await navigator.clipboard.writeText(link);state.textContent=t('Room link copied.');}catch{linkField.focus();linkField.select();state.textContent=t('Select and copy the full room link.');}},'music-primary music-room-copy');
 // Before a room: two choices as cards. In a room: its state, the link to share and who is in control.
 const card=(cls,...controls)=>{const box=node('section');box.className='music-room-card '+cls;box.append(node('h3'),node('p'),...controls);return box;};
 const joinRow=node('div');joinRow.className='music-room-join';joinRow.append(field,join);
 const hostCard=card('is-host',create);
 const guestCard=card('is-guest',joinRow);
 const choices=node('div');choices.className='music-room-choices';choices.append(hostCard,guestCard);
 const linkField=node('input');linkField.type='text';linkField.readOnly=true;linkField.className='music-room-link';
 const share=node('div');share.className='music-room-share';share.append(linkField,copy);
 const pulse=node('span');pulse.className='music-room-pulse';pulse.setAttribute('aria-hidden','true');
 const stateRow=node('div');stateRow.className='music-room-state';stateRow.append(pulse,state);
 const control=node('p');control.className='music-room-control';
 const room=node('section');room.className='music-room-live';room.append(stateRow,share,control,stop);
 const about=node('details');about.className='music-room-about';const aboutTitle=node('summary');about.append(aboutTitle,help,privacy);
 const intro=node('p');intro.className='music-room-intro';
 dialog.append(head,intro,choices,room,about);document.body.append(dialog);
 const trigger=button(t('Listen together'),'users',()=>{if(!dialog.open){dialog.showModal();(mode?copy:create).focus({focusVisible:false});}});trigger.id='music-room-open';trigger.setAttribute('aria-haspopup','dialog');extras.append(trigger);
 function refresh(){title.textContent=t('Listen together');help.textContent=t('Experimental internet room for two PCs. Create a room and send its link; your friend joins in Deviload.');privacy.textContent=t('Cloudflare carries only the track and playback clock. Each PC plays audio from its own source. Keep the host app open. Guest listening does not train recommendations.');field.placeholder=t('Paste a listening room link');field.ariaLabel=t('Paste a listening room link');field.readOnly=!!mode;create.disabled=join.disabled=!!mode||starting;copy.hidden=mode!=='host';stop.hidden=!mode&&!starting;trigger.setAttribute('aria-pressed',String(!!mode));trigger.title=trigger.ariaLabel=t('Listen together');
  intro.textContent=t('Hear the same song as a friend on another PC, at the same moment.');aboutTitle.textContent=t('How it works');
  hostCard.querySelector('h3').textContent=t('Start a room');hostCard.querySelector('p').textContent=t('You pick the music. Your friend hears the same song at the same moment.');
  guestCard.querySelector('h3').textContent=t('Join a friend');guestCard.querySelector('p').textContent=t('Paste the link your friend sent you.');
  choices.hidden=!!mode||starting;room.hidden=!mode&&!starting;share.hidden=mode!=='host';
  room.dataset.state=!mode?'starting':live?'live':'waiting';
  control.textContent=mode==='host'?t('You control playback. Your friend hears what you play.'):mode==='guest'?t('Your friend controls playback. Your volume stays yours.'):'';}
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
  try{if(mode==='host'){const result=await invoke('music_room_update',{state:getState()});if(token===generation){live=!!result.connected;state.textContent=result.connected?t('Your friend is connected.'):t('Room ready. Send the full link to your friend.');refresh();}}
   else{const packet=await invoke('music_room_poll',{link});if(token!==generation)return;const applied=await apply(packet,token);if(applied!==false&&token===generation){failures=0;live=true;state.textContent=t('Listening together. The host controls playback; your volume stays yours.');refresh();}}}
  catch(error){if(token!==generation)return;state.textContent=errorText(error);live=false;refresh();if(mode==='guest'&&++failures>=3){getAudio().pause();state.textContent=t('Room connection lost. Playback paused; reconnecting…');}}
  finally{pending=false;}
 }
 refresh();onLanguageChange(refresh);setInterval(tick,600);
 window.addEventListener('pagehide',()=>{if(mode==='host')invoke('music_room_stop').catch(()=>{});});
 return {isGuest:()=>mode==='guest',leave};
}
