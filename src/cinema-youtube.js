// Runs on a separate loopback origin with no Tauri privileges. The official
// API stays here; no third-party JavaScript executes in the application window.
let parentOrigin='',player=null,current=null,ready=false;
const validId=id=>typeof id==='string'&&/^[\w-]{11}$/.test(id);
const allowedParent=origin=>['http://tauri.localhost','https://tauri.localhost','tauri://localhost'].includes(origin);
const notify=(event,data={})=>{if(parentOrigin)parent.postMessage({cinema:'youtube',event,token:current?.token,...data},parentOrigin);};
function load(){if(!ready||!current)return;const args={videoId:current.id,startSeconds:current.start||0};current.play?player.loadVideoById(args):player.cueVideoById(args);}
window.addEventListener('message',event=>{
 if(event.source!==parent||!allowedParent(event.origin)||event.data?.cinema!=='youtube')return;
 const data=event.data;parentOrigin=event.origin;
 if(data.action==='load'&&validId(data.id)&&Number.isSafeInteger(data.token)){
  current={id:data.id,token:data.token,play:data.play===true,start:Number.isFinite(data.start)?Math.max(0,data.start):0};
  if(player)load();
 }else if(data.action==='pause'){if(current)current.play=false;player?.pauseVideo();}
});
window.onYouTubeIframeAPIReady=()=>{
 player=new YT.Player('youtube-player',{width:'100%',height:'100%',playerVars:{playsinline:1,origin:location.origin,widget_referrer:'https://com.deviload.desktop'},events:{
  onReady(){ready=true;notify('ready');load();},
  onStateChange(event){if(!current||player.getVideoData()?.video_id!==current.id)return;notify('state',{state:event.data,position:player.getCurrentTime(),duration:player.getDuration(),id:current.id});},
  onError(event){const id=player.getVideoData()?.video_id;if(id&&id!==current?.id)return;notify('error',{code:event.data});},
  onAutoplayBlocked(){notify('blocked');}
 }});
};
const api=document.createElement('script');api.src='https://www.youtube.com/iframe_api';api.onerror=()=>notify('error',{code:0});document.head.append(api);
// Parent waits for this before sending the selected item, avoiding iframe-load races.
window.addEventListener('load',()=>parent.postMessage({cinema:'youtube',event:'bridge'},'*'));
