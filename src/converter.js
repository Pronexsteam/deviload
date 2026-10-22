// Entry point of the converter window: files come from drops, the file picker or
// the library, and are converted one at a time by the Rust side.
import {hydrateMascots, setPose} from "./mascot-spot.js";
import {t, tn, errorText, translateDom, setLanguage, onLanguageChange} from "./i18n.js";
import {exportFolder, bindExportFolder} from "./export-folder.js";
import {wireAppearance} from "./appearance.js";
import {actionError, conversionOptions, outputDimensions, serialFileAdder, mediaTracks, originalAudioExtension, trackOptions, jobError} from "./converter-model.js";

wireAppearance();

const invoke = window.__TAURI__?.core?.invoke;
const $ = id => document.getElementById(id);
const EXTENSIONS = ["mp4", "mkv", "webm", "mov", "m4v", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "3gp", "gif",
  "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "wma", "aiff", "aif", "mka"];
const items = [];
let preset = "mp4", running = false, stopped = false, current = null, adding = 0, selectedPath = "", previewPath = "", previewResult = false, trackKey = "";
const titles = {mp4:"MP4 video",mp3:"MP3 audio",audio:"Original audio",remux:"Remux",gif:"GIF",size:"Smaller file"};

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}
function icon(name) {
  const element = node("span", "icon");
  element.dataset.icon = name;
  element.setAttribute("aria-hidden", "true");
  return element;
}
function message(value, error = false) {
  if (!value) return;
  const box = $("toasts");
  const toast = node("div", "toast" + (error ? " error" : ""));
  toast.setAttribute("role", error ? "alert" : "status");
  const close = node("button", "toast-close");
  close.type = "button";
  close.setAttribute("aria-label", t("Close"));
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
  close.addEventListener("click", () => toast.remove());
  toast.append(icon(error ? "warning-circle" : "check-circle"), node("p", "", value), close);
  box.append(toast);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => toast.remove(), error ? 9000 : 4500);
}
const size = bytes => bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + " GB" : (bytes / 1e6).toFixed(1) + " MB";
const clock = seconds => {
  const whole = Math.round(seconds), hours = Math.floor(whole / 3600), minutes = Math.floor(whole % 3600 / 60), rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
};
const fileName = path => path.split(/[\\/]/).pop();

function megabytes() {
  return Number($("convert-size").value);
}
function options() {
  return conversionOptions({preset, resolution: $("convert-resolution").value, quality: $("convert-quality").value,
    megabytes: megabytes(), folder: exportFolder(), container:$("convert-container").value});
}

