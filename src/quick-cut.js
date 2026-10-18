// Stream copy is deliberately separate from rendered projects: it cannot apply effects or mix tracks.
export function losslessSelection(project) {
  if (!Array.isArray(project?.clips) || project.clips.length !== 1) throw Error("Lossless trim needs one clip. Use the normal export for multiple clips.");
  if (project.music || (Array.isArray(project.audio) && project.audio.length)) throw Error("Remove background music and separate sounds before using lossless trim.");
  const clip = project.clips[0], look = clip.look || {};
  const defaults = {speed:1,volume:1,fadeIn:false,fadeOut:false,rotate:0,flip:false,brightness:0,contrast:1,saturation:1,transition:"none"};
  if (Object.entries(defaults).some(([key,value]) => (look[key] ?? value) !== value) || String(look.caption || "").trim()) {
    throw Error("Lossless trim cannot apply effects. Reset the clip settings or use the normal export.");
  }
  if (!Number.isSafeInteger(clip.jobId) || clip.jobId < 0 || !Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || clip.end - clip.start < .1 - 1e-9) {
    throw Error("Keep at least 0.1 seconds within the source duration.");
  }
  return {id:clip.jobId,start:clip.start,end:clip.end};
}

export function preciseCutTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const milliseconds = Math.round(seconds * 1000), minutes = Math.floor(milliseconds / 60000);
  return `${minutes}:${String(Math.floor(milliseconds % 60000 / 1000)).padStart(2,"0")}.${String(milliseconds % 1000).padStart(3,"0")}`;
}
