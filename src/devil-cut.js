// Devil Cut: a small editor in the spirit of CapCut. Clips play straight from
// the downloaded files; the preview applies speed, sound, rotation, mirror,
// color and captions live, and FFmpeg renders the same settings. Under the
// video track sit the clips' own sound, sounds detached from clips and music.
import {setPose} from "./mascot-spot.js";

const DEFAULT_LOOK = Object.freeze({speed:1, volume:1, fadeIn:false, fadeOut:false, rotate:0, flip:false,
  brightness:0, contrast:1, saturation:1, caption:"", captionPosition:"bottom", captionStyle:"outline", transition:"none"});
const FRAME = 1 / 30;
// Pixels per second: a two-hour project still fits the screen, one frame still gets several pixels.
const MIN_ZOOM = 0.1, MAX_ZOOM = 400;
const MAX_CLIPS = 60, MAX_SOUNDS = 40;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
// Height of one row of detached sounds; overlapping sounds stack in rows.
const SOUND_ROW = 30;
const TIMELINE_KEY = "devil-cut-timeline";
const fileName = path => (path || "").split(/[\\/]/).pop();

// Projects are stored by id. Early versions keyed them by title as {clips, audioId};
// those get a stable id derived from the title.
export function normalizeProjects(data) {
  const result = {};
  const legacy = [];
  for (const [key, value] of Object.entries(data || {})) {
    if (!value || typeof value !== "object") continue;
    if ("canvas" in value || "updated" in value) result[key] = value;
    else legacy.push([key, value]);
  }
  for (const [title, value] of legacy) {
    let hash = 0;
    for (const char of title) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    const id = "legacy-" + hash.toString(36);
    if (result[id]) continue;
    result[id] = {name:title, canvas:"16:9", fit:"fit", updated:0,
      music:value.audioId ? {jobId:value.audioId, volume:0.35} : null,
      clips:(value.clips || []).map(clip => ({jobId:clip.jobId, start:clip.start, end:clip.end, look:{...DEFAULT_LOOK}}))};
  }
  return result;
}

// The Devil Cut page of the main window: recent videos and saved projects.
export function createCutHome(env) {
  const {t, node} = env;
  const $ = id => document.getElementById(id);
  let projects = {}, shown = "";
  function render() {
    const videoList = $("editor-home-videos"), projectList = $("editor-home-projects");
    const videos = env.getJobs().filter(job => env.isVideoJob(job) && !job.hiddenInLibrary).reverse().slice(0, 6);
    // Called on every queue poll; the lists are rebuilt only when they change.
    const key = JSON.stringify([t("Untitled project"), videos.map(job => [job.id, job.file]), projects]);
    if (key === shown) return;
    shown = key;
    videoList.replaceChildren();
    projectList.replaceChildren();
    if (!videos.length) videoList.append(node("p", "editor-home-empty", t("Download a video first and it will show up here.")));
    for (const job of videos) {
      const button = node("button", "editor-home-item", fileName(job.file));
      button.type = "button";
      button.title = t("Start a project with this video");
      button.addEventListener("click", () => env.openEditor({job:job.id}));
      videoList.append(button);
    }
    const saved = Object.entries(projects).sort(([, a], [, b]) => (b.updated || 0) - (a.updated || 0));
    if (!saved.length) projectList.append(node("p", "editor-home-empty", t("Projects are saved by themselves while you edit.")));
    for (const [id, data] of saved) {
      const row = node("div", "editor-home-project");
      const clips = Array.isArray(data.clips) ? data.clips.length : 0;
      const openButton = node("button", "editor-home-item", t("{title} · {count} clips", {title:data.name || t("Untitled project"), count:clips}));
      openButton.type = "button";
      openButton.addEventListener("click", () => env.openEditor({project:id}));
      const remove = node("button", "quiet small", "×");
      remove.type = "button";
      remove.title = t("Delete the project");
      remove.setAttribute("aria-label", t("Delete the project"));
      remove.addEventListener("click", async () => {
        const ask = window.__TAURI__?.dialog?.ask;
        if (ask && !(await ask(t("Delete this project? The videos stay on the disk."), {title:"Devil Cut", kind:"warning"}))) return;
        delete projects[id];
        render();
        await env.deleteProject(id);
      });
      row.append(openButton, remove);
      projectList.append(row);
    }
  }
  return {
    open:(jobId = null) => env.openEditor(jobId === null ? {} : {job:jobId}),
    setProjects:data => { projects = normalizeProjects(data); render(); },
    refresh:render,
    relabel:render,
  };
}