function selectedFile() { return items.find(item => item.path === selectedPath) || items[0] || null; }
function selectFile(item) {
  selectedPath = item.path; previewResult = false;
  if (!running && actionError(item,preset)) preset = item.video ? "mp4" : "mp3";
  render();
}
const facts = item => [clock(item.duration),size(item.bytes),item.video && item.width && item.height ? `${item.width} × ${item.height}` : "",[item.videoCodec,item.audioCodec].filter(Boolean).join(" / ")].filter(Boolean).join(" · ");
function showPreview(item) {
  const path = item ? (previewResult && item.output ? item.output : item.path) : "";
  if (previewPath === path) return;
  previewPath = path;
  const box = $("convert-preview");
  box.querySelectorAll("video,audio").forEach(media => { media.pause(); media.removeAttribute("src"); media.load(); });
  box.replaceChildren();
  $("convert-preview-note").textContent = t("Preview appears when the file format is supported by your system.");
  const toUrl = window.__TAURI__?.core?.convertFileSrc;
  if (!item || !toUrl) { box.append(icon(item?.video ? "video" : "music-notes")); return; }
  const audioOutput = previewResult && /\.(mp3|m4a|opus|flac)$/i.test(path);
  const image = /\.gif$/i.test(path);
  const media = node(image ? "img" : item.video && !audioOutput ? "video" : "audio");
  if (!image) { media.controls = true; media.preload = "metadata"; }
  else media.alt = t(previewResult ? "Result preview" : "Source preview");
  media.setAttribute("aria-label", t(previewResult ? "Result preview" : "Source preview"));
  media.addEventListener("error", () => {
    if (previewPath !== path) return;
    $("convert-preview-note").textContent = t("Your system cannot preview this format. You can still process the file.");
    box.replaceChildren(icon(item.video && !audioOutput ? "video" : "music-notes"));
  },{once:true});
  media.src = toUrl(path);
  box.append(media);
}
function trackLabel(track) { return ["#"+track.index,track.language,track.title,track.codec,track.channels ? t("{count} channels",{count:track.channels}) : ""].filter(Boolean).join(" · "); }
function renderTracks(item) {
  const key = JSON.stringify([item?.path,preset,item?.tracks,item?.selection,running]);
  if (key === trackKey) return;
  trackKey = key;
  const box = $("convert-track-fields"); box.replaceChildren();
  $("convert-tracks").hidden = !item;
  if (!item) return;
  const selection = trackOptions(item,preset);
  const videos = mediaTracks(item,"video"), audio = mediaTracks(item,"audio"), subtitles = mediaTracks(item,"subtitle");
  function save(patch) {
    const focus = document.activeElement?.id;
    item.selection = {...(item.selection || {}),...patch}; item.state = "ready"; item.error = ""; render();
    if (focus?.startsWith("convert-track-")) $(focus)?.focus();
  }
  function selector(label, values, value, change, empty = null) {
    const field = node("label","convert-control",label), select = node("select"); select.disabled = running;
    select.id = values[0]?.kind === "video" ? "convert-track-video" : "convert-track-audio";
    if (empty) { const option = node("option","",empty); option.value = ""; select.append(option); }
    for (const track of values) { const option = node("option","",trackLabel(track)); option.value = String(track.index); select.append(option); }
    select.value = value === undefined ? "" : String(value);
    select.addEventListener("change",() => change(select.value === "" ? null : Number(select.value)));
    field.append(select); box.append(field);
  }
  function choices(label, values, picked, property) {
    const field = node("fieldset","convert-track-group"); field.append(node("legend","",label));
    for (const track of values) {
      const label = node("label"), input = node("input"); input.type = "checkbox"; input.disabled = running;
      input.checked = picked.includes(track.index); input.dataset.track = String(track.index); input.dataset.kind = property;
      input.id = `convert-track-${property}-${track.index}`;
      input.addEventListener("change",() => {
        const next = new Set(picked); if (input.checked) next.add(track.index); else next.delete(track.index);
        save({[property]:[...next]});
      });
      label.append(input,node("span","",trackLabel(track))); field.append(label);
    }
    box.append(field);
  }
  if (videos.length > 1 && !["mp3","audio"].includes(preset)) selector(t("Video track"),videos,selection.videoTrack,value => save({videoTrack:value}));
  if (audio.length && preset !== "gif") {
    if (["mp3","audio","size"].includes(preset)) {
      const eligible = preset === "audio" ? audio.filter(track => originalAudioExtension(track.codec)) : audio;
      selector(t("Audio track"),eligible,selection.audioTracks[0],value => save({audioTracks:value === null ? [] : [value]}),preset === "size" && item.video ? t("No audio") : null);
    } else choices(t("Audio tracks"),audio,selection.audioTracks,"audioTracks");
  }
  if (subtitles.length && ["remux","mp4"].includes(preset)) choices(t("Subtitle tracks"),subtitles,selection.subtitleTracks,"subtitleTracks");
  if (!box.childElementCount) box.append(node("p","convert-help",t("This action uses the file’s only matching track.")));
}
function renderPanel() {
  const item = selectedFile();
  showPreset(); showPreview(item); renderTracks(item);
  $("convert-source-name").textContent = item?.name || t("Choose a file to begin");
  $("convert-source-name").title = item?.path || "";
  $("convert-source-facts").textContent = item ? facts(item) : "";
  $("convert-wheel-type").textContent = item ? fileName(item.path).split(".").pop().toUpperCase() : "MEDIA";
  $("convert-wheel-label").textContent = t(titles[preset]);
  $("convert-action-title").textContent = t(titles[preset]);
  const problem = item ? jobError(item,preset,$("convert-container").value) : "";
  const plan = $("convert-plan"); plan.classList.toggle("convert-error",Boolean(problem));
  plan.textContent = problem ? errorText(problem) : item ? t(["remux","audio"].includes(preset) ? "Copies selected streams without re-encoding. File size stays close to the selected content." : "Creates a new file. Encoding time and size depend on the source.") : t("Add a file to see the available actions.");
  $("convert-result").hidden = !item?.output;
  $("convert-result-name").textContent = item?.output ? fileName(item.output) : "";
  $("convert-result-preview").textContent = t(previewResult ? "Preview source" : "Preview result");
}

