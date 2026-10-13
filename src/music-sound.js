import {t} from "./i18n.js";
const frequencies=[60,170,350,1000,3500,10000];
const presets={flat:[0,0,0,0,0,0],bass:[5,3,0,-1,0,1],voice:[-3,-2,1,3,2,0],night:[-2,-1,0,1,-1,-3]};
export function soundSettings(raw={}){
  return {preset:Object.hasOwn(presets,raw.preset)?raw.preset:"flat",soft:raw.soft===true,transition:[0,2,4].includes(raw.transition)?raw.transition:0};
}
export function createMusicSound({nodes,storage,button,notify}){
  let settings;try{settings=soundSettings(JSON.parse(storage?.getItem("devil-music-sound")||"{}"));}catch{settings=soundSettings();}
  let context=null,graphs=[];
  function apply(){for(const graph of graphs){graph.filters.forEach((filter,i)=>filter.gain.value=presets[settings.preset][i]);graph.preamp.gain.value=settings.preset==="flat"?1:.5;graph.compressor.threshold.value=settings.soft?-24:0;graph.compressor.ratio.value=settings.soft?3:1;}}
  async function activate(){
    if(!context){
      const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)throw Error(t("Sound processing is unavailable on this device."));
      context=new AudioContext();
      for(const node of nodes){const source=context.createMediaElementSource(node),preamp=context.createGain(),compressor=context.createDynamicsCompressor();
        const filters=frequencies.map(frequency=>{const filter=context.createBiquadFilter();filter.type="peaking";filter.frequency.value=frequency;filter.Q.value=.7;return filter;});
        source.connect(preamp);let output=preamp;for(const filter of filters){output.connect(filter);output=filter;}output.connect(compressor);compressor.connect(context.destination);graphs.push({filters,preamp,compressor});
      }
    }apply();await context.resume();
  }
  const dialog=document.createElement("dialog");dialog.className="music-settings-dialog";dialog.setAttribute("aria-label",t("Sound and transitions"));
  const heading=document.createElement("h2");heading.textContent=t("Sound and transitions");dialog.append(heading);
  function select(label,options,value,onchange){const row=document.createElement("label"),text=document.createElement("span"),input=document.createElement("select");text.textContent=label;
    for(const [key,label]of options){const option=document.createElement("option");option.value=key;option.textContent=label;input.append(option);}input.value=String(value);row.append(text,input);dialog.append(row);input.addEventListener("change",async()=>{onchange(input.value);try{if(settings.preset!=="flat"||settings.soft||context)await activate();storage?.setItem("devil-music-sound",JSON.stringify(settings));}catch(error){notify(error.message,true);}});return input;}
  const presetInput=select(t("Equalizer"),[["flat",t("Flat")],["bass",t("Bass boost")],["voice",t("Vocals")],["night",t("Night")]],settings.preset,value=>settings.preset=value);
  const softInput=select(t("Volume smoothing"),[["off",t("Off")],["on",t("On")]],settings.soft?"on":"off",value=>settings.soft=value==="on");
  const transitionInput=select(t("Track transition"),[[0,t("No overlap")],[2,t("2 seconds")],[4,t("4 seconds")]],settings.transition,value=>settings.transition=Number(value));
  const reset=button(t("Reset sound settings"),null,()=>{
    settings=soundSettings();presetInput.value="flat";softInput.value="off";transitionInput.value="0";apply();
    try{storage?.setItem("devil-music-sound",JSON.stringify(settings));}catch(error){notify(error.message,true);}
  },"secondary");
  const actions=document.createElement("div");actions.className="music-sound-actions";actions.append(reset,button(t("Close"),null,()=>dialog.close(),"secondary"));
  const note=document.createElement("p");note.textContent=t("Prepared tracks start immediately. Overlap applies when the next track is ready. Volume smoothing reduces sudden peaks; it does not measure album loudness.");dialog.append(note,actions);document.body.append(dialog);
  document.addEventListener("pointerdown",()=>{if(settings.preset!=="flat"||settings.soft)activate().catch(()=>{});},{once:true});
  return {open(){dialog.showModal();},get transition(){return settings.transition;},resume(){if(context)context.resume().catch(()=>{});}};
}
