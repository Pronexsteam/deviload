import {musicGain,DEFAULT_MUSIC_GAIN} from "./music-volume.js";
export function tracks(items) {
  const seen = new Set();
  return items.filter(item => item?.kind === "song" && typeof item.title === "string" && /^[\w-]{11}$/.test(item.id) && !seen.has(item.id) && seen.add(item.id));
}

// Keep metadata for the complete collection. Only visible queue rows are mounted;
// trimming metadata here silently excludes most of a large library from shuffle.
export function playbackQueue(items,startId) {
  return tracks(items);
}

export function remember(list, item, limit = 80) {
  return tracks([item, ...list]).slice(0, limit);
}

export function nextIndex(queue, index, repeat, shuffle, random = Math.random) {
  if (!queue.length) return -1;
  if (shuffle && queue.length > 1) return (index + 1 + Math.floor(random() * (queue.length - 1))) % queue.length;
  if (index + 1 < queue.length) return index + 1;
  return repeat ? 0 : -1;
}

export function reorderTrack(queue, id, position) {
  const from=queue.findIndex(item=>item.id===id);
  if(from<0||!Number.isInteger(position))return queue;
  const result=[...queue],item=result.splice(from,1)[0];
  result.splice(Math.max(0,Math.min(result.length,position)),0,item);
  return result;
}

export function insertNext(queue, currentId, item) {
  if(!tracks([item]).length||item.id===currentId)return queue;
  const result=queue.filter(track=>track.id!==item.id),index=result.findIndex(track=>track.id===currentId);
  result.splice(index+1,0,item);return result;
}

export function restoreRemoved(queue, item, position) {
  if(!tracks([item]).length||queue.some(track=>track.id===item.id))return queue;
  const result=[...queue];result.splice(Math.max(0,Math.min(result.length,position)),0,item);return result;
}

export function readMusicState(storage) {
  try {
    const state = JSON.parse(storage.getItem("deviload-music-v1") || "{}");
    return {favorites:tracks(Array.isArray(state.favorites) ? state.favorites : []),
      recent:tracks(Array.isArray(state.recent) ? state.recent : []).slice(0,80),
      volume:musicGain(state.volume),...(Number.isFinite(state.volumeBeforeMute)&&state.volumeBeforeMute>0?{volumeBeforeMute:musicGain(state.volumeBeforeMute)}:{})};
  } catch { return {favorites:[],recent:[],volume:DEFAULT_MUSIC_GAIN}; }
}
