import {createAmbientEnvelope} from './music-ambient-model.js';
import {paintAmbient,ambientArtwork} from './music-ambient-light.js';
import {createArtworkWash} from './artwork-wash.js';
import {artworkCandidates} from './music-artwork.js';

export function createMusicAmbient({dock,sound,getAudio,getTrack,nodes,hasMini=()=>false,onLevels=()=>{}}){
  const scene=document.createElement('div');scene.className='ambient-scene';scene.setAttribute('aria-hidden','true');document.body.prepend(scene);const wash=createArtworkWash(scene);
  const layer=document.createElement('div');layer.className='music-ambient-glow';layer.setAttribute('aria-hidden','true');
  const lights=Array.from({length:3},()=>{const node=document.createElement('span');layer.append(node);return node;});dock.prepend(layer);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),envelope=createAmbientEnvelope();
  const stage=document.getElementById('music-now-playing'),stageBackground=stage?.querySelector('.music-stage-background');
  let frame=0,last=0,ready=false,pending=null,image='',trackId=null,disposed=false;
  const enabled=()=>['ambient','aurora','prism'].includes(document.documentElement.dataset.theme);
  const visible=()=>enabled()&&(hasMini()||!document.hidden);
  // An inherited root variable invalidates every descendant on each audio frame.
  // Keep the envelope on compositor layers, independent of library/lyrics size.
  const paint=levels=>{paintAmbient(lights,levels);const energy=Math.max(...levels);scene.style.opacity=(.22+energy*.28).toFixed(3);if(stageBackground&&stage.open)stageBackground.style.opacity=(.72+energy*.28).toFixed(3);onLevels(levels);};
  function stop(){clearTimeout(frame);frame=0;last=0;envelope.reset();paint([0,0,0]);}
  async function prepare(){
    if(ready||pending)return pending;
    pending=sound.enableAnalysis().then(()=>{ready=true;},()=>{/* Static artwork remains available if analysis is unsupported. */}).finally(()=>{pending=null;});
    return pending;
  }
  function tick(){
    frame=0;const audio=getAudio(),now=performance.now();
    if(disposed||!visible()||reduced.matches||audio.paused||audio.ended||audio.readyState<3){stop();return;}
    if(!last||now-last>=32){
      const signal=ready&&!audio.muted&&audio.volume>0?sound.analyse(audio):null;
      paint(envelope.sample(signal,last?(now-last)/1000:1/30));last=now;
    }
    // Unlike rAF, an audible main window can keep feeding the separate mini
    // window while minimized. No second playback graph is created there.
    frame=setTimeout(tick,34);
  }
  function refresh(){
    if(disposed)return;
    layer.hidden=!enabled();
    const track=getTrack();if(trackId!==track?.id){trackId=track?.id;envelope.reset();}
    const source=artworkCandidates(track?.image,256)[0]||'';
    if(image!==source){image=source;
      // A blurred background needs only a bounded thumbnail, not the full
      // artwork used by the expanded player. No pixel sampling is needed.
      layer.style.setProperty('--ambient-art',ambientArtwork(source));
      document.documentElement.style.setProperty('--ambient-art',ambientArtwork(source));
      wash.update(ambientArtwork(source));
    }
    if(!visible()||reduced.matches||getAudio().paused){stop();return;}
    if(!ready)prepare();if(!frame)frame=setTimeout(tick,0);
  }
  const gesture=()=>{if(enabled()&&!reduced.matches){prepare();sound.resume();refresh();}};
  document.addEventListener('deviload-theme-change',refresh);document.addEventListener('visibilitychange',refresh);
  document.addEventListener('music-mini-visibility',refresh);
  document.addEventListener('close',refresh,true);document.addEventListener('toggle',refresh,true);
  document.addEventListener('pointerdown',gesture,{passive:true});document.addEventListener('keydown',gesture);
  reduced.addEventListener('change',refresh);
  for(const node of nodes)for(const event of ['playing','pause','waiting','ended','loadeddata','seeked'])node.addEventListener(event,refresh);
  refresh();
  const cleanup=()=>{disposed=true;stop();document.removeEventListener('music-mini-visibility',refresh);document.removeEventListener('deviload-theme-change',refresh);document.removeEventListener('visibilitychange',refresh);document.removeEventListener('close',refresh,true);document.removeEventListener('toggle',refresh,true);document.removeEventListener('pointerdown',gesture);document.removeEventListener('keydown',gesture);reduced.removeEventListener('change',refresh);for(const node of nodes)for(const event of ['playing','pause','waiting','ended','loadeddata','seeked'])node.removeEventListener(event,refresh);};
  window.addEventListener('pagehide',event=>{if(!event.persisted)cleanup();});
  return {update:refresh};
}
