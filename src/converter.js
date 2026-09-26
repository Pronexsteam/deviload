// Entry point of the converter window: files come from drops, the file picker or
// the library, and are converted one at a time by the Rust side.
import {hydrateMascots, setPose} from "./mascot-spot.js";
import {t, tn, errorText, translateDom, setLanguage, onLanguageChange} from "./i18n.js";
import {exportFolder, bindExportFolder} from "./export-folder.js";

const invoke = window.__TAURI__?.core?.invoke;
const $ = id => document.getElementById(id);
const EXTENSIONS = ["mp4", "mkv", "webm", "mov", "m4v", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "3gp", "gif",
  "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "wma", "aiff", "aif", "mka"];
const items = [];
let preset = "mp4", running = false, stopped = false, current = null;

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
  const value = Math.round(Number($("convert-size").value));
  return Number.isFinite(value) ? Math.max(1, Math.min(4000, value)) : 10;
}

function render() {
  const list = $("convert-list");
  list.replaceChildren(...items.map(row));
  $("convert-empty").hidden = items.length > 0;
  $("convert-start").disabled = running || !items.some(item => item.state === "ready");
  $("convert-stop").hidden = !running;
  $("convert-clear").disabled = running || !items.length;
  $("convert-pick").disabled = running;
}
function row(item) {
  const element = node("div", "convert-item");
  element.dataset.state = item.state;
  const text = node("div", "convert-item-text");
  const name = node("strong", "", item.name);
  name.title = item.path;
  text.append(name, node("span", "", [clock(item.duration), size(item.bytes), item.video ? t("Video") : t("Audio")].join(" · ")));
  const status = node("div", "convert-item-status");
  if (item.state === "working") {
    const bar = node("div", "convert-bar");
    item.bar = node("span");
    item.bar.style.width = Math.round(item.share * 100) + "%";
    bar.append(item.bar);
    status.append(bar);
  } else if (item.state === "done") {
    const reveal = node("button", "outline small", t("Show in folder"));
    reveal.type = "button";
    reveal.prepend(icon("folder-open"));
    reveal.title = item.output;
    reveal.addEventListener("click", () => invoke("reveal_file", {path:item.output}).catch(error => message(errorText(error), true)));
    status.append(node("span", "convert-note", fileName(item.output)), reveal);
  } else if (item.state === "error") {
    status.append(node("span", "convert-note convert-error", item.error));
  } else status.append(node("span", "convert-note", t("Waiting")));
  element.append(icon(item.video ? "video" : "music-notes"), text, status);
  if (item.state !== "working") {
    const remove = node("button", "convert-remove", "×");
    remove.type = "button";
    remove.title = t("Remove from the list");
    remove.setAttribute("aria-label", t("Remove from the list"));
    remove.addEventListener("click", () => { items.splice(items.indexOf(item), 1); render(); });
    element.append(remove);
  }
  return element;
}

async function add(paths) {
  const fresh = [...new Set(paths)].filter(path => !items.some(item => item.path === path));
  if (!fresh.length || !invoke) return;
  if (items.length + fresh.length > 100) { message(t("Add up to 100 files at a time"), true); return; }
  try {
    for (const file of await invoke("convert_probe", {paths:fresh})) {
      if (file.error) { message(`${file.name}: ${errorText(file.error)}`, true); continue; }
      items.push({...file, state:"ready", share:0, output:"", error:""});
    }
  } catch (error) { message(errorText(error), true); }
  render();
}

async function start() {
  if (running) return;
  const queue = items.filter(item => item.state === "ready");
  if (!queue.length) return;
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
    render();
    try {
      item.output = await invoke("convert_file", {job:{path:item.path, preset, megabytes:megabytes(), folder:exportFolder()}});
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

function choosePreset(value) {
  if (running) return;
  preset = value;
  for (const button of document.querySelectorAll("[data-preset]")) {
    button.classList.toggle("selected", button.dataset.preset === value);
    button.setAttribute("aria-pressed", String(button.dataset.preset === value));
  }
  $("convert-size-row").hidden = value !== "size";
  // A new format means the finished files can be made once more.
  for (const item of items) if (item.state !== "working") { item.state = "ready"; item.error = ""; }
  render();
}

for (const button of document.querySelectorAll("[data-preset]")) button.addEventListener("click", () => choosePreset(button.dataset.preset));
for (const button of document.querySelectorAll("[data-size]")) {
  button.addEventListener("click", () => {
    $("convert-size").value = button.dataset.size;
    for (const peer of document.querySelectorAll("[data-size]")) peer.classList.toggle("selected", peer === button);
  });
}
$("convert-size").addEventListener("input", () => {
  for (const peer of document.querySelectorAll("[data-size]")) peer.classList.toggle("selected", peer.dataset.size === String(megabytes()));
});
$("convert-start").addEventListener("click", start);
$("convert-stop").addEventListener("click", () => {
  stopped = true;
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
  if (!current?.bar) return;
  current.share = Math.max(0, Math.min(1, Number(event.payload) || 0));
  current.bar.style.width = Math.round(current.share * 100) + "%";
});
window.__TAURI__?.event?.listen?.("converter-add", event => add(Array.isArray(event.payload) ? event.payload : []));

const showExportFolder = bindExportFolder({name:$("convert-folder"), pick:$("convert-folder-pick"), reset:$("convert-folder-reset")}, t);
function relabel() {
  showExportFolder();
  document.title = t("Converter") + " · Deviload";
  render();
}
translateDom();
relabel();
onLanguageChange(relabel);
// The main window stores the language; follow it when it changes there.
window.addEventListener("storage", event => { if (event.key === "deviload-lang" && event.newValue) setLanguage(event.newValue); });
hydrateMascots();
if (invoke) add(await invoke("convert_pending").catch(() => []));
