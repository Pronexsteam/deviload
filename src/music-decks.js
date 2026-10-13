// Two decoders let a prepared track start without reopening its media URL.
export function createMusicDecks({makeAudio=()=>new Audio(),now=Date.now}={}){
  const nodes=[makeAudio(),makeAudio()];let active=nodes[0],prepared=null,tail=null;
  for(const [index,node]of nodes.entries()){node.id=`music-audio${index?'-next':''}`;node.hidden=true;node.preload="auto";node.crossOrigin="anonymous";}
  function stopTail(){if(tail){clearInterval(tail.timer);tail.node.pause();tail.node.volume=active.volume;tail=null;}}
  return {
    nodes,get current(){return active;},owns:node=>nodes.includes(node),stopTail,
    ready(id){return prepared?.id===id&&now()-prepared.at<240000&&prepared.node.readyState>=3&&!prepared.node.error;},
    warm(id,url){stopTail();const node=nodes.find(node=>node!==active);node.pause();node.src=url;node.load();prepared={id,node,at:now()};},
    take(id,volume,overlap=0){
      if(!this.ready(id))return null;
      stopTail();const old=active;active=prepared.node;prepared=null;active.volume=volume;
      if(overlap>0&&!old.paused){
        const start=now(),initial=old.volume;
        tail={node:old,timer:setInterval(()=>{const fraction=Math.max(0,1-(now()-start)/(overlap*1000));old.volume=initial*fraction;if(!fraction)stopTail();},30)};
      }else old.pause();
      return active;
    },
    clear(){stopTail();prepared=null;const node=nodes.find(node=>node!==active);node.pause();node.removeAttribute("src");node.load();},
    listen(name,handler){for(const node of nodes)node.addEventListener(name,event=>{if(node===active)handler(event);});}
  };
}
