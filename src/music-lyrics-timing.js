// Playback time is authoritative: seeking, pausing and changing audio decks all
// use the same path. Never estimate words from character counts or the beat.
export function timedLyrics(value) {
  if (!Array.isArray(value) || value.length > 3000) return [];
  const time = v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 86400;
  return value.filter(line => line && typeof line.text === "string" && time(line.at)
    && (line.end == null || time(line.end) && line.end >= line.at)).map(line => {
    const words = Array.isArray(line.words) && line.words.length <= 500 ? line.words : [];
    const valid = words.length && words.every((word, i) => word && typeof word.text === "string" && time(word.at)
      && word.at >= line.at && (line.end == null || word.at <= line.end)
      && (!i || word.at >= words[i-1].at)
      && (word.end == null || time(word.end) && word.end >= word.at && (line.end == null || word.end <= line.end)))
      && words.map(word => word.text).join("") === line.text;
    return {...line, words: valid ? words : []};
  }).sort((a,b) => a.at-b.at);
}

export function lyricFrame(lines, time) {
  const active=[];
  for (let i=0;i<lines.length && lines[i].at<=time;i++) {
    const line=lines[i], end=line.end ?? lines[i+1]?.at ?? Infinity;
    if(time>=end)continue;
    active.push({index:i,words:(line.words||[]).map((word,index,words)=>{
      if(time<word.at)return {state:"upcoming",progress:0};
      const end=word.end ?? words[index+1]?.at ?? line.end;
      if(end != null && time>=end)return {state:"sung",progress:1};
      // A missing end allows an active word, but no fabricated fill animation.
      return {state:"current",progress:word.end>word.at?Math.min(1,(time-word.at)/(word.end-word.at)):1};
    })});
  }
  return active;
}
