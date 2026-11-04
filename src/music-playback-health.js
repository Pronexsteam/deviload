// Only spare buffered audio may fund speculative preparation of the next song.
export function bufferedSeconds(audio){
  const at=Number(audio.currentTime);
  if(!Number.isFinite(at))return 0;
  try{for(let i=0;i<audio.buffered.length;i++)if(audio.buffered.start(i)<=at+.05&&audio.buffered.end(i)>at)return audio.buffered.end(i)-at;}catch{}
  return 0;
}
export function canPrepareAudio(audio){
  const remaining=Number(audio.duration)-Number(audio.currentTime);
  return audio.readyState>=4&&remaining>0&&Number.isFinite(remaining)&&bufferedSeconds(audio)+.1>=Math.min(8,remaining);
}
export function keyboardSeek(key,position,duration){
  if(!Number.isFinite(duration)||duration<=0)return null;
  const changes={ArrowLeft:-5,ArrowDown:-5,ArrowRight:5,ArrowUp:5,PageDown:-duration/10,PageUp:duration/10};
  if(key==='Home')return 0;
  if(key==='End')return duration;
  return key in changes?Math.max(0,Math.min(duration,(Number(position)||0)+changes[key])):null;
}
