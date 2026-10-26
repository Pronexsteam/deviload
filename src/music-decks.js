// Two decoders let a prepared track start without reopening its media URL.
import {musicGain} from "./music-volume.js";
export function createMusicDecks({makeAudio=()=>new Audio(),now=Date.now,schedule=setInterval,cancel=clearInterval}={}){
  const nodes=[makeAudio(),makeAudio()];let active=nodes[0],prepared=null,tail=null;
  for(const [index,node]of nodes.entries()){node.id=`music-audio${index?'-next':''}`;node.hidden=true;node.preload="auto";node.crossOrigin="anonymous";}
  function release(node){node.pause();node.removeAttribute("src");node.load();}
  function stopTail(){if(tail){const old=tail;tail=null;cancel(old.timer);release(old.node);old.node.volume=active.volume;}}
  const fraction=()=>tail?Math.max(0,1-(now()-tail.start)/tail.duration):0;
  function setVolume(value){
    const gain=musicGain(value);active.volume=gain;
    for(const node of nodes)if(node!==active)node.volume=tail?.node===node?gain*fraction():gain;
    if(tail)tail.gain=gain;
  }
  return {
    nodes,get current(){return active;},owns:node=>nodes.includes(node),stopTail,setVolume,
    ready(id){return prepared?.id===id&&now()-prepared.at<240000&&prepared.node.readyState>=3&&!prepared.node.error;},
    warm(id,url){stopTail();const node=nodes.find(node=>node!==active);node.pause();node.src=url;node.load();prepared={id,node,at:now()};},
    take(id,volume,overlap=0){
      if(!this.ready(id))return null;
      stopTail();const old=active;active=prepared.node;prepared=null;setVolume(volume);
      if(overlap>0&&!old.paused){
        tail={node:old,start:now(),duration:overlap*1000,gain:active.volume,timer:null};
        tail.timer=schedule(()=>{const remaining=fraction();old.volume=tail.gain*remaining;if(!remaining)stopTail();},30);
      }else release(old);
      return active;
    },
    clear(){stopTail();prepared=null;const node=nodes.find(node=>node!==active);node.pause();node.removeAttribute("src");node.load();},
    listen(name,handler){for(const node of nodes)node.addEventListener(name,event=>{if(node===active)handler(event);});}
  };
}