function render() {
  if (!items.some(item => item.path === selectedPath)) { selectedPath = items[0]?.path || ""; previewResult = false; }
  const list = $("convert-list");
  list.replaceChildren(...items.map(row));
  $("convert-empty").hidden = items.length > 0;
  $("convert-start").disabled = running || adding > 0 || !items.some(item => item.state === "ready" && ($("convert-batch").checked || item === selectedFile()));
  $("convert-stop").hidden = !running;
  $("convert-stop").disabled = stopped;
  $("convert-stop").textContent = t(stopped ? "Stopping…" : "Stop");
  $("convert-clear").disabled = running || adding > 0 || !items.length;
  $("convert-pick").disabled = running;
  $("convert-count").textContent = adding ? t("Reading files…") : String(items.length);
  $("convert-retry").hidden = !items.some(item => item.state === "error");
  $("convert-retry").disabled = running || adding > 0;
  $("convert-batch").disabled = running;
  for (const control of document.querySelectorAll(".convert-options button,.convert-options input,.convert-options select")) control.disabled = running;
  for (const button of document.querySelectorAll("[data-preset]")) {
    const action = button.dataset.preset;
    const error = selectedFile() ? actionError(selectedFile(),action) : "";
    button.disabled = running || Boolean(error);
    button.title = error ? errorText(error) : t(titles[action]);
  }
  renderPanel();
}
function row(item) {
  const element = node("div", "convert-item");
  element.dataset.state = item.state;
  element.classList.toggle("selected", item === selectedFile());
  const text = node("div", "convert-item-text");
  const name = node("button", "convert-file-select", item.name);
  name.type = "button"; name.setAttribute("aria-pressed", String(item === selectedFile()));
  name.addEventListener("click",() => selectFile(item));
  name.title = item.path;
  const dimensions = item.video && item.width && item.height ? `${item.width} × ${item.height}` : "";
  const codecs = [item.videoCodec, item.audioCodec].filter(Boolean).join(" / ");
  text.append(name, node("span", "", [clock(item.duration), size(item.bytes), dimensions, codecs].filter(Boolean).join(" · ")));
  if (item.state === "ready" && item.video && (preset === "mp4" || preset === "size")) {
    const projected = outputDimensions(item.width, item.height, $("convert-resolution").value);
    if (projected) text.append(node("span", "convert-output-note", t("Maximum output: {width} × {height}", projected)));
  }
  const status = node("div", "convert-item-status");
  if (item.state === "working") {
    const bar = node("div", "convert-bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", t("Converting"));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(item.share * 100)));
    item.progress = bar;
    item.bar = node("span");
    item.bar.style.width = Math.round(item.share * 100) + "%";
    item.percent = node("span", "convert-percent", Math.round(item.share * 100) + "%");
    bar.append(item.bar);
    status.append(bar, item.percent);
  } else if (item.state === "done") {
    const reveal = node("button", "outline small", t("Show in folder"));
    reveal.type = "button";
    reveal.prepend(icon("folder-open"));
    reveal.title = item.output;
    reveal.addEventListener("click", () => invoke("reveal_file", {path:item.output}).catch(error => message(errorText(error), true)));
    status.append(node("span", "convert-note", fileName(item.output)), reveal);
  } else if (item.state === "error") {
    status.append(node("span", "convert-note convert-error", item.error));
    const retry = node("button", "outline small", t("Retry"));
    retry.type = "button";
    retry.disabled = running || adding > 0;
    retry.addEventListener("click", () => start([item]));
    status.append(retry);
  } else {
    const incompatible = jobError(item, preset,$("convert-container").value);
    status.append(node("span", "convert-note" + (incompatible ? " convert-error" : ""), incompatible ? errorText(incompatible) : t("Waiting")));
  }
  element.append(icon(item.video ? "video" : "music-notes"), text, status);
  if (!running) {
    const remove = node("button", "convert-remove", "×");
    remove.type = "button";
    remove.title = t("Remove from the list");
    remove.setAttribute("aria-label", t("Remove from the list"));
    remove.addEventListener("click", () => { items.splice(items.indexOf(item), 1); render(); });
    element.append(remove);
  }
  return element;
}

