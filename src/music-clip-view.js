import {t,onLanguageChange} from './i18n.js';
import {loadArtwork} from './music-artwork.js';

const OPEN_MS=560,CLOSE_MS=420,FULL_IN_MS=360,FULL_OUT_MS=320,EASE='cubic-bezier(.2,.85,.15,1)';
const reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The music video's own stage. It rises out of the player's cover above the dock and sinks back into it.
export function createClipView({dock,origin,button,onClose,onQuality=()=>{},onFullscreen=()=>{}}){
  const make=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node;};
  const view=make('section','music-clip-view'),backdrop=make('img','music-clip-backdrop'),frame=make('div','music-clip-frame');
  const poster=make('img','music-clip-poster'),head=make('header','music-clip-head'),names=make('div','music-clip-names');
  const title=make('strong',''),artist=make('span',''),state=make('p','music-clip-state'),spinner=make('div','music-clip-spinner');
  spinner.setAttribute('aria-hidden','true');spinner.innerHTML='<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"/></svg>';
  const close=button(t('Close music video'),'caret-down',()=>onClose());close.classList.add('music-clip-close');
  const tools=make('div','music-clip-tools'),menu=make('div','music-clip-quality-menu');
  const pick=make('button','music-clip-quality');pick.type='button';pick.hidden=true;pick.popoverTargetElement=menu;menu.popover='auto';menu.setAttribute('role','menu');
  const full=button(t('Full screen'),'screen-full',()=>setFullscreen(!fullscreen));full.classList.add('music-clip-full');
  tools.append(pick,full,close);
  poster.alt='';poster.decoding='async';poster.style.transformOrigin='0 0';backdrop.alt='';backdrop.setAttribute('aria-hidden','true');state.setAttribute('role','status');
  view.hidden=true;view.setAttribute('aria-label',t('Music video'));
  names.append(title,artist);head.append(names,tools);frame.append(poster);view.append(backdrop,frame,spinner,head,state,menu);
  document.body.append(view);
  let open=false,moves=[],image='',idle=0,shown='',fullscreen=false,spin=0;
  const rect=node=>node?.getBoundingClientRect();
  function place(){
    const bar=rect(dock),top=(rect(document.querySelector('.topbar'))?.bottom??0)+12;
    if(!bar)return;
    Object.assign(view.style,{left:`${bar.left}px`,width:`${bar.width}px`,top:`${top}px`,height:`${Math.max(160,bar.top-12-top)}px`});
  }
  function stopMoves(){for(const move of moves)move.cancel();moves=[];}
  // Both directions use the same geometry: the panel grows from the cover's box while the cover flies to the middle.
  function travel(reverse){
    stopMoves();
    const from=rect(origin()),box=rect(view),art=rect(poster);
    if(reducedMotion()||!from?.width||!box?.height||!art?.width){
      moves=[view.animate([{opacity:0},{opacity:1}],{duration:reverse?140:200,direction:reverse?'reverse':'normal',fill:'both'})];return moves[0].finished;
    }
    const lift=from.bottom-box.bottom,radius=getComputedStyle(view).borderTopLeftRadius||'28px';
    const timing={duration:reverse?CLOSE_MS:OPEN_MS,easing:EASE,direction:reverse?'reverse':'normal',fill:'both'};
    const scale=from.width/art.width;
    moves=[
      view.animate([
        {transform:`translateY(${lift}px)`,clipPath:`inset(${box.height-from.height}px ${box.right-from.right}px 0px ${from.left-box.left}px round 12px)`},
        {transform:'none',clipPath:`inset(0px 0px 0px 0px round ${radius})`}],timing),
      poster.animate([
        {transform:`translate(${from.left-art.left}px,${from.top-art.top-lift}px) scale(${scale})`},
        {transform:'none'}],timing),
      head.animate([{opacity:0},{opacity:0,offset:.45},{opacity:1}],timing),
    ];
    return Promise.all(moves.map(move=>move.finished)).catch(()=>{});
  }
  function onKey(event){
    if(!open||event.key!=='Escape'||document.querySelector('dialog[open]')||menu.matches(':popover-open'))return;
    event.preventDefault();if(fullscreen)setFullscreen(false);else onClose();
  }
  // The stage grows to the whole window without stretching the picture: a uniform scale from its own box,
  // with the extra height cropped away. The window takes the whole screen once the stage has arrived.
  function expand(box,reverse){
    stopMoves();
    const width=innerWidth,height=innerHeight,scale=box.width/width;
    if(reducedMotion()||!box.width||!scale)return Promise.resolve();
    const crop=Math.max(0,(height-box.height/scale)/2),radius=28/scale;
    moves=[view.animate([
      {transformOrigin:'0 0',transform:`translate(${box.left}px,${box.top+box.height/2-height*scale/2}px) scale(${scale})`,clipPath:`inset(${crop}px 0px ${crop}px 0px round ${radius}px)`},
      {transformOrigin:'0 0',transform:'none',clipPath:'inset(0px 0px 0px 0px round 0px)'}],
      {duration:reverse?FULL_OUT_MS:FULL_IN_MS,easing:EASE,direction:reverse?'reverse':'normal',fill:'both'})];
    return moves[0].finished.catch(()=>{});
  }
  const settle=()=>new Promise(resolve=>{let done=false;const finish=()=>{if(!done){done=true;removeEventListener('resize',finish);resolve();}};addEventListener('resize',finish);setTimeout(finish,260);});
  // Full screen takes the whole window, and the window the whole screen. The controls rest with the mouse.
  function mark(on){
    fullscreen=on;full.setAttribute('aria-pressed',String(on));
    full.querySelector('.icon')?.setAttribute('data-icon',on?'screen-exit':'screen-full');full.title=full.ariaLabel=on?t('Exit full screen'):t('Full screen');
  }
  async function setFullscreen(on){
    if(on===fullscreen)return;mark(on);
    if(on){
      const box=rect(view);view.classList.add('is-fullscreen');await expand(box,false);
      if(fullscreen){stopMoves();onFullscreen(true);}
    }else{
      onFullscreen(false);await settle();if(fullscreen)return;
      place();view.classList.remove('is-fullscreen');const box=rect(view);view.classList.add('is-fullscreen');
      await expand(box,true);if(!fullscreen){view.classList.remove('is-fullscreen');stopMoves();}
    }
    wake();
  }
  function wake(){view.classList.remove('is-idle');clearTimeout(idle);if(fullscreen&&!menu.matches(':popover-open'))idle=setTimeout(()=>view.classList.add('is-idle'),2600);}
  view.addEventListener('pointermove',wake);frame.addEventListener('dblclick',()=>setFullscreen(!fullscreen));
  menu.addEventListener('toggle',()=>{wake();if(!menu.matches(':popover-open'))return;const at=rect(pick);menu.style.top=`${at.bottom+8}px`;menu.style.right=`${innerWidth-at.right}px`;});
  addEventListener('resize',()=>{if(open)place();});
  document.addEventListener('keydown',onKey);
  onLanguageChange(()=>{close.title=close.ariaLabel=t('Close music video');pick.title=pick.ariaLabel=t('Video quality');full.title=full.ariaLabel=fullscreen?t('Exit full screen'):t('Full screen');view.setAttribute('aria-label',t('Music video'));});
  pick.title=pick.ariaLabel=t('Video quality');
  return {
    frame,
    get isOpen(){return open;},
    show(){
      if(open)return;open=true;place();view.hidden=false;view.classList.add('is-open');
      void travel(false).then(()=>{if(open)stopMoves();});
    },
    async hide(){
      if(!open)return;open=false;view.classList.remove('is-open');
      // Leaving from full screen: the window returns first, then the stage sinks back into the cover.
      if(fullscreen){mark(false);onFullscreen(false);await settle();stopMoves();view.classList.remove('is-fullscreen');place();}
      await travel(true);
      if(!open){view.hidden=true;stopMoves();}
    },
    // Short waits stay quiet; the ring appears only when the picture is late enough to notice.
    setBuffering(on){
      clearTimeout(spin);view.setAttribute('aria-busy',String(on));
      if(on)spin=setTimeout(()=>view.classList.add('is-buffering'),220);else view.classList.remove('is-buffering');
    },
    setItem(item){
      title.textContent=item?.title||'';artist.textContent=(item?.artists||[]).join(', ')||item?.subtitle||'';
      if((item?.image||'')===image)return;image=item?.image||'';
      for(const node of [poster,backdrop]){node.removeAttribute('src');if(image&&loadArtwork(node,image,800))node.loading='eager';}
    },
    setState({ready=false,loading=false,missing=false,failed=false,quality=0,offer}={}){
      view.classList.toggle('is-playing',ready);view.classList.toggle('is-loading',loading);
      const heights=offer?.heights||[],current=offer?.height||quality,list=heights.join();
      pick.hidden=!heights.length;pick.textContent=current?`${current}p`:'';
      if(list!==shown){shown=list;menu.replaceChildren(...heights.map(height=>{const item=make('button','music-clip-quality-item');item.type='button';item.setAttribute('role','menuitemradio');item.dataset.height=height;item.textContent=`${height}p${height>=1080?' HD':''}`;item.addEventListener('click',()=>{menu.hidePopover();onQuality(height);});return item;}));}
      for(const item of menu.children)item.setAttribute('aria-checked',String(Number(item.dataset.height)===current));
      state.textContent=failed?t('The music video could not be played.'):missing?t('No music video found for this song.'):'';
    }
  };
}
