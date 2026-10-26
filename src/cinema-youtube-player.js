export function createYouTubePlayer({dialog,invoke,t,onState,onError,onBlocked}){
 const stage=dialog.querySelector('.cinema-stage');
 let frame=null,address=null,origin='',serial=0,current=null,timer=0,bridgeReady=false;
 const tell=action=>{if(frame&&bridgeReady)frame.contentWindow.postMessage({cinema:'youtube',action,...current},origin);};
 function stop(){serial++;clearTimeout(timer);current=null;bridgeReady=false;frame?.remove();frame=null;stage.classList.remove('is-youtube');}
 window.addEventListener('message',event=>{
  if(!frame||event.source!==frame.contentWindow||event.origin!==origin||event.data?.cinema!=='youtube')return;
  const data=event.data;
  if(data.event==='bridge'){bridgeReady=true;tell('load');return;}
  if(!current||data.token!==current.token)return;
  if(data.event==='state'&&data.id===current.id){if([0,1,2,5].includes(data.state))clearTimeout(timer);onState(data.state);}
  if(data.event==='error'){clearTimeout(timer);onError(data.code);}
  if(data.event==='blocked'){clearTimeout(timer);onBlocked();}
 });
 return {
  async start(id,play){
   const token=++serial;current={id,play,token};clearTimeout(timer);
   address??=invoke('cinema_embed').catch(error=>{address=null;throw error;});const url=await address;
   if(token!==serial)return;
   const parsed=new URL(url);if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||!/^\/[a-f0-9]{48}\/index\.html$/.test(parsed.pathname))throw Error('Could not open the video player.');origin=parsed.origin;
   stage.classList.add('is-youtube');
   if(!frame){frame=document.createElement('iframe');frame.className='cinema-youtube';frame.title=t('YouTube video player');frame.allow='autoplay; fullscreen; encrypted-media; picture-in-picture';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');frame.src=url;stage.prepend(frame);}else tell('load');
   timer=setTimeout(()=>{if(token===serial)onError(0);},20000);
  },
  pause(){if(current)current.play=false;tell('pause');},
  suspend(){tell('pause');serial++;current=null;clearTimeout(timer);},stop
 };
}