export function createDevilCut(env) {
  const {invoke, convertFileSrc, t, message, node, errorText, mediaPreview} = env;
  const $ = id => document.getElementById(id);
  const dialog = $("edit-dialog"), video = $("edit-video"), backdrop = $("cut-backdrop"), music = $("cut-music-player");
  const sources = new Map();
  let project = null, projectId = null, saveTimer = 0;
  let selected = -1, selectedSound = -1, current = 0, playhead = 0, pxPerSecond = 60, playing = false, frameRequest = 0;
  let history = [], future = [], pendingEdit = null, loadedJob = null, mediaTab = "video", lastOutput = "";
  let typingName = false, zoomTouched = false, fullscreen = false;
  // Exact frames for the zoomed-in strip, keyed by "job:second"; "" means pending or unavailable.
  const frameCache = new Map();
  let frameQueue = new Map(), frameTimer = 0, stripFrame = 0;

  const jobs = () => env.getJobs();
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const clipLength = clip => (clip.end - clip.start) / clip.look.speed;
  const soundLength = sound => (sound.end - sound.start) / sound.speed;
  // A clip with a transition starts before the previous one ends (the same rule as the export).
  const overlapOf = index => {
    const clip = project.clips[index], previous = project.clips[index - 1];
    if (!clip || !previous || clip.look.transition === "none") return 0;
    return Math.min(0.5, clipLength(previous) / 2, clipLength(clip) / 2);
  };
  const offsetOf = index => project.clips.slice(0, index).reduce((sum, clip, position) => sum + clipLength(clip) - overlapOf(position), 0) - overlapOf(index);
  const total = () => project?.clips.length ? offsetOf(project.clips.length - 1) + clipLength(project.clips.at(-1)) : 0;
  const clock = seconds => {
    const value = Math.max(0, Number(seconds) || 0);
    return Math.floor(value / 60) + ":" + (value % 60).toFixed(1).padStart(4, "0");
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  const chip = name => document.querySelector(`[data-chips="${name}"] .selected`)?.dataset.value ?? "";

  function status(text, error = false) {
    $("edit-status").textContent = text;
    $("edit-status").classList.toggle("error", error);
  }
  function defaultStatus() {
    status(t("Space plays, Ctrl+B splits, Delete removes, Ctrl+Z undoes. Drag clips to reorder them and their edges to trim."));
  }
  function clipAt(time) {
    for (let index = 0; index < project.clips.length; index++) {
      const next = index + 1 < project.clips.length ? offsetOf(index + 1) : Infinity;
      if (time < next) return {index, offset:offsetOf(index)};
    }
    return null;
  }

  async function loadSource(jobId) {
    if (sources.has(jobId)) return sources.get(jobId);
    const info = await invoke("editor_info", {id:jobId, frames:10});
    let url = "";
    try { url = convertFileSrc(await invoke("media_source", {id:jobId})); } catch { url = ""; }
    const source = {duration:info.duration, thumbnails:info.thumbnails, name:info.fileName, url};
    sources.set(jobId, source);
    return source;
  }

  // History: every change stores the previous state first.
  const snapshot = () => JSON.stringify(project);
  function commit() {
    history.push(snapshot());
    if (history.length > 100) history.shift();
    future = [];
  }
  function beginEdit() { if (pendingEdit === null) pendingEdit = snapshot(); }
  function endEdit() {
    if (pendingEdit === null) return;
    if (pendingEdit !== snapshot()) { history.push(pendingEdit); future = []; }
    pendingEdit = null;
    save();
    render();
  }
  function changed() { save(); render(); }
  function undo() {
    if (!history.length) return;
    future.push(snapshot());
    project = JSON.parse(history.pop());
    keepSelection();
    changed();
    seek(playhead);
  }
  function redo() {
    if (!future.length) return;
    history.push(snapshot());
    project = JSON.parse(future.pop());
    keepSelection();
    changed();
    seek(playhead);
  }
  function keepSelection() {
    selected = Math.min(selected, project.clips.length - 1);
    selectedSound = Math.min(selectedSound, project.audio.length - 1);
  }
  function save() {
    if (!project) return;
    project.updated = Date.now();
    const id = projectId, data = copy(project);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = 0; env.saveProject(id, data).catch(error => status(errorText(error), true)); }, 250);
  }
  function flushSave() {
    if (!saveTimer || !project) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    env.saveProject(projectId, copy(project)).catch(() => {});
  }

  function normalize(data) {
    const known = new Set(jobs().filter(env.isVideoJob).map(job => job.id));
    const clips = (Array.isArray(data.clips) ? data.clips : [])
      .filter(clip => Number.isSafeInteger(clip.jobId) && known.has(clip.jobId) && Number.isFinite(clip.start) && Number.isFinite(clip.end) && clip.end > clip.start)
      .slice(0, MAX_CLIPS).map(clip => ({jobId:clip.jobId, start:clip.start, end:clip.end, look:{...DEFAULT_LOOK, ...(clip.look || {})}}));
    return {name:String(data.name || "").slice(0, 60), canvas:["16:9", "9:16", "1:1", "4:5"].includes(data.canvas) ? data.canvas : "16:9",
      fit:["fit", "fill", "blur"].includes(data.fit) ? data.fit : "fit",
      music:data.music && Number.isSafeInteger(data.music.jobId) ? {jobId:data.music.jobId, volume:clamp(Number(data.music.volume) || 0.35, 0, 2)} : null,
      clips, audio:normalizeSounds(data.audio, known), updated:data.updated || Date.now()};
  }
  function normalizeSounds(list, known) {
    const volume = value => Number.isFinite(Number(value)) ? clamp(Number(value), 0, 2) : 1;
    return (Array.isArray(list) ? list : [])
      .filter(sound => Number.isSafeInteger(sound.jobId) && known.has(sound.jobId) && Number.isFinite(sound.start) && Number.isFinite(sound.end) && sound.end > sound.start && Number.isFinite(sound.at))
      .slice(0, MAX_SOUNDS).map(sound => ({jobId:sound.jobId, start:Math.max(0, sound.start), end:sound.end, at:Math.max(0, sound.at),
        speed:SPEEDS.includes(sound.speed) ? sound.speed : 1, volume:volume(sound.volume), fadeIn:Boolean(sound.fadeIn), fadeOut:Boolean(sound.fadeOut)}));
  }

  async function openData(id, data) {
    pause();
    projectId = id;
    project = normalize(data);
    selected = project.clips.length ? 0 : -1;
    selectedSound = -1;
    playhead = 0; current = 0; history = []; future = []; pendingEdit = null; loadedJob = null; lastOutput = "";
    video.removeAttribute("src"); backdrop.removeAttribute("src");
    defaultStatus();
    renderMedia();
    render();
    await Promise.all([...project.clips, ...project.audio].map(item => loadSource(item.jobId).catch(() => null)));
    await prepareMusic().catch(() => {});
    zoomTouched = false;
    fitZoom();
    render();
    seek(0);
  }
  async function open(jobId = null) {
    await openData("p" + Date.now().toString(36), {});
    if (jobId !== null) await addClip(jobId);
  }
  async function openProject(id) {
    const saved = normalizeProjects(await env.loadProjects());
    if (saved[id]) await openData(id, saved[id]);
    else await open();
  }

  async function addClip(jobId) {
    if (project.clips.length >= MAX_CLIPS) { status(t("A project holds up to 60 clips."), true); return; }
    try {
      const source = await loadSource(jobId);
      commit();
      project.clips.push({jobId, start:0, end:source.duration, look:{...DEFAULT_LOOK}});
      selected = project.clips.length - 1;
      if (!project.name) project.name = source.name.replace(/\.[^.]+$/, "").slice(0, 60);
      if (!zoomTouched) fitZoom();
      changed();
      if (project.clips.length === 1) seek(0);
    } catch (error) { status(errorText(error), true); }
  }
  async function setMusic(jobId) {
    commit();
    project.music = jobId === null ? null : {jobId, volume:0.35};
    changed();
    await prepareMusic().catch(error => status(errorText(error), true));
  }
  async function prepareMusic() {
    music.pause();
    if (!project?.music) { music.removeAttribute("src"); return; }
    music.src = convertFileSrc(await invoke("media_source", {id:project.music.jobId}));
    music.loop = true;
    music.volume = Math.min(1, project.music.volume);
  }
  music.addEventListener("loadedmetadata", () => render());

  // Sound waves: one picture per file, positioned to the part a clip uses.
  const waves = new Map();
  function paintWave(element, jobId, start, end, loop = false) {
    const picture = waves.get(jobId);
    if (picture === undefined) {
      waves.set(jobId, null);
      invoke("editor_waveform", {id:jobId}).then(url => { waves.set(jobId, url || ""); if (url) render(); }).catch(() => waves.set(jobId, ""));
      return;
    }
    if (!picture) return;
    const duration = loop ? end : (sources.get(jobId)?.duration || end);
    if (!Number.isFinite(duration) || duration <= 0) return;
    element.style.backgroundImage = `url("${picture}")`;
    if (loop) {
      element.style.backgroundSize = `${duration * pxPerSecond}px 100%`;
      element.style.backgroundRepeat = "repeat-x";
      return;
    }
    const used = end - start;
    element.style.backgroundSize = `${duration / used * 100}% 100%`;
    element.style.backgroundPosition = `${duration > used ? start / (duration - used) * 100 : 0}% 0`;
  }
  const transitionNames = {none:"Cut", fade:"Crossfade", fadeblack:"Through black", slideleft:"Slide", wipeleft:"Wipe", circleopen:"Circle"};
  function transitionName(value) { return t(transitionNames[value] || "Cut"); }

  // Preview
  function loadClipMedia(index) {
    const clip = project.clips[index], source = sources.get(clip?.jobId);
    if (!source?.url) return false;
    if (loadedJob !== clip.jobId) { video.src = source.url; backdrop.src = source.url; loadedJob = clip.jobId; }
    return true;
  }
  function setVideoTime(second) {
    const apply = () => { video.currentTime = second; backdrop.currentTime = second; };
    if (video.readyState >= 1) apply(); else video.addEventListener("loadedmetadata", apply, {once:true});
  }
  function applyLook(clip) {
    const look = clip.look, frame = $("cut-frame");
    video.playbackRate = look.speed;
    backdrop.playbackRate = look.speed;
    video.volume = Math.min(1, look.volume);
    video.muted = look.volume === 0;
    frame.style.setProperty("--rotate", look.rotate + "deg");
    frame.style.setProperty("--mirror", look.flip ? "-1" : "1");
    frame.dataset.turned = String([90, 270].includes(look.rotate));
    frame.style.filter = `brightness(${(1 + look.brightness * 1.6).toFixed(3)}) contrast(${look.contrast}) saturate(${look.saturation})`;
    const caption = $("cut-caption-preview");
    caption.textContent = look.caption;
    caption.hidden = !look.caption.trim();
    caption.dataset.position = look.captionPosition;
    caption.dataset.style = look.captionStyle;
  }
  function syncMusic() {
    if (!project?.music || !music.getAttribute("src")) return;
    const length = music.duration;
    if (Number.isFinite(length) && length > 0) music.currentTime = playhead % length;
  }
  // Detached sounds play from their own audio elements beside the video.
  const soundPlayers = [];
  function syncSounds(jump = false) {
    if (!project) return;
    project.audio.forEach((sound, index) => {
      const url = sources.get(sound.jobId)?.url;
      const player = soundPlayers[index] ||= Object.assign(new Audio(), {preload:"auto"});
      if (!url) return;
      let place = jump;
      if (player.dataset.src !== url) { player.src = url; player.dataset.src = url; place = true; }
      const local = playhead - sound.at;
      if (local < 0 || local >= soundLength(sound)) { if (!player.paused) player.pause(); return; }
      player.playbackRate = sound.speed;
      player.volume = Math.min(1, sound.volume);
      const target = sound.start + local * sound.speed;
      // Small drift is fine; correcting it too often makes the sound stutter.
      const drift = Math.abs(player.currentTime - target) > 0.35 && !player.seeking && performance.now() - (player.placedAt || 0) > 1000;
      if (place || drift) { player.currentTime = target; player.placedAt = performance.now(); }
      if (playing && player.paused) player.play().catch(() => {});
      else if (!playing && !player.paused) player.pause();
    });
    for (const player of soundPlayers.slice(project.audio.length)) player.pause();
  }
  function seek(time) {
    if (!project?.clips.length) { playhead = 0; renderPlayhead(); updateEmpty(); return; }
    playhead = clamp(time, 0, total());
    const at = clipAt(Math.min(playhead, total() - 0.001));
    const clip = project.clips[at.index];
    current = at.index;
    if (loadClipMedia(at.index)) setVideoTime(clip.start + (playhead - at.offset) * clip.look.speed);
    applyLook(clip);
    syncMusic();
    syncSounds(true);
    renderPlayhead();
    updateEmpty();
  }
  function setPlayIcon() { $("cut-play").querySelector(".icon").dataset.icon = playing ? "pause" : "play"; }
  function play() {
    if (!project?.clips.length) return;
    if (playhead >= total() - 0.05) seek(0);
    playing = true;
    setPlayIcon();
    video.play().catch(() => {});
    backdrop.play().catch(() => {});
    if (project.music) music.play().catch(() => {});
    syncSounds(true);
    cancelAnimationFrame(frameRequest);
    frameRequest = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    video.pause(); backdrop.pause(); music.pause();
    for (const player of soundPlayers) player.pause();
    cancelAnimationFrame(frameRequest);
    if ($("cut-play")) setPlayIcon();
  }
  function tick() {
    if (!playing || !project) return;
    const clip = project.clips[current];
    if (!clip) { pause(); return; }
    const offset = offsetOf(current);
    const cutAt = clip.end - overlapOf(current + 1) * clip.look.speed;
    if (video.currentTime >= cutAt - 0.03 || video.ended) {
      if (current + 1 >= project.clips.length) { pause(); playhead = total(); renderPlayhead(); return; }
      current += 1;
      const next = project.clips[current];
      const reload = next.jobId !== loadedJob;
      loadClipMedia(current);
      applyLook(next);
      setVideoTime(next.start);
      if (reload) { video.play().catch(() => {}); backdrop.play().catch(() => {}); }
      playhead = offsetOf(current);
    } else {
      playhead = offset + Math.max(0, video.currentTime - clip.start) / clip.look.speed;
    }
    renderPlayhead();
    syncSounds();
    frameRequest = requestAnimationFrame(tick);
  }

  // Rendering
  function updateEmpty() {
    const empty = !project?.clips.length;
    $("cut-empty").hidden = !empty;
    $("cut-frame").hidden = empty;
    $("cut-play").disabled = empty;
  }
  function renderPlayhead() {
    const x = playhead * pxPerSecond;
    $("cut-playhead").style.left = x + "px";
    $("cut-time").textContent = clock(playhead) + " / " + clock(total());
    // While playing, the view follows the playhead.
    const scroll = $("cut-scroll");
    if (playing && (x > scroll.scrollLeft + scroll.clientWidth - 30 || x < scroll.scrollLeft)) scroll.scrollLeft = Math.max(0, x - 60);
  }
  function rulerStep() {
    for (const step of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800]) if (step * pxPerSecond >= 64) return step;
    return 3600;
  }
  function render() {
    if (!project) return;
    if (!typingName) $("cut-name").value = project.name;
    for (const button of document.querySelectorAll("[data-canvas]")) button.classList.toggle("selected", button.dataset.canvas === project.canvas);
    for (const button of document.querySelectorAll("[data-fit]")) button.classList.toggle("selected", button.dataset.fit === project.fit);
    $("cut-stage").dataset.canvas = project.canvas;
    $("cut-stage").dataset.fit = project.fit;
    const length = total();
    const soundEnd = project.audio.reduce((end, sound) => Math.max(end, sound.at + soundLength(sound)), 0);
    const width = Math.max(Math.max(length, soundEnd) * pxPerSecond + 240, $("cut-scroll").clientWidth);
    $("cut-lane").style.width = width + "px";
    renderRuler();
    const track = $("cut-video-track"), soundTrack = $("cut-sound-track");
    track.replaceChildren();
    soundTrack.replaceChildren();
    project.clips.forEach((clip, index) => {
      const source = sources.get(clip.jobId);
      const block = node("div", "cut-clip" + (index === selected ? " selected" : ""));
      block.dataset.index = String(index);
      block.style.width = Math.max(10, clipLength(clip) * pxPerSecond) + "px";
      const overlap = overlapOf(index);
      if (overlap) {
        block.style.marginLeft = -(overlap * pxPerSecond) + "px";
        block.classList.add("has-transition");
        block.title = t("Transition: {name}", {name:transitionName(clip.look.transition)});
      }
      const strip = node("div", "cut-clip-strip");
      const badges = [];
      if (clip.look.speed !== 1) badges.push(clip.look.speed + "×");
      if (clip.look.caption.trim()) badges.push("T");
      const label = node("span", "cut-clip-label", (source?.name || t("Unavailable file")).replace(/\.[^.]+$/, ""));
      const info = node("span", "cut-clip-info", [clock(clipLength(clip)), ...badges].join(" · "));
      block.append(strip, label, info, node("span", "cut-trim cut-trim-start"), node("span", "cut-trim cut-trim-end"));
      track.append(block);
      // The clip's own sound, lined up under the picture.
      const sound = node("div", "cut-sound" + (index === selected ? " selected" : "") + (clip.look.volume === 0 ? " muted" : ""));
      sound.dataset.index = String(index);
      sound.style.width = block.style.width;
      sound.style.marginLeft = block.style.marginLeft;
      const wave = node("div", "cut-clip-wave");
      paintWave(wave, clip.jobId, clip.start, clip.end);
      sound.append(wave);
      if (clip.look.volume !== 1) sound.append(node("span", "cut-sound-label", clip.look.volume === 0 ? t("No sound") : Math.round(clip.look.volume * 100) + "%"));
      soundTrack.append(sound);
    });
    renderStrips();
    renderSounds();
    const musicTrack = $("cut-music-track");
    musicTrack.replaceChildren();
    if (project.music) {
      const job = jobs().find(item => item.id === project.music.jobId);
      const block = node("div", "cut-music");
      block.style.width = Math.max(length, 1) * pxPerSecond + "px";
      const wave = node("div", "cut-clip-wave cut-music-wave");
      paintWave(wave, project.music.jobId, 0, music.duration, true);
      block.append(wave, node("span", "cut-clip-label", "♪ " + (fileName(job?.file) || t("Unavailable file"))));
      const volume = node("input");
      volume.type = "range"; volume.min = "0"; volume.max = "200"; volume.step = "5";
      volume.value = String(Math.round(project.music.volume * 100));
      volume.title = t("Music volume");
      volume.setAttribute("aria-label", t("Music volume"));
      volume.addEventListener("input", () => { beginEdit(); project.music.volume = Number(volume.value) / 100; music.volume = Math.min(1, project.music.volume); });
      volume.addEventListener("change", endEdit);
      const remove = node("button", "cut-music-remove", "×");
      remove.type = "button";
      remove.title = t("Remove the music");
      remove.setAttribute("aria-label", t("Remove the music"));
      remove.addEventListener("click", () => setMusic(null));
      block.append(volume, remove);
      musicTrack.append(block);
    } else musicTrack.append(node("span", "cut-track-hint", t("Background music: pick a track in the Music tab on the left.")));
    $("cut-total").textContent = t("Total: {time}", {time:clock(length)});
    $("cut-zoom").value = String(zoomToSlider(pxPerSecond));
    $("cut-undo").disabled = !history.length;
    $("cut-redo").disabled = !future.length;
    renderTools();
    renderInspector();
    renderPlayhead();
    updateEmpty();
    renderExportSummary();
  }
  function coarseFrame(source, second) {
    const list = source.thumbnails;
    return list[Math.min(list.length - 1, Math.max(0, Math.floor(second / source.duration * list.length)))];
  }
  function frameFor(clip, source, second, step) {
    const time = Math.round(second * 10) / 10, key = clip.jobId + ":" + time.toFixed(1);
    const exact = frameCache.get(key);
    if (exact) return exact;
    const slotSeconds = step / pxPerSecond * clip.look.speed;
    if (exact === undefined && slotSeconds < source.duration / source.thumbnails.length * 0.8) {
      frameCache.set(key, "");
      if (!frameQueue.has(clip.jobId)) frameQueue.set(clip.jobId, new Set());
      frameQueue.get(clip.jobId).add(time);
      clearTimeout(frameTimer);
      frameTimer = setTimeout(fetchFrames, 120);
    }
    return coarseFrame(source, second);
  }
  async function fetchFrames() {
    const batches = [...frameQueue.entries()];
    frameQueue = new Map();
    for (const [jobId, set] of batches) {
      const times = [...set];
      for (let index = 0; index < times.length; index += 48) {
        const part = times.slice(index, index + 48);
        try {
          const frames = await invoke("editor_thumbnails", {id:jobId, times:part});
          part.forEach((time, position) => { if (frames[position]) frameCache.set(jobId + ":" + time.toFixed(1), frames[position]); });
        } catch { /* The coarse strip stays. */ }
      }
    }
    // Long videos would keep every frame ever shown; drop the oldest ones.
    if (frameCache.size > 4000) for (const key of [...frameCache.keys()].slice(0, 1500)) frameCache.delete(key);
    renderStrips();
  }
  // The part of the timeline in view, with half a screen on each side.
  function viewRange() {
    const scroll = $("cut-scroll");
    return {from:scroll.scrollLeft - scroll.clientWidth / 2, to:scroll.scrollLeft + scroll.clientWidth * 1.5};
  }
  function renderRuler() {
    if (!project) return;
    const {from, to} = viewRange(), step = rulerStep(), ticks = [];
    for (let index = Math.max(0, Math.floor(from / pxPerSecond / step)); index * step * pxPerSecond <= to; index++) {
      const time = index * step;
      const tick = node("span", "cut-tick", clock(time).replace(/\.0$/, ""));
      tick.style.left = time * pxPerSecond + "px";
      ticks.push(tick);
    }
    $("cut-ruler").replaceChildren(...ticks);
  }
  // Frame pictures are about as wide as the track is tall, so taller tracks show bigger frames.
  const slotWidth = () => Math.max(56, Math.round(($("cut-video-track").clientHeight || 74) * 1.35));
  // Each clip gets frame pictures only where the view is; a long video no longer builds thousands of them.
  function renderStrips() {
    if (!project) return;
    const {from, to} = viewRange(), slot = slotWidth();
    for (const block of $("cut-video-track").children) {
      const index = Number(block.dataset.index), clip = project.clips[index], source = sources.get(clip?.jobId);
      const strip = block.querySelector(".cut-clip-strip");
      if (!clip || !source?.thumbnails?.length || !strip) continue;
      const left = offsetOf(index) * pxPerSecond, width = Math.max(10, clipLength(clip) * pxPerSecond);
      const count = Math.max(1, Math.round(width / slot)), step = width / count;
      const first = clamp(Math.floor((from - left) / step), 0, count), last = clamp(Math.ceil((to - left) / step), 0, count);
      const images = [];
      for (let position = first; position < last; position++) {
        const image = strip.children[images.length] || node("img");
        const src = frameFor(clip, source, clip.start + (position + 0.5) / count * (clip.end - clip.start), step);
        if (image.getAttribute("src") !== src) image.src = src;
        image.alt = "";
        image.draggable = false;
        image.style.left = position * step + "px";
        image.style.width = Math.ceil(step) + "px";
        images.push(image);
      }
      strip.replaceChildren(...images);
    }
  }
  // Detached sounds sit where they play; overlapping ones stack in rows.
  function renderSounds() {
    const track = $("cut-audio-track");
    track.replaceChildren();
    if (!project.audio.length) {
      track.style.height = "";
      track.append(node("span", "cut-track-hint", t("Separate sound: select a clip and press Detach sound.")));
      return;
    }
    const rows = [];
    const order = project.audio.map((sound, index) => index).sort((a, b) => project.audio[a].at - project.audio[b].at);
    for (const index of order) {
      const sound = project.audio[index];
      let row = rows.findIndex(end => end <= sound.at + 0.001);
      if (row < 0) { row = rows.length; rows.push(0); }
      rows[row] = sound.at + soundLength(sound);
      const block = node("div", "cut-piece" + (index === selectedSound ? " selected" : ""));
      block.dataset.index = String(index);
      block.style.left = sound.at * pxPerSecond + "px";
      block.style.top = row * SOUND_ROW + "px";
      block.style.width = Math.max(10, soundLength(sound) * pxPerSecond) + "px";
      const wave = node("div", "cut-clip-wave");
      paintWave(wave, sound.jobId, sound.start, sound.end);
      const name = (sources.get(sound.jobId)?.name || t("Unavailable file")).replace(/\.[^.]+$/, "");
      const label = node("span", "cut-piece-label", sound.volume === 1 ? name : `${name} · ${Math.round(sound.volume * 100)}%`);
      block.title = name;
      block.append(wave, label, node("span", "cut-trim cut-trim-start"), node("span", "cut-trim cut-trim-end"));
      track.append(block);
    }
    track.style.height = rows.length * SOUND_ROW + "px";
  }
  function renderExportSummary() {
    if (!project) return;
    const format = chip("format");
    const label = format === "mp3" ? "MP3" : format === "gif" ? "GIF" : `MP4 ${chip("quality")}p`;
    $("cut-export-summary").textContent = t("{length} · {canvas} · {format}", {length:clock(total()), canvas:project.canvas, format:label});
  }
  function selectChips(name, value) {
    for (const button of document.querySelectorAll(`[data-look="${name}"] button`)) {
      const on = button.dataset.value === String(value);
      button.classList.toggle("selected", on);
      button.setAttribute("aria-pressed", String(on));
    }
  }
  function renderInspector() {
    const clip = project?.clips[selected], sound = project?.audio[selectedSound];
    $("cut-inspector-empty").hidden = Boolean(clip || sound);
    $("cut-inspector-body").hidden = !clip;
    $("cut-sound-body").hidden = !sound;
    if (sound) {
      $("cut-sound-name").textContent = (sources.get(sound.jobId)?.name || t("Unavailable file")).replace(/\.[^.]+$/, "") + " · " + clock(soundLength(sound));
      $("cut-sound-volume").value = String(Math.round(sound.volume * 100));
      $("cut-sound-volume-value").textContent = Math.round(sound.volume * 100) + "%";
      $("cut-sound-fade-in").checked = sound.fadeIn;
      $("cut-sound-fade-out").checked = sound.fadeOut;
    }
    if (!clip) return;
    const look = clip.look;
    selectChips("speed", look.speed);
    selectChips("captionPosition", look.captionPosition);
    selectChips("captionStyle", look.captionStyle);
    selectChips("transition", look.transition);
    $("cut-transition-row").hidden = selected === 0;
    $("cut-volume").value = String(Math.round(look.volume * 100));
    $("cut-volume-value").textContent = Math.round(look.volume * 100) + "%";
    $("cut-fade-in").checked = look.fadeIn;
    $("cut-fade-out").checked = look.fadeOut;
    $("cut-flip").setAttribute("aria-pressed", String(look.flip));
    $("cut-flip").classList.toggle("selected", look.flip);
    for (const [id, value] of [["brightness", look.brightness * 100], ["contrast", (look.contrast - 1) * 100], ["saturation", (look.saturation - 1) * 100]]) {
      $("cut-" + id).value = String(Math.round(value));
      $("cut-" + id + "-value").textContent = (value > 0 ? "+" : "") + Math.round(value);
    }
    if (document.activeElement !== $("cut-caption")) $("cut-caption").value = look.caption;
  }

  function renderMedia() {
    const list = $("cut-media-list");
    list.replaceChildren();
    const audio = mediaTab === "audio";
    const items = jobs().filter(job => !job.hiddenInLibrary && (audio ? env.isLibraryAudio(job) : env.isVideoJob(job))).reverse();
    if (!items.length) list.append(node("p", "cut-note", t(audio ? "No finished audio yet." : "No finished videos yet.")));
    for (const job of items) {
      const item = node("div", "cut-media-item");
      const thumb = node("div", "cut-media-thumb");
      const preview = audio ? "" : mediaPreview(job.url);
      if (preview) {
        const image = node("img");
        image.src = preview; image.alt = ""; image.referrerPolicy = "no-referrer"; image.draggable = false;
        thumb.append(image);
      } else {
        const glyph = node("span", "icon");
        glyph.dataset.icon = audio ? "music-notes" : "video";
        thumb.append(glyph);
      }
      const name = node("span", "cut-media-name", fileName(job.file));
      name.title = fileName(job.file);
      const add = node("button", "cut-media-add", "+");
      add.type = "button";
      add.title = t(audio ? "Use as background music" : "Add to the end of the timeline");
      add.setAttribute("aria-label", add.title);
      add.addEventListener("click", () => audio ? setMusic(job.id) : addClip(job.id));
      item.append(thumb, name, add);
      list.append(item);
    }
  }

  // Tools
  function renderTools() {
    const clip = project?.clips[selected];
    for (const id of ["cut-split", "cut-duplicate", "cut-delete"]) $(id).disabled = selected < 0 && selectedSound < 0;
    $("cut-detach").disabled = !clip || clip.look.volume === 0 || waves.get(clip.jobId) === "";
  }
  function markSelection() {
    for (const block of document.querySelectorAll("#cut-video-track .cut-clip, #cut-sound-track .cut-sound")) block.classList.toggle("selected", Number(block.dataset.index) === selected);
    for (const block of document.querySelectorAll("#cut-audio-track .cut-piece")) block.classList.toggle("selected", Number(block.dataset.index) === selectedSound);
    renderInspector();
    renderTools();
  }
  function select(index) { selected = index; selectedSound = -1; markSelection(); }
  function selectSound(index) { selectedSound = index; selected = -1; markSelection(); }
  function split() {
    if (selectedSound >= 0) { splitSound(); return; }
    if (!project?.clips.length) return;
    const at = clipAt(Math.min(playhead, total() - 0.001));
    const clip = project.clips[at.index];
    const point = clip.start + (playhead - at.offset) * clip.look.speed;
    if (point - clip.start < 0.1 || clip.end - point < 0.1) { status(t("Move the playhead inside a clip to split it."), true); return; }
    commit();
    const second = copy(clip);
    clip.end = point; clip.look.fadeOut = false;
    second.start = point; second.look.fadeIn = false;
    project.clips.splice(at.index + 1, 0, second);
    selected = at.index + 1;
    changed();
  }
  function splitSound() {
    const sound = project.audio[selectedSound];
    const point = sound.start + (playhead - sound.at) * sound.speed;
    if (point - sound.start < 0.1 || sound.end - point < 0.1) { status(t("Move the playhead inside the sound to split it."), true); return; }
    if (project.audio.length >= MAX_SOUNDS) { status(t("A project holds up to 40 separate sounds."), true); return; }
    commit();
    const second = {...copy(sound), start:point, at:playhead, fadeIn:false};
    sound.end = point; sound.fadeOut = false;
    project.audio.splice(selectedSound + 1, 0, second);
    selectedSound += 1;
    changed();
    syncSounds(true);
  }
  function removeSelected() {
    if (selectedSound >= 0) {
      commit();
      project.audio.splice(selectedSound, 1);
      selectedSound = -1;
      changed();
      syncSounds(true);
      return;
    }
    if (selected < 0) return;
    commit();
    project.clips.splice(selected, 1);
    selected = Math.min(selected, project.clips.length - 1);
    changed();
    seek(Math.min(playhead, total()));
  }
  function duplicate() {
    if (selectedSound >= 0) {
      if (project.audio.length >= MAX_SOUNDS) { status(t("A project holds up to 40 separate sounds."), true); return; }
      commit();
      const sound = project.audio[selectedSound];
      project.audio.push({...copy(sound), at:sound.at + soundLength(sound)});
      selectedSound = project.audio.length - 1;
      changed();
      return;
    }
    if (selected < 0 || project.clips.length >= MAX_CLIPS) return;
    commit();
    project.clips.splice(selected + 1, 0, copy(project.clips[selected]));
    selected += 1;
    changed();
  }
  // The clip keeps its picture and goes silent; its sound becomes a piece that can move on its own.
  function detachSound() {
    const clip = project?.clips[selected];
    if (!clip) return;
    if (clip.look.volume === 0 || waves.get(clip.jobId) === "") { status(t("This clip has no sound to detach."), true); return; }
    if (project.audio.length >= MAX_SOUNDS) { status(t("A project holds up to 40 separate sounds."), true); return; }
    commit();
    const look = clip.look;
    project.audio.push({jobId:clip.jobId, start:clip.start, end:clip.end, at:offsetOf(selected), speed:look.speed, volume:look.volume, fadeIn:look.fadeIn, fadeOut:look.fadeOut});
    look.volume = 0;
    if (current === selected) applyLook(clip);
    selectedSound = project.audio.length - 1;
    selected = -1;
    changed();
    syncSounds(true);
    status(t("The sound has its own track now: drag it to move it, drag its edges to trim it."));
  }
  function fitZoom() {
    const width = $("cut-scroll").clientWidth - 60, length = total();
    if (length > 0 && width > 0) pxPerSecond = clamp(width / length, MIN_ZOOM, 160);
    $("cut-scroll").scrollLeft = 0;
  }
  const zoomToSlider = value => Math.round(Math.log(value / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM) * 100);
  const sliderToZoom = value => MIN_ZOOM * (MAX_ZOOM / MIN_ZOOM) ** (value / 100);
  // Keeps the time under `anchorX` (pixels from the left of the timeline view) in place.
  function setZoom(value, anchorTime = playhead, anchorX = null) {
    zoomTouched = true;
    const scroll = $("cut-scroll");
    const x = anchorX ?? scroll.clientWidth / 2;
    pxPerSecond = clamp(value, MIN_ZOOM, MAX_ZOOM);
    render();
    scroll.scrollLeft = anchorTime * pxPerSecond - x;
    renderStrips();
  }
  function zoom(factor) { setZoom(pxPerSecond * factor); }
  function setProgress(share) {
    const bar = $("cut-progress");
    if (share === null) { bar.hidden = true; return; }
    const percent = Math.round(clamp(share, 0, 1) * 100);
    bar.hidden = false;
    bar.setAttribute("aria-valuenow", String(percent));
    bar.firstElementChild.style.width = percent + "%";
  }
  async function exportProject() {
    if (!project?.clips.length) { status(t("Add at least one clip to export."), true); return; }
    $("cut-export-menu").open = false;
    pause();
    setProgress(0);
    status(t("FFmpeg is rendering the video. Long projects can take a few minutes…"));
    setPose($("cut-mascot"), "working");
    const button = $("cut-export");
    button.disabled = true;
    try {
      const output = await invoke("editor_render", {project:{
        clips:project.clips.map(clip => ({jobId:clip.jobId, start:clip.start, end:clip.end, look:clip.look})),
        audio:project.audio.map(sound => ({...sound})),
        canvas:project.canvas, fit:project.fit, music:project.music, format:chip("format"), quality:Number(chip("quality")),
      }});
      lastOutput = output;
      status(t("Done: {file}", {file:fileName(output)}));
      const reveal = node("button", "outline small", t("Show in folder"));
      reveal.type = "button";
      reveal.addEventListener("click", () => invoke("reveal_file", {path:lastOutput}).catch(error => status(errorText(error), true)));
      $("edit-status").append(" ", reveal);
      message(t("Devil Cut saved: {file}", {file:fileName(output)}));
      setPose($("cut-mascot"), "victory", "front", 3600);
    } catch (error) { status(errorText(error), true); setPose($("cut-mascot"), "error", "front", 4200); }
    finally { button.disabled = false; setTimeout(() => setProgress(null), 900); }
  }

  // Timeline pointer work: select, trim edges, reorder, move the playhead.
  const lane = $("cut-lane");
  function timeAtX(clientX) {
    return clamp((clientX - lane.getBoundingClientRect().left) / pxPerSecond, 0, total());
  }
  $("cut-video-track").addEventListener("pointerdown", event => {
    const block = event.target.closest(".cut-clip");
    if (!block) return;
    event.preventDefault();
    pause();
    const index = Number(block.dataset.index), clip = project.clips[index];
    const trim = event.target.closest(".cut-trim");
    const edge = trim ? (trim.classList.contains("cut-trim-start") ? "start" : "end") : "";
    const track = $("cut-video-track"), startX = event.clientX, original = {start:clip.start, end:clip.end};
    const limit = sources.get(clip.jobId)?.duration ?? clip.end;
    let moved = false;
    select(index);
    try { track.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
    const move = moveEvent => {
      const dx = moveEvent.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      if (!moved) { moved = true; beginEdit(); }
      if (edge) {
        const seconds = dx / pxPerSecond * clip.look.speed;
        if (edge === "start") clip.start = clamp(original.start + seconds, 0, clip.end - 0.1);
        else clip.end = clamp(original.end + seconds, clip.start + 0.1, limit);
        block.style.width = Math.max(10, clipLength(clip) * pxPerSecond) + "px";
        $("cut-total").textContent = t("Total: {time}", {time:clock(total())});
        if (edge === "start") setVideoPreview(index, clip.start); else setVideoPreview(index, clip.end);
      } else {
        block.style.transform = `translateX(${dx}px)`;
        block.classList.add("dragging");
      }
    };
    const up = upEvent => {
      track.removeEventListener("pointermove", move);
      if (!moved) { seek(timeAtX(upEvent.clientX)); return; }
      if (!edge) {
        const drop = timeAtX(upEvent.clientX);
        let target = 0, offset = 0;
        project.clips.forEach((other, position) => {
          const length = clipLength(other);
          if (position !== index && drop > offset + length / 2) target = position + (position < index ? 1 : 0);
          offset += length;
        });
        const [moving] = project.clips.splice(index, 1);
        project.clips.splice(target, 0, moving);
        selected = target;
      }
      endEdit();
      seek(Math.min(playhead, total()));
    };
    track.addEventListener("pointermove", move);
    track.addEventListener("pointerup", up, {once:true});
  });
  function setVideoPreview(index, second) {
    if (!loadClipMedia(index)) return;
    video.pause();
    setVideoTime(second);
    applyLook(project.clips[index]);
  }
  function scrub(event, area) {
    if (event.target.closest("input, button") || !project?.clips.length) return;
    pause();
    try { area.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
    seek(timeAtX(event.clientX));
    const move = moveEvent => seek(timeAtX(moveEvent.clientX));
    area.addEventListener("pointermove", move);
    area.addEventListener("pointerup", () => area.removeEventListener("pointermove", move), {once:true});
  }
  for (const id of ["cut-ruler", "cut-music-track"]) $(id).addEventListener("pointerdown", event => scrub(event, $(id)));
  $("cut-sound-track").addEventListener("pointerdown", event => {
    const block = event.target.closest(".cut-sound");
    if (block) select(Number(block.dataset.index));
    scrub(event, $("cut-sound-track"));
  });
  // A moved sound sticks to the start, the playhead and clip edges when it comes close.
  function snapTime(at, length) {
    const points = [0, playhead, total()];
    project.clips.forEach((clip, index) => points.push(offsetOf(index), offsetOf(index) + clipLength(clip)));
    let best = at, distance = 8 / pxPerSecond;
    for (const point of points) {
      for (const candidate of [point, point - length]) {
        if (candidate >= 0 && Math.abs(candidate - at) < distance) { best = candidate; distance = Math.abs(candidate - at); }
      }
    }
    return best;
  }
  $("cut-audio-track").addEventListener("pointerdown", event => {
    const area = $("cut-audio-track"), block = event.target.closest(".cut-piece");
    if (!block) { scrub(event, area); return; }
    event.preventDefault();
    pause();
    const index = Number(block.dataset.index), sound = project.audio[index];
    const trim = event.target.closest(".cut-trim");
    const edge = trim ? (trim.classList.contains("cut-trim-start") ? "start" : "end") : "";
    const startX = event.clientX, original = {...sound};
    const limit = sources.get(sound.jobId)?.duration ?? sound.end;
    let moved = false;
    selectSound(index);
    try { area.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
    const move = moveEvent => {
      const dx = moveEvent.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      if (!moved) { moved = true; beginEdit(); block.classList.add("dragging"); }
      const seconds = dx / pxPerSecond;
      if (edge === "start") {
        sound.start = clamp(original.start + seconds * sound.speed, Math.max(0, original.start - original.at * sound.speed), original.end - 0.1);
        sound.at = original.at + (sound.start - original.start) / sound.speed;
      } else if (edge === "end") {
        sound.end = clamp(original.end + seconds * sound.speed, original.start + 0.1, limit);
      } else {
        sound.at = snapTime(Math.max(0, original.at + seconds), soundLength(sound));
      }
      block.style.left = sound.at * pxPerSecond + "px";
      block.style.width = Math.max(10, soundLength(sound) * pxPerSecond) + "px";
    };
    const up = upEvent => {
      area.removeEventListener("pointermove", move);
      block.classList.remove("dragging");
      if (!moved) { seek(timeAtX(upEvent.clientX)); return; }
      endEdit();
      syncSounds(true);
    };
    area.addEventListener("pointermove", move);
    area.addEventListener("pointerup", up, {once:true});
  });

  // Inspector controls
  function editLook(update) {
    const clip = project?.clips[selected];
    if (!clip) return;
    beginEdit();
    update(clip.look);
    if (current === selected) applyLook(clip);
  }
  for (const group of document.querySelectorAll("[data-look]")) {
    for (const button of group.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        const name = group.dataset.look;
        editLook(look => { look[name] = name === "speed" ? Number(button.dataset.value) : button.dataset.value; });
        endEdit();
        if (name === "speed" || name === "transition") { render(); seek(Math.min(playhead, total())); }
      });
    }
  }
  for (const [id, apply] of [
    ["cut-volume", (look, value) => { look.volume = value / 100; $("cut-volume-value").textContent = value + "%"; }],
    ["cut-brightness", (look, value) => { look.brightness = value / 100; }],
    ["cut-contrast", (look, value) => { look.contrast = 1 + value / 100; }],
    ["cut-saturation", (look, value) => { look.saturation = 1 + value / 100; }],
  ]) {
    $(id).addEventListener("input", () => editLook(look => apply(look, Number($(id).value))));
    $(id).addEventListener("change", endEdit);
  }
  for (const [id, key] of [["cut-fade-in", "fadeIn"], ["cut-fade-out", "fadeOut"]]) {
    $(id).addEventListener("change", () => { editLook(look => { look[key] = $(id).checked; }); endEdit(); });
  }
  $("cut-sound-volume").addEventListener("input", () => {
    const sound = project?.audio[selectedSound];
    if (!sound) return;
    beginEdit();
    sound.volume = Number($("cut-sound-volume").value) / 100;
    $("cut-sound-volume-value").textContent = Math.round(sound.volume * 100) + "%";
    syncSounds();
  });
  $("cut-sound-volume").addEventListener("change", endEdit);
  for (const [id, key] of [["cut-sound-fade-in", "fadeIn"], ["cut-sound-fade-out", "fadeOut"]]) {
    $(id).addEventListener("change", () => {
      const sound = project?.audio[selectedSound];
      if (!sound) return;
      beginEdit();
      sound[key] = $(id).checked;
      endEdit();
    });
  }
  $("cut-sound-delete").addEventListener("click", removeSelected);
  $("cut-rotate-left").addEventListener("click", () => { editLook(look => { look.rotate = (look.rotate + 270) % 360; }); endEdit(); });
  $("cut-rotate-right").addEventListener("click", () => { editLook(look => { look.rotate = (look.rotate + 90) % 360; }); endEdit(); });
  $("cut-flip").addEventListener("click", () => { editLook(look => { look.flip = !look.flip; }); endEdit(); });
  $("cut-color-reset").addEventListener("click", () => { editLook(look => { look.brightness = 0; look.contrast = 1; look.saturation = 1; }); endEdit(); });
  $("cut-caption").addEventListener("input", () => editLook(look => { look.caption = $("cut-caption").value.slice(0, 120); }));
  $("cut-caption").addEventListener("change", endEdit);
  $("edit-save-frame").addEventListener("click", async () => {
    const clip = project?.clips[current];
    if (!clip) return;
    try {
      const output = await invoke("editor_save_frame", {id:clip.jobId, second:video.currentTime});
      status(t("Done: {file}", {file:fileName(output)}));
    } catch (error) { status(errorText(error), true); }
  });
  for (const tab of document.querySelectorAll("[data-look-tab]")) {
    tab.addEventListener("click", () => {
      for (const peer of document.querySelectorAll("[data-look-tab]")) {
        peer.classList.toggle("selected", peer === tab);
        peer.setAttribute("aria-selected", String(peer === tab));
      }
      for (const pane of document.querySelectorAll("[data-look-pane]")) pane.hidden = pane.dataset.lookPane !== tab.dataset.lookTab;
    });
  }
  for (const tab of document.querySelectorAll("[data-media-tab]")) {
    tab.addEventListener("click", () => {
      mediaTab = tab.dataset.mediaTab;
      for (const peer of document.querySelectorAll("[data-media-tab]")) {
        peer.classList.toggle("selected", peer === tab);
        peer.setAttribute("aria-selected", String(peer === tab));
      }
      renderMedia();
    });
  }
  for (const button of document.querySelectorAll("[data-canvas]")) {
    button.addEventListener("click", () => { if (!project) return; commit(); project.canvas = button.dataset.canvas; changed(); });
  }
  for (const button of document.querySelectorAll("[data-fit]")) {
    button.addEventListener("click", () => { if (!project) return; commit(); project.fit = button.dataset.fit; changed(); });
  }
  for (const group of document.querySelectorAll("#cut-export-menu [data-chips]")) {
    for (const button of group.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        for (const peer of group.querySelectorAll("button")) peer.classList.toggle("selected", peer === button);
        renderExportSummary();
      });
    }
  }
  $("cut-name").addEventListener("input", () => { typingName = true; beginEdit(); project.name = $("cut-name").value.slice(0, 60); });
  $("cut-name").addEventListener("change", () => { typingName = false; endEdit(); });
  $("cut-play").addEventListener("click", () => playing ? pause() : play());
  $("cut-split").addEventListener("click", split);
  $("cut-duplicate").addEventListener("click", duplicate);
  $("cut-delete").addEventListener("click", removeSelected);
  $("cut-detach").addEventListener("click", detachSound);
  $("cut-undo").addEventListener("click", undo);
  $("cut-redo").addEventListener("click", redo);
  $("cut-zoom-in").addEventListener("click", () => zoom(1.4));
  $("cut-zoom").addEventListener("input", () => setZoom(sliderToZoom(Number($("cut-zoom").value))));
  $("cut-zoom-fit").addEventListener("click", () => { fitZoom(); zoomTouched = false; render(); });
  $("cut-scroll").addEventListener("wheel", event => {
    if (!project) return;
    const scroll = $("cut-scroll");
    if (event.ctrlKey) {
      event.preventDefault();
      const box = scroll.getBoundingClientRect();
      setZoom(pxPerSecond * (event.deltaY < 0 ? 1.25 : 0.8), timeAtX(event.clientX), event.clientX - box.left);
      return;
    }
    // The wheel moves along time, unless the sound rows need scrolling up and down.
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || scroll.scrollHeight > scroll.clientHeight + 1) return;
    event.preventDefault();
    scroll.scrollLeft += event.deltaY;
  }, {passive:false});
  $("cut-scroll").addEventListener("scroll", () => {
    cancelAnimationFrame(stripFrame);
    stripFrame = requestAnimationFrame(() => { renderRuler(); renderStrips(); });
  });
  // The timeline grows from its top edge; the height is remembered.
  function setTimelineHeight(value, remember = false) {
    const height = Math.round(clamp(value, 170, Math.max(170, window.innerHeight * 0.7)));
    dialog.style.setProperty("--cut-timeline", height + "px");
    if (remember) try { localStorage.setItem(TIMELINE_KEY, String(height)); } catch { /* storage unavailable */ }
    renderStrips();
  }
  try {
    const saved = Number(localStorage.getItem(TIMELINE_KEY));
    if (saved > 0) setTimelineHeight(saved);
  } catch { /* storage unavailable */ }
  $("cut-resize").addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = $("cut-resize"), startY = event.clientY, startHeight = $("cut-timeline").offsetHeight;
    try { handle.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
    handle.classList.add("dragging");
    const move = moveEvent => setTimelineHeight(startHeight + startY - moveEvent.clientY);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", () => {
      handle.removeEventListener("pointermove", move);
      handle.classList.remove("dragging");
      setTimelineHeight($("cut-timeline").offsetHeight, true);
    }, {once:true});
  });
  $("cut-resize").addEventListener("dblclick", () => {
    try { localStorage.removeItem(TIMELINE_KEY); } catch { /* storage unavailable */ }
    dialog.style.removeProperty("--cut-timeline");
    renderStrips();
  });
  $("cut-resize").addEventListener("keydown", event => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    setTimelineHeight($("cut-timeline").offsetHeight + (event.key === "ArrowUp" ? 24 : -24), true);
  });
  function setFullscreen(on) {
    fullscreen = on;
    dialog.classList.toggle("cut-full", on);
    $("cut-fullscreen").setAttribute("aria-pressed", String(on));
    invoke?.("window_action", {action:on ? "toggle_fullscreen" : "exit_fullscreen"}).catch(() => {});
    requestAnimationFrame(() => { if (!zoomTouched) fitZoom(); render(); });
  }
  $("cut-fullscreen").addEventListener("click", () => setFullscreen(!fullscreen));
  $("cut-zoom-out").addEventListener("click", () => zoom(1 / 1.4));
  $("cut-export").addEventListener("click", exportProject);
  window.addEventListener("pagehide", () => { pause(); endEdit(); flushSave(); });
  video.addEventListener("error", () => { if (video.getAttribute("src")) status(t("The built-in player cannot play this codec. Export still works."), true); });
  window.__TAURI__?.event?.listen?.("devilcut-progress", event => setProgress(Number(event.payload)));

  document.addEventListener("keydown", event => {
    if (!project) return;
    if (event.target.closest?.("input, textarea, select")) return;
    const mod = event.ctrlKey || event.metaKey;
    // Physical keys, so the shortcuts work with any keyboard layout.
    const key = event.code;
    const handled = () => event.preventDefault();
    if (key === "Space") { handled(); playing ? pause() : play(); }
    else if (mod && key === "KeyB") { handled(); split(); }
    else if (mod && key === "KeyD") { handled(); duplicate(); }
    else if (mod && key === "KeyZ") { handled(); event.shiftKey ? redo() : undo(); }
    else if (mod && key === "KeyY") { handled(); redo(); }
    else if (key === "Delete" || key === "Backspace") { handled(); removeSelected(); }
    else if (key === "ArrowLeft" || key === "ArrowRight") {
      handled(); pause();
      seek(playhead + (event.shiftKey ? 1 : FRAME) * (key === "ArrowLeft" ? -1 : 1));
    }
    else if (key === "F11") { handled(); setFullscreen(!fullscreen); }
    else if (key === "Digit0" || key === "Numpad0") { handled(); fitZoom(); zoomTouched = false; render(); }
    else if (key === "Home") { handled(); seek(0); }
    else if (key === "End") { handled(); seek(total()); }
    else if (key === "Equal" || key === "NumpadAdd") { handled(); zoom(1.4); }
    else if (key === "Minus" || key === "NumpadSubtract") { handled(); zoom(1 / 1.4); }
  });

  function refresh() { renderMedia(); }
  function relabel() {
    renderMedia();
    render();
    defaultStatus();
  }

  return {open, openProject, refresh, relabel};
}
