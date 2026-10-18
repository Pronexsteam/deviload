// Reports contain fixed stages/codes and timing only. Never keep track metadata,
// source URLs, local paths, browser errors or authentication material here.
const stages=new Set(["source","resolve","preload","start","playing","buffering","recovery","pause","cancelled"]);
const codes=new Set(["requested","ready","success","cancelled","timeout","restricted","limited","network","decode","unsupported","worker_stopped","busy","invalid_response","failed","offline","remote"]);
export function playbackErrorCode(error){
  const message=String(error?.message||error||"").slice(0,1000).toLowerCase();
  if(/abort|cancel|superseded/.test(message))return "cancelled";
  if(/429|rate limit|temporarily limit/.test(message))return "limited";
  if(/403|restricted|sign.in|not a bot|login_required|unplayable|age_check|not available in (your|this)|unavailable from youtube/.test(message))return "restricted";
  if(/timeout|timed out|did not start in time/.test(message))return "timeout";
  if(/engine is busy/.test(message))return "busy";
  if(/engine.*(stopped|did not start|could not start)|could not start music engine/.test(message))return "worker_stopped";
  if(/network|fetch|connect|offline|dns|socket/.test(message))return "network";
  if(/decode|media_err_decode/.test(message))return "decode";
  if(/not.?supported|unsupported|media_err_src/.test(message))return "unsupported";
  if(/invalid music engine response/.test(message))return "invalid_response";
  return "failed";
}
export function playbackFailure(error){
  const code=playbackErrorCode(error);
  const messages={
    limited:"Playback temporarily limited by YouTube. Wait before trying again.",
    restricted:"Playback restricted: YouTube requires sign-in or verification. Try another track.",
    timeout:"Audio did not start in time. Press play to retry.",
    busy:"Music engine is busy. Wait a moment and try again.",
    worker_stopped:"The music engine could not start. Check the music engine update in Music settings.",
    network:"Music could not connect. Check your connection and proxy settings, then retry.",
    decode:"This audio could not be decoded. Try another track or download it as MP3.",
    unsupported:"This audio could not be decoded. Try another track or download it as MP3.",
    failed:"Playback failed. Retry the track or export a playback report in Music settings."
  };
  let message=messages[code]||messages.failed;
  if(code==="restricted"){
    const reason=String(error?.message||error||"").slice(0,1000).toLowerCase();
    if(/region|country|not available in (your|this)/.test(reason))message="Playback restricted: this track is unavailable in your region. Try another track.";
    else if(/this track is unavailable|unplayable/.test(reason))message="Playback restricted: this track is unavailable from YouTube. Try another track.";
    else if(/denied access|403/.test(reason))message="Playback restricted: YouTube denied access to the audio. Try another track.";
  }
  return {code,message};
}
export function createMusicDiagnostics({now=Date.now,limit=80}={}){
  const events=[];const capacity=Math.max(1,Math.min(80,Number.isInteger(limit)?limit:80));let start=now();
  function record(stage,code="requested"){
    if(!stages.has(stage)||!codes.has(code))return false;
    const at=now();if(!Number.isFinite(at)||at<0)return false;
    const previous=events.at(-1);if(previous?.stage===stage&&previous.code===code&&at-previous.at<1000)return false;
    if(stage==="source"&&code==="requested")start=at;
    events.push({at:Math.floor(at),stage,code,elapsedMs:Math.max(0,Math.min(300000,Math.floor(at-start)))});
    while(events.length>capacity)events.shift();return true;
  }
  return {record,error(stage,error){return record(stage,playbackErrorCode(error));},snapshot(){const cutoff=now()-2*60*60*1000;return events.filter(event=>event.at>=cutoff).map(event=>({...event}));}};
}
