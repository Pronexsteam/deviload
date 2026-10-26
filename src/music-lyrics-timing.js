// Playback time is authoritative: seeking, pausing and changing audio decks all
// use the same path. Never estimate words from character counts or the beat.
export function parseLyrics(raw) {
  if (typeof raw !== 'string') return [];
  const lines = [];
  for (const row of raw.slice(0, 250000).split('\n')) {
    const stamps = [...row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const content = row.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim();
    const tags = [...content.matchAll(/<(\d+):(\d+(?:\.\d+)?)>/g)];
    const text = content.replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    const seconds = tag => Number(tag[1]) * 60 + Number(tag[2]);
    for (const stamp of stamps) {
      const at = seconds(stamp);
      if (!Number.isFinite(at) || at > 86400) continue;
      // Enhanced LRC supplies absolute word timestamps. Repeated line stamps
      // cannot safely share them, so those rows retain line synchronization.
      const words = stamps.length === 1 && tags[0]?.index === 0 ? tags.flatMap((tag, i) => {
        const next = tags[i+1];
        const word = content.slice(tag.index + tag[0].length, next?.index ?? content.length);
        return word ? [{text:word, at:seconds(tag), ...(next ? {end:seconds(next)} : {})}] : [];
      }) : [];
      // A final empty word tag is an explicit vocal end, not another word.
      const end = words.length > 0 && tags.at(-1)?.index + tags.at(-1)?.[0].length === content.length
        ? seconds(tags.at(-1)) : undefined;
      lines.push({at, text, words, ...(end >= at ? {end} : {})});
      if (lines.length >= 3000) return timedLyrics(lines);
    }
  }
  return timedLyrics(lines);
}

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

export function lyricFrame(lines, time, duration = Infinity) {
  if (!Number.isFinite(time) || time < 0 || time >= duration) return [];
  const active=[];let next=0;
  for (let i=0;i<lines.length && lines[i].at<=time;i++) {
    const line=lines[i];
    // Two singers may share a timestamp. Neither row should disappear merely
    // because the other starts at exactly the same instant.
    if(next<=i){next=i+1;while(next<lines.length && lines[next].at===line.at)next++;}
    const end=Math.min(line.end ?? lines[next]?.at ?? duration,duration);
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
