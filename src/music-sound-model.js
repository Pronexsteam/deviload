import {TRANSITIONS} from './music-transition-model.js';
export const frequencies=[60,170,350,1000,3500,10000];
export const presets={flat:[0,0,0,0,0,0],bass:[5,3,0,-1,0,1],voice:[-3,-2,1,3,2,0],night:[-2,-1,0,1,-1,-3]};
const gains=value=>frequencies.map((_,i)=>Number.isFinite(value?.[i])?Math.max(-12,Math.min(12,value[i])):0);
export function soundSettings(raw={}){
  raw=raw&&typeof raw==='object'?raw:{};
  const custom=Array.isArray(raw.custom)?raw.custom.filter(p=>p&&typeof p.name==='string'&&p.name.trim()).slice(0,50).map(p=>({name:p.name.trim().slice(0,48),bands:gains(p.bands)})):[];
  const preset=Object.hasOwn(presets,raw.preset)?raw.preset:'custom';
  return {preset:preset==='custom'&&!Array.isArray(raw.bands)?'flat':preset,bands:gains(raw.bands||presets[preset]),custom,selected:custom.some(p=>p.name===raw.selected)?raw.selected:'',bypass:raw.bypass===true,
    soft:raw.soft===true,transition:TRANSITIONS.includes(raw.transition)?raw.transition:0,seamless:raw.seamless!==false,rate:Number.isFinite(raw.rate)?Math.round(Math.max(.5,Math.min(2,raw.rate))*20)/20:1};
}
// RBJ peaking response for the same Q and frequencies as the Web Audio graph.
// Include overlapping boosts; using only the largest slider gain underestimates them.
export function equalizerHeadroom(bands,sampleRate=48000){
  const filters=frequencies.map((f,i)=>{const a=10**(bands[i]/40),w=2*Math.PI*Math.min(f,sampleRate*.49)/sampleRate,alpha=Math.sin(w)/1.4,c=Math.cos(w);
    return {b:[1+alpha*a,-2*c,1-alpha*a],a:[1+alpha/a,-2*c,1-alpha/a]};});
  let peak=1;
  for(let i=0;i<=1024;i++){const w=Math.PI*i/1024,c=Math.cos(w),s=Math.sin(w),c2=Math.cos(2*w),s2=Math.sin(2*w);let response=1;
    for(const f of filters){const power=v=>(v[0]+v[1]*c+v[2]*c2)**2+(v[1]*s+v[2]*s2)**2;response*=Math.sqrt(power(f.b)/power(f.a));}peak=Math.max(peak,response);}
  return peak>1.00001?1/(peak*10**(.5/20)):1;
}
export function createMusicRate(nodes,getRate){
  const local=new WeakMap();let mode='';
  const pitchSupported=nodes.every(node=>'preservesPitch' in node||'webkitPreservesPitch' in node||'mozPreservesPitch' in node);
  function apply(node){
    for(const key of ['preservesPitch','webkitPreservesPitch','mozPreservesPitch'])if(key in node)node[key]=true;
    // Guest synchronization owns playbackRate, including its drift correction.
    if(mode==='guest'){node.defaultPlaybackRate=1;return;}
    node.playbackRate=mode||!pitchSupported||!local.get(node)?1:getRate();
    node.defaultPlaybackRate=node.playbackRate;
  }
  for(const node of nodes)node.addEventListener('loadedmetadata',()=>apply(node));
  return {pitchSupported,setSource(node,offline){local.set(node,offline===true);apply(node);},setMode(value){mode=value;nodes.forEach(apply);},refresh(){nodes.forEach(apply);},
    reason(node){return mode?'room':!pitchSupported?'pitch':!local.get(node)?'online':'';}};
}
