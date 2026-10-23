const clamp=value=>Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
// Fast attack, gentle release. No BPM guess, free-running oscillator or random
// colour changes: silence has no pulses and every rise originates in the audio.
export function createAmbientEnvelope(){
  let previous=[0,0,0],baseline=0;
  return {
    reset(){previous=[0,0,0];baseline=0;},
    sample(signal,seconds=1/30){
      const dt=Math.max(.001,Math.min(.1,seconds)),audible=signal&&Number.isFinite(signal.rms)&&signal.rms>.00005;
      const bass=audible?clamp(signal.bass):0;
      const onset=Math.max(0,bass-baseline);baseline+=(bass-baseline)*(1-Math.exp(-dt/.24));
      const target=audible?[clamp(bass*.9+onset*2.1),clamp(clamp(signal.mid)*1.15),clamp(clamp(signal.high)*1.25)]:[0,0,0];
      previous=target.map((level,i)=>previous[i]+(level-previous[i])*(1-Math.exp(-dt/(level > previous[i] ? .025 : .26))));
      return [...previous];
    }
  };
}
