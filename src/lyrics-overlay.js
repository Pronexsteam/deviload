import {t,onLanguageChange} from './i18n.js';

// The floating lyrics strip. It receives one line at a time with the song position, and times the
// word highlight itself so the main window does not have to send every frame.
const $=id=>document.getElementById(id),invoke=window.__TAURI__.core.invoke;
const strip=$('strip'),line=$('line'),next=$('next'),lock=$('strip-lock'),close=$('strip-close');
let state=null,receivedAt=0,shownKey='',frame=0;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');

function labels(){
  lock.title=lock.ariaLabel=t('Let clicks pass through');lock.textContent='🔒';
  close.title=close.ariaLabel=t('Close lyrics on the desktop');close.textContent='×';
}
labels();onLanguageChange(labels);

const now=()=>!state?0:state.position+(state.playing?(performance.now()-receivedAt)/1000*(state.rate||1):0);

// A new line slides up; the previous one leaves upwards.
function render(){
  const current=state?.line||{};const key=`${state?.id}|${current.at}|${current.text}`;
  if(key===shownKey)return;
  shownKey=key;
  const words=current.words?.length?current.words:null;
  const fresh=document.createElement('p');fresh.className='lyrics-strip-line';fresh.id='line';fresh.setAttribute('aria-live','polite');
  if(words)fresh.append(...words.map(word=>{const span=document.createElement('span');span.className='lyrics-strip-word';span.textContent=word.text;span.dataset.at=word.at;span.dataset.end=word.end;return span;}));
  else fresh.textContent=current.text||'♪';
  fresh.classList.toggle('is-words',!!words);
  const old=strip.querySelector('.lyrics-strip-line');
  if(old&&!reduced.matches){old.classList.add('is-leaving');old.removeAttribute('id');setTimeout(()=>old.remove(),360);old.after(fresh);}else{old?.replaceWith(fresh);}
  next.textContent=current.next||'';
}

// Words fill in as they are sung; a line without word timing fills as a whole.
function tick(){
  frame=0;if(!state)return;
  const time=now(),current=state.line||{};
  const active=strip.querySelector('.lyrics-strip-line:not(.is-leaving)');
  if(active?.classList.contains('is-words')){
    for(const span of active.children){const at=Number(span.dataset.at),end=Math.max(at+.05,Number(span.dataset.end)||at);const progress=Math.min(1,Math.max(0,(time-at)/(end-at)));span.style.setProperty('--fill',`${(progress*100).toFixed(1)}%`);span.classList.toggle('is-sung',progress>=1);}
  }else if(active){const span=Math.max(.5,(current.end||current.at+4)-current.at);active.style.setProperty('--fill',`${Math.min(100,Math.max(0,(time-current.at)/span*100)).toFixed(1)}%`);}
  if(state.playing)frame=requestAnimationFrame(tick);
}

window.__TAURI__.event.listen('lyrics-line',({payload})=>{
  state=payload;receivedAt=performance.now();
  if(payload.accent)document.documentElement.style.setProperty('--strip-accent',payload.accent);
  render();if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(tick);
});
window.__TAURI__.event.listen('lyrics-overlay-locked',({payload})=>document.body.classList.toggle('is-locked',!!payload));

// Drag anywhere that is not a button; the buttons appear while the pointer is over the strip.
strip.addEventListener('mousedown',event=>{if(event.button===0&&!event.target.closest('button'))invoke('lyrics_overlay_action',{action:'drag'}).catch(()=>{});});
lock.addEventListener('click',()=>invoke('lyrics_overlay_action',{action:'lock'}).catch(()=>{}));
close.addEventListener('click',()=>invoke('lyrics_overlay_close').catch(()=>{}));
