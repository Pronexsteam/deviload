// One sung line at a time, as on the desktop strip and over the music video. A new line slides up while
// the old one leaves, and words fill in as they are sung. Each update carries the song position, and the
// fill is timed here between updates, so the sender does not have to send every frame.
export function createLyricLine({host,next=null,reduced=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches}){
  let state=null,receivedAt=0,shownKey='',frame=0;
  const now=()=>!state?0:state.position+(state.playing?(performance.now()-receivedAt)/1000*(state.rate||1):0);
  const live=()=>host.querySelector('.lyric-cap-line:not(.is-leaving)');

  function render(){
    const current=state?.line||{};const key=`${state?.id}|${current.at}|${current.text}`;
    if(key===shownKey)return;
    shownKey=key;
    const words=current.words?.length?current.words:null;
    const fresh=document.createElement('p');fresh.className='lyric-cap-line';fresh.setAttribute('aria-live','polite');
    if(words)fresh.append(...words.map(word=>{const span=document.createElement('span');span.className='lyric-cap-word';span.textContent=word.text;span.dataset.at=word.at;span.dataset.end=word.end;return span;}));
    else fresh.textContent=current.text||'♪';
    fresh.classList.toggle('is-words',!!words);
    const old=live();
    if(old&&!reduced()){old.classList.add('is-leaving');old.removeAttribute('aria-live');setTimeout(()=>old.remove(),360);old.after(fresh);}
    else if(old)old.replaceWith(fresh);
    else if(next?.parentNode===host)next.before(fresh);else host.append(fresh);
    if(next)next.textContent=current.next||'';
  }

  // Words fill in as they are sung; a line without word timing fills as a whole.
  function tick(){
    frame=0;if(!state)return;
    const time=now(),current=state.line||{},active=live();
    if(active?.classList.contains('is-words')){
      for(const span of active.children){
        const at=Number(span.dataset.at),end=Math.max(at+.05,Number(span.dataset.end)||at),progress=Math.min(1,Math.max(0,(time-at)/(end-at)));
        span.style.setProperty('--fill',`${(progress*100).toFixed(1)}%`);span.classList.toggle('is-sung',progress>=1);
      }
    }else if(active){
      const span=Math.max(.5,(current.end||current.at+4)-current.at);
      active.style.setProperty('--fill',`${Math.min(100,Math.max(0,(time-current.at)/span*100)).toFixed(1)}%`);
    }
    if(state.playing)frame=requestAnimationFrame(tick);
  }

  return {
    set(payload){state=payload;receivedAt=performance.now();render();if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(tick);},
    get text(){return state?.line?.text||'';},
    clear(){
      state=null;shownKey='';if(frame)cancelAnimationFrame(frame);frame=0;
      for(const line of host.querySelectorAll('.lyric-cap-line'))line.remove();
      if(next)next.textContent='';
    },
  };
}
