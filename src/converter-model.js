// Shared by the converter controls and tests; FFmpeg remains the only conversion engine.
export const RESOLUTIONS = Object.freeze(["original", "1080", "720", "480"]);
export const QUALITIES = Object.freeze(["balanced", "high", "smaller"]);
export const PRESETS = Object.freeze(["mp4", "mp3", "audio", "remux", "gif", "size"]);
export const CONTAINERS = Object.freeze(["mkv", "mp4", "mov"]);

export function conversionOptions({preset = "mp4", resolution = "original", quality = "balanced", megabytes = 10, folder = "", container = "mkv"} = {}) {
  if (!PRESETS.includes(preset)) throw new Error("Unknown conversion");
  if (!RESOLUTIONS.includes(resolution)) throw new Error("Unknown output resolution");
  if (!QUALITIES.includes(quality)) throw new Error("Unknown conversion quality");
  if (!CONTAINERS.includes(container)) throw new Error("Choose MP4, MKV or MOV as the container.");
  const amount = Number(megabytes);
  if (preset === "size" && (!Number.isInteger(amount) || amount < 1 || amount > 4000)) throw new Error("Pick a size from 1 to 4000 MB");
  return Object.freeze({preset, resolution, quality, megabytes: Number.isFinite(amount) ? amount : 10, folder: String(folder || ""), container});
}

export function mediaTracks(file, kind) {
  if (Array.isArray(file?.tracks)) return file.tracks.filter(track => track.kind === kind);
  // Keep a useful UI with older probe fixtures/callers; the backend independently
  // resolves and validates every selected index before it starts FFmpeg.
  if (kind === "video" && file?.video) return [{index:file.videoIndex || 0,kind,codec:file.videoCodec || "",language:"",title:""}];
  if (kind === "audio" && file?.audio) return [{index:file.video ? 1 : 0,kind,codec:file.audioCodec || "",language:"",title:""}];
  return [];
}

export function originalAudioExtension(codec) { return {aac:"m4a",opus:"opus",flac:"flac"}[codec] || ""; }

export function copyCompatible(container, track) {
  if (container === "mkv") return track.kind !== "subtitle" || ["subrip","ass","ssa","webvtt","dvd_subtitle","hdmv_pgs_subtitle"].includes(track.codec);
  if (!["mp4","mov"].includes(container)) return false;
  if (track.kind === "video") return (container === "mov" ? ["h264","hevc","mpeg4","prores","mjpeg"] : ["h264","hevc","mpeg4","av1"]).includes(track.codec);
  if (track.kind === "audio") return ["aac","mp3","ac3","eac3","alac"].includes(track.codec) || (container === "mov" && track.codec.startsWith("pcm_"));
  return track.kind === "subtitle" && track.codec === "mov_text";
}

export function textSubtitle(track) { return ["mov_text","subrip","ass","ssa","webvtt","text"].includes(track.codec); }

// Stream indices belong to one file. Never reuse an index from the highlighted
// file across a batch: each file keeps its own explicit selection.
export function trackOptions(file, preset) {
  const picked = file.selection || {}, videos = mediaTracks(file,"video"), sounds = mediaTracks(file,"audio");
  const videoTrack = videos.find(track => track.index === picked.videoTrack)?.index ?? videos[0]?.index;
  let audioTracks = Array.isArray(picked.audioTracks) ? [...picked.audioTracks] : sounds.slice(0,1).map(track => track.index);
  if (preset === "audio") {
    const eligible = sounds.filter(track => originalAudioExtension(track.codec));
    audioTracks = [audioTracks.map(index => eligible.find(track => track.index === index)).find(Boolean) || eligible[0]].filter(Boolean).map(track => track.index);
  } else if (["mp3","size"].includes(preset)) audioTracks = audioTracks.slice(0,1);
  else if (preset === "gif") audioTracks = [];
  const subtitleTracks = ["remux","mp4"].includes(preset) ? [...(picked.subtitleTracks || [])] : [];
  return Object.freeze({...(videoTrack === undefined ? {} : {videoTrack}),audioTracks:Object.freeze(audioTracks),subtitleTracks:Object.freeze(subtitleTracks)});
}

// A portrait video uses the same box turned upright. Neither dimension grows.
export function outputDimensions(width, height, resolution = "original") {
  if (!RESOLUTIONS.includes(resolution) || !Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return null;
  const boxes = {"1080": [1920, 1080], "720": [1280, 720], "480": [854, 480]};
  let scale = 1;
  if (resolution !== "original") {
    const [long, short] = boxes[resolution];
    scale = Math.min(1, (width >= height ? long : short) / width, (width >= height ? short : long) / height);
  }
  return {width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2)};
}

export function actionError(file, preset) {
  if ((preset === "mp3" || preset === "audio") && !file.audio) return "This file has no sound";
  if (preset === "audio" && !mediaTracks(file,"audio").some(track => originalAudioExtension(track.codec))) return "Original audio extraction supports AAC, Opus and FLAC. Choose MP3 to convert this track.";
  if ((preset === "mp4" || preset === "gif") && !file.video) return "This file has no picture. Pick MP3 for sound";
  if (preset === "gif" && file.duration > 60.5) return "A GIF can be up to 60 seconds. Trim the video in Devil Cut first";
  return "";
}

export function jobError(file, preset, container = "mkv", selection = trackOptions(file,preset)) {
  const unavailable = actionError(file,preset);
  if (unavailable) return unavailable;
  const selected = kind => mediaTracks(file,kind).filter(track => (selection[kind === "audio" ? "audioTracks" : "subtitleTracks"] || []).includes(track.index));
  const audio = selected("audio"), subtitles = selected("subtitle");
  if (["mp3","audio"].includes(preset) && audio.length !== 1) return "Choose one audio track for extraction.";
  if (preset === "remux") {
    const video = mediaTracks(file,"video").filter(track => track.index === selection.videoTrack);
    if (![...video,...audio,...subtitles].every(track => copyCompatible(container,track))) return "A selected track cannot be copied into this container. Choose MKV, omit that track or convert to MP4.";
    if (!video.length && !audio.length) return "Select at least one video or audio track.";
  }
  if (preset === "mp4" && subtitles.some(track => !textSubtitle(track))) return "MP4 conversion supports text subtitles. Use MKV remux for picture subtitles.";
  return "";
}

// Checks happen inside the serialized operation, after the previous probe has
// appended its files. Concurrent drops cannot sneak past the cap or deduplication.
export function serialFileAdder({items, probe, append, limit = 100, windows = false}) {
  let tail = Promise.resolve();
  const key = value => windows ? value.replaceAll("\\", "/").toLowerCase() : value;
  return paths => {
    const requested = Array.isArray(paths) ? paths.filter(path => typeof path === "string" && path) : [];
    const operation = tail.then(async () => {
      const known = new Set(items.map(item => key(item.path)));
      const fresh = requested.filter(path => { const value = key(path); if (known.has(value)) return false; known.add(value); return true; });
      if (!fresh.length) return [];
      if (items.length + fresh.length > limit) throw new Error("Add up to 100 files at a time");
      const files = await probe(fresh);
      append(files);
      return files;
    });
    tail = operation.catch(() => {});
    return operation;
  };
}