const appendFiles = serialFileAdder({items, windows: /Win/i.test(navigator.platform || navigator.userAgent),
  probe: paths => invoke("convert_probe", {paths}),
  append: files => {
    for (const file of files) {
      if (file.error) { message(`${file.name}: ${errorText(file.error)}`, true); continue; }
      items.push({...file, state:"ready", share:0, output:"", error:""});
    }
  }});
async function add(paths) {
  if (!invoke) return;
  if (running) { message(t("Wait until the current files are done."), true); return; }
  adding++;
  render();
  try {
    await appendFiles(paths);
    if (items.length && !items.some(file => !actionError(file, preset))) {
      choosePreset(items.some(file => file.video) ? "mp4" : "mp3");
    }
  } catch (error) { message(errorText(error), true); }
  finally { adding--; }
  render();
}

async function start(selected = null) {
  if (running || adding > 0) return;
  const queue = selected || items.filter(item => item.state === "ready" && ($("convert-batch").checked || item === selectedFile()));
  if (!queue.length) return;
  let jobOptions;
  try { jobOptions = options(); }
  catch (error) { message(errorText(error), true); return; }
  const selections = new Map(queue.map(item => [item.path,trackOptions(item,preset)]));
  // One immutable snapshot applies to the whole batch, including its output folder.
  running = true;
  stopped = false;
  $("convert-status").textContent = "";
  setPose($("convert-mascot"), "working");
  render();
  let done = 0, failed = 0;
  for (const item of queue) {
    if (stopped) break;
    current = item;
    item.state = "working";
    item.share = 0;
    item.error = "";
    item.output = "";
    render();
    try {
      const selection = selections.get(item.path);
      const incompatible = jobError(item, jobOptions.preset,jobOptions.container,selection);
      if (incompatible) throw new Error(incompatible);
      item.output = await invoke("convert_file", {job:{path:item.path, ...jobOptions,...selection}});
      item.state = "done";
      done++;
    } catch (error) {
      item.state = stopped ? "ready" : "error";
      item.error = errorText(error);
      if (!stopped) failed++;
    }
    current = null;
    render();
  }
  running = false;
  render();
  $("convert-status").textContent = stopped ? t("Stopped.") : [
    done ? tn("{count} file converted", "{count} files converted", done) : "",
    failed ? tn("{count} file failed", "{count} files failed", failed) : "",
  ].filter(Boolean).join(" · ");
  setPose($("convert-mascot"), failed || !done ? "error" : "victory", "look", 3600);
}

function showPreset() {
  const value = preset;
  for (const button of document.querySelectorAll("[data-preset]")) {
    button.classList.toggle("selected", button.dataset.preset === value);
    button.setAttribute("aria-pressed", String(button.dataset.preset === value));
  }
  $("convert-size-row").hidden = value !== "size";
  const videoSettings = value === "mp4" || value === "size";
  $("convert-advanced").hidden = ["gif","remux","audio"].includes(value);
  $("convert-container-field").hidden = value !== "remux";
  $("convert-resolution-field").hidden = !videoSettings;
  $("convert-resolution-note").hidden = !videoSettings;
  $("convert-quality-field").hidden = value === "size";
  $("convert-quality-note").hidden = value === "size";
  $("convert-action-note").textContent = t({
    mp4:"MP4 video with H.264 and AAC for broad compatibility.",
    mp3:"Extracts the sound as MP3. Balanced uses 192 kbps; High quality uses 320 kbps.",
    audio:"Keeps the original AAC, Opus or FLAC audio. No quality setting is needed because the sound is not re-encoded.",
    remux:"Changes the container without changing the selected streams. Compatibility depends on the video, audio and subtitle codecs.",
    gif:"Silent animation, up to 60 seconds and 480 pixels wide. Trim longer clips in Devil Cut first.",
    size:"Fits the selected limit or reports an error. Long videos may need a lower resolution; the maximum resolution is a cap, not a fixed size."
  }[value]);
}

function choosePreset(value) {
  if (running) return;
  preset = value;
  showPreset();
  // A new format means the finished files can be made once more.
  resetResults();
}

function resetResults() {
  if (running) return;
  for (const item of items) { item.state = "ready"; item.error = ""; }
  render();
}

for (const button of document.querySelectorAll("[data-preset]")) button.addEventListener("click", () => choosePreset(button.dataset.preset));
for (const button of document.querySelectorAll("[data-size]")) {
  button.addEventListener("click", () => {
    $("convert-size").value = button.dataset.size;
    for (const peer of document.querySelectorAll("[data-size]")) peer.classList.toggle("selected", peer === button);
    resetResults();
  });
}
$("convert-size").addEventListener("input", () => {
  for (const peer of document.querySelectorAll("[data-size]")) peer.classList.toggle("selected", peer.dataset.size === String(megabytes()));
  resetResults();
});
for (const id of ["convert-resolution", "convert-quality", "convert-container"]) $(id).addEventListener("change", resetResults);
$("convert-batch").addEventListener("change",render);
$("convert-result-preview").addEventListener("click",() => { previewResult = !previewResult; renderPanel(); });
$("convert-result-reveal").addEventListener("click",() => {
  const item = selectedFile();
  if (item?.output) invoke("reveal_file",{path:item.output}).catch(error => message(errorText(error),true));
});
document.querySelector(".convert-wheel").addEventListener("keydown",event => {
  if (!event.target.closest("[data-preset]")) return;
  const buttons = [...document.querySelectorAll("[data-preset]")].filter(button => !button.disabled);
  const index = buttons.indexOf(document.activeElement);
  let next;
  if (["ArrowRight","ArrowDown"].includes(event.key)) next = (index + 1) % buttons.length;
  else if (["ArrowLeft","ArrowUp"].includes(event.key)) next = (index + buttons.length - 1) % buttons.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = buttons.length - 1;
  if (next !== undefined && buttons[next]) { event.preventDefault(); buttons[next].focus(); }
});
$("convert-start").addEventListener("click", () => start());
$("convert-retry").addEventListener("click", () => start(items.filter(item => item.state === "error")));
$("convert-stop").addEventListener("click", () => {
  stopped = true;
  render();
  invoke("convert_stop").catch(() => {});
});
$("convert-clear").addEventListener("click", () => { items.length = 0; $("convert-status").textContent = ""; render(); });
$("convert-pick").addEventListener("click", async () => {
  const open = window.__TAURI__?.dialog?.open;
  if (!open) return;
  const picked = await open({multiple:true, title:t("Choose files to convert"),
    filters:[{name:t("Video and audio"), extensions:EXTENSIONS}]}).catch(() => null);
  if (Array.isArray(picked)) add(picked);
  else if (typeof picked === "string") add([picked]);
});

// Files dropped on the window arrive with their paths from the native drop handler.
window.__TAURI__?.webview?.getCurrentWebview?.().onDragDropEvent(event => {
  const {type, paths} = event.payload;
  if (type === "enter" || type === "over") $("convert-overlay").hidden = running;
  else if (type === "leave") $("convert-overlay").hidden = true;
  else if (type === "drop") {
    $("convert-overlay").hidden = true;
    if (running) { message(t("Wait until the current files are done."), true); return; }
    add(paths || []);
  }
});
window.__TAURI__?.event?.listen?.("convert-progress", event => {
  if (!current?.bar || current.state !== "working") return;
  current.share = Math.max(0, Math.min(1, Number(event.payload) || 0));
  const percent = Math.round(current.share * 100);
  current.bar.style.width = percent + "%";
  current.percent.textContent = percent + "%";
  current.progress.setAttribute("aria-valuenow", String(percent));
});
window.__TAURI__?.event?.listen?.("converter-add", event => add(Array.isArray(event.payload) ? event.payload : []));

const showExportFolder = bindExportFolder({name:$("convert-folder"), pick:$("convert-folder-pick"), reset:$("convert-folder-reset")}, t);
function relabel() {
  trackKey = "";
  showExportFolder();
  document.title = "Devil Convert · Deviload";
  showPreset();
  render();
}
translateDom();
relabel();
onLanguageChange(relabel);
// The main window stores the language; follow it when it changes there.
window.addEventListener("storage", event => { if (event.key === "deviload-lang" && event.newValue) setLanguage(event.newValue); });
hydrateMascots();
if (invoke) add(await invoke("convert_pending").catch(() => []));
