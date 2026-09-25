import {MediaPulse} from "./media-pulse.js";
import {DevilMascot} from "./devil-mascot.js";
import {FireAnimation} from "./fire-animation.js";
import {wireTour} from "./tour.js";
import {createCutHome} from "./devil-cut.js";
import {pop, wireMotion} from "./motion.js";
import {hydrateMascots, mascotSpot, setPose} from "./mascot-spot.js";
import {labels, actions, counts, orbState, mediaPreview, visibleJobs, playlistSelection, diagnoseError, isVideoJob, isLibraryAudio, inLibrary} from "./view-model.js";
import {t, tn, errorText, translateMessage, translateDom, setLanguage, onLanguageChange, language, locale} from "./i18n.js";

const $ = id => document.getElementById(id);
const invoke = window.__TAURI__?.core?.invoke;
const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
const heroOrb = new MediaPulse($("queue-orb"));
const brandMascot = new DevilMascot($("brand-scene"));
hydrateMascots();
const liveFire = new FireAnimation($("live-download"));
const taskOrbs = new Map();
const stateNames = {idle:"Ready to download",running:"Downloading",queued:"Tasks in the queue",done:"All done",error:"There are errors",interrupted:"Can be resumed",cancelling:"Stopping…",pausing:"Pausing…",paused:"The queue is paused"};
const filters = {all:["all-tab","All tasks"],active:["active-tab","Current tasks"],scheduled:["scheduled-tab","Scheduled"],issues:["issues-tab","Problems"]};
const pageTabs = {downloads:"downloads-tab",library:"library-tab",search:"search-tab",editor:"devilcut-tab"};
const pageTitles = {downloads:"Downloads",library:"Library",search:"Media search",editor:"Devil Cut"};
let quality = "1080", currentFilter = "all", search = "", mediaFilter = "all", mediaSearch = "", jobs = [], currentAudioId = null;
let cinemaIds = [], currentPlayerId = null;
let cinemaPositions = {}, libraryMeta = {};
const storeTimers = {};
function persistSection(section, value) {
  if (!invoke) return;
  clearTimeout(storeTimers[section]);
  storeTimers[section] = setTimeout(() => invoke("save_ui_store", {section, value}).catch(error => message(errorText(error), true)),
    section === "positions" ? 1500 : 150);
}
// Earlier versions kept these in WebView storage; move them once.
async function loadStore() {
  const legacy = {library:"deviload-library-v1", projects:"deviload-studio-projects-v1", positions:"deviload-cinema-positions-v1"};
  const store = await invoke("ui_store");
  for (const [section, key] of Object.entries(legacy)) {
    let old = null;
    try { old = JSON.parse(localStorage.getItem(key) || "null"); } catch { old = null; }
    if (!store[section] && old && typeof old === "object") {
      store[section] = old;
      await invoke("save_ui_store", {section, value:old});
    }
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  }
  libraryMeta = store.library || {};
  $("proxy").value = store.network?.proxy || "";
  devilCut.setProjects(store.projects || {});
  cinemaPositions = store.positions || {};
}
let folderPaths = {};
let missingComponents = null;
// The tray icon gets a small dot while downloading and when something failed.
let trayShown = "";
function syncTray(state, running) {
  if (!invoke) return;
  const look = running ? "working" : state === "error" ? "error" : "idle";
  const tooltip = running ? tn("Deviload · {count} download", "Deviload · {count} downloads", running)
    : look === "error" ? t("Deviload · a download failed") : "Deviload";
  if (trayShown === look + tooltip) return;
  trayShown = look + tooltip;
  invoke("set_tray_state", {state:look, tooltip}).catch(() => {});
}
function statusLabel(status) { return labels[status] ? t(labels[status]) : status; }
function speedText(value) {
  return /^\d+(?:\.\d+)?$/.test(value || "") ? t("{speed} MB/s", {speed:value}) : (value || "");
}
function bigSizeText(bytes) {
  return bytes >= 1073741824 ? t("{size} GB", {size:(bytes / 1073741824).toFixed(1)}) : sizeText(bytes);
}
function lengthText(seconds) {
  const whole = Math.round(seconds), hours = Math.floor(whole / 3600), minutes = Math.floor(whole % 3600 / 60), rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
function sizeText(bytes) {
  return bytes < 1048576 ? t("{size} KB", {size:Math.max(1, Math.ceil(bytes / 1024))}) : t("{size} MB", {size:(bytes / 1048576).toFixed(1)});
}
function renderEngines() {
  if (missingComponents === null) return;
  $("engines").textContent = missingComponents.length ? t("Missing: {names}", {names:missingComponents.join(", ")}) : t("Components ready");
}
function navigate(page, focus = false) {
  if (!pageTabs[page]) return;
  document.querySelector("main").dataset.page = page;
  syncTitle();
  for (const [name,id] of Object.entries(pageTabs)) {
    const active = name === page;
    $(id).classList.toggle("active", active);
    if (active) $(id).setAttribute("aria-current", "page");
    else $(id).removeAttribute("aria-current");
  }
  window.scrollTo({top:0,behavior:"instant"});
  if (focus) (page === "search" ? $("media-query") : page === "downloads" ? $("urls") : null)?.focus({preventScroll:true});
}
function syncTitle() {
  document.title = "Deviload — " + t(pageTitles[document.querySelector("main").dataset.page] || "Downloads");
}
function showDownloads(focus = false) {
  if (currentFilter === "all") navigate("downloads", focus);
  else {
    $("all-tab").click();
    if (focus) $("urls").focus({preventScroll:true});
  }
}
let selectedFormat = null, inspectedAddress = "";
function clearSelectedFormat() {
  if (!selectedFormat) return;
  selectedFormat = null;
  document.querySelectorAll(".inspect-format").forEach(button => button.classList.remove("selected"));
  $("format-hint").textContent = t("Stream choice cleared. The quality selected above will be used.");
}
let notices = [], unreadNotices = 0, knownJobStates = new Map(), noticeReady = false, reactionTimer = 0;
function renderNotices() {
  const list = $("notice-list");
  list.replaceChildren();
  if (!notices.length) { list.append(node("p", "notice-empty", t("No events yet."))); return; }
  for (const notice of [...notices].reverse()) {
    const row = node("article", "notice-item");
    row.append(node("strong", "", notice.title), node("p", "", notice.detail), node("small", "", notice.time));
    list.append(row);
  }
}
function addNotice(title, detail) {
  notices.push({title,detail,time:new Date().toLocaleTimeString(locale(),{hour:"2-digit",minute:"2-digit"})});
  if (notices.length > 50) notices.shift();
  if ($("notice-dialog").open) renderNotices();
  else unreadNotices++;
  $("notice-count").textContent = String(unreadNotices);
  $("notice-count").hidden = unreadNotices === 0;
}
$("notice-button").addEventListener("click", () => {
  unreadNotices = 0; $("notice-count").hidden = true; renderNotices(); $("notice-dialog").showModal();
});
$("notice-close").addEventListener("click", () => $("notice-dialog").close());
$("notice-clear").addEventListener("click", () => { notices = []; unreadNotices = 0; $("notice-count").hidden = true; renderNotices(); });
// Animations are on by default; operating-system reduced-motion remains respected in CSS and mascot rendering.
document.documentElement.dataset.motion = "full";
document.dispatchEvent(new Event("deviload-motion-change"));
function syncSwitch(id, on) { $(id).setAttribute("aria-checked", String(on)); }
function syncSystemPreferences() {
  syncSwitch("tray-toggle", localStorage.getItem("deviload-tray") === "true");
  syncSwitch("os-notify-toggle", localStorage.getItem("deviload-os-notify") === "true");
}
syncSystemPreferences();
$("settings-open").addEventListener("click", () => $("app-settings-dialog").showModal());
$("settings-close").addEventListener("click", () => $("app-settings-dialog").close());
$("tray-toggle").addEventListener("click", async () => {
  if (!invoke) return;
  const enabled = localStorage.getItem("deviload-tray") !== "true";
  try {
    await invoke("set_close_to_tray", {enabled});
    localStorage.setItem("deviload-tray", String(enabled));
    syncSystemPreferences();
    message(enabled ? t("The close button now hides the window to the tray. To quit, choose “Quit Deviload” in the tray icon menu.") : t("The close button quits the app again."));
  } catch (error) { message(errorText(error), true); }
});
$("os-notify-toggle").addEventListener("click", async () => {
  const notification = window.__TAURI__?.notification;
  if (!notification) { message(t("OS notifications are available in the installed app."), true); return; }
  const enabled = localStorage.getItem("deviload-os-notify") !== "true";
  try {
    if (enabled && !(await notification.isPermissionGranted())) {
      if ((await notification.requestPermission()) !== "granted") throw new Error(t("The system did not allow notifications."));
    }
    localStorage.setItem("deviload-os-notify", String(enabled));
    syncSystemPreferences();
    message(enabled ? t("Notifications about finished and failed downloads are on.") : t("OS notifications are off."));
  } catch (error) { message(errorText(error), true); }
});
const STALE_DAYS = 14;
let ytdlpVersion = "";
function ytdlpAgeDays(version) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version || "");
  if (!match) return null;
  return Math.max(0, Math.floor((Date.now() - Date.UTC(+match[1], +match[2] - 1, +match[3])) / 86400000));
}
function renderEngineInfo() {
  const days = ytdlpAgeDays(ytdlpVersion);
  const age = days === null ? "" : tn("{count} day", "{count} days", days);
  $("ytdlp-version").textContent = ytdlpVersion ? "yt-dlp " + ytdlpVersion : "yt-dlp";
  $("ytdlp-age").textContent = days === null ? t("YouTube changes often; a fresh yt-dlp fixes most failed downloads.")
    : days === 0 ? t("Built today.") : t("Built {days} ago.", {days:age});
  let snoozed = false;
  try { snoozed = Number(localStorage.getItem("deviload-engine-later") || 0) > Date.now(); } catch { snoozed = false; }
  const stale = days !== null && days >= STALE_DAYS;
  $("engine-notice").hidden = !stale || snoozed;
  $("engine-notice-text").textContent = stale ? t("This yt-dlp was built {days} ago. YouTube changes often, and an old yt-dlp is the most common reason downloads fail.", {days:age}) : "";
}
async function refreshEngineInfo() {
  try { ytdlpVersion = await invoke("ytdlp_info"); } catch { ytdlpVersion = ""; }
  renderEngineInfo();
}
// yt-dlp follows YouTube's changes almost daily, so it updates itself quietly.
function ytdlpAuto() {
  try { return localStorage.getItem("deviload-ytdlp-auto") !== "false"; } catch { return true; }
}
$("ytdlp-auto-toggle").setAttribute("aria-checked", String(ytdlpAuto()));
$("ytdlp-auto-toggle").addEventListener("click", () => {
  const next = !ytdlpAuto();
  try { localStorage.setItem("deviload-ytdlp-auto", String(next)); } catch { /* storage unavailable */ }
  $("ytdlp-auto-toggle").setAttribute("aria-checked", String(next));
});
async function autoUpdateYtdlp() {
  if (!invoke || !ytdlpAuto() || jobs.some(job => ["running", "queued"].includes(job.status))) return;
  try {
    if (Number(localStorage.getItem("deviload-ytdlp-auto-at") || 0) > Date.now() - 86400000) return;
    localStorage.setItem("deviload-ytdlp-auto-at", String(Date.now()));
  } catch { return; }
  try {
    const result = await invoke("update_ytdlp");
    ytdlpVersion = result.after;
    renderEngineInfo();
    if (result.after !== result.before) message(t("yt-dlp updated: {before} → {after}", {before:result.before, after:result.after}));
  } catch { /* the manual button and the stale notice still work */ }
}
async function updateYtdlp(button) {
  if (!invoke) { message(t("Updates are available in the installed app."), true); return; }
  button.disabled = true;
  button.classList.add("is-busy");
  message(t("Updating yt-dlp to the nightly build…"));
  try {
    const result = await invoke("update_ytdlp");
    ytdlpVersion = result.after;
    try { localStorage.removeItem("deviload-engine-later"); } catch { /* storage unavailable */ }
    renderEngineInfo();
    message(result.after === result.before ? t("yt-dlp is up to date: {version}", {version:result.after})
      : t("yt-dlp updated: {before} → {after}", {before:result.before, after:result.after}));
  } catch (error) { message(errorText(error), true); }
  finally { button.disabled = false; button.classList.remove("is-busy"); }
}
$("update-ytdlp").addEventListener("click", () => updateYtdlp($("update-ytdlp")));
$("engine-update").addEventListener("click", () => updateYtdlp($("engine-update")));
$("engine-later").addEventListener("click", () => {
  try { localStorage.setItem("deviload-engine-later", String(Date.now() + 86400000)); } catch { /* storage unavailable */ }
  renderEngineInfo();
});
async function saveProxy() {
  if (!invoke) return;
  try {
    const proxy = await invoke("set_proxy", {proxy:$("proxy").value});
    $("proxy").value = proxy;
    message(t(proxy ? "Proxy saved" : "Proxy turned off"));
  } catch (error) { message(errorText(error), true); }
}
$("proxy-save").addEventListener("click", saveProxy);
$("proxy").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); saveProxy(); } });
function openProxySettings() {
  $("app-settings-dialog").showModal();
  $("proxy").focus();
}
// Deviload 1.x kept its data next to its own files.
let legacyFolder = "";
function legacyDone() {
  try { localStorage.setItem("deviload-legacy-done", "1"); } catch { /* storage unavailable */ }
  $("legacy-notice").hidden = true;
}
async function importLegacy(folder) {
  try {
    const result = await invoke("import_legacy", {folder});
    legacyDone();
    const data = await invoke("snapshot"), options = data.options;
    $("folder").value = options.folder;
    $("rate").value = options.rateMbps;
    $("parallel").value = data.parallel;
    for (const key of ["playlist","subtitles","sponsorblock","archive"]) $(key).checked = options[key];
    $("split-chapters").checked = !!options.splitChapters;
    setQuality(options.quality);
    syncPlaylist(); syncOptionsSummary();
    render(data);
    if (result.language && result.language !== language()) setLanguage(result.language);
    message(result.files ? tn("Moved {count} file from the previous Deviload", "Moved {count} files from the previous Deviload", result.files)
      : t("Settings moved from the previous Deviload"));
    brandMascot.celebrate();
  } catch (error) { message(errorText(error), true); }
}
async function checkLegacy() {
  try { if (localStorage.getItem("deviload-legacy-done")) return; } catch { return; }
  legacyFolder = await invoke("find_legacy").catch(() => null) || "";
  if (!legacyFolder) return;
  $("legacy-notice-text").textContent = t("Deviload 1.x is in {folder}. Move its history, settings and the list of downloaded videos here?", {folder:legacyFolder});
  $("legacy-notice").hidden = false;
}
$("legacy-move").addEventListener("click", () => importLegacy(legacyFolder));
$("legacy-dismiss").addEventListener("click", legacyDone);
$("legacy-import").addEventListener("click", async () => {
  const open = window.__TAURI__?.dialog?.open;
  if (!open) return;
  try {
    const folder = await open({multiple:false, directory:true, title:t("Folder of Deviload 1.x")});
    if (typeof folder === "string" && folder) { $("app-settings-dialog").close(); await importLegacy(folder); }
  } catch (error) { message(errorText(error), true); }
});
// A new Deviload: the installed copy updates itself, the portable one opens the releases page.
let appUpdate = null, appVersion = "";
// The Windows installer, the Mac app and the AppImage update themselves; the portable
// zip and the .deb package show where to download the new version.
const onMac = navigator.userAgent.includes("Mac");
const onLinux = navigator.userAgent.includes("Linux");
function showAppUpdate() {
  let later = {};
  try { later = JSON.parse(localStorage.getItem("deviload-update-later") || "{}"); } catch { later = {}; }
  const snoozed = later.version === appUpdate?.version && later.until > Date.now();
  $("app-update-notice").hidden = !appUpdate || snoozed;
  if (!appUpdate) return;
  $("app-update-title").textContent = t("Deviload {version} is out", {version:appUpdate.version});
  $("app-update-text").textContent = appUpdate.installable
    ? t("The update takes a few seconds, then Deviload restarts. Active downloads can be resumed afterwards.")
    : onMac ? t("Download the new Mac zip from the releases page and replace Deviload in Applications, the same way as the first time.")
    : onLinux ? t("Download the new .deb from the releases page and install it over the old one.")
    : t("This is the portable version: download the new zip from the releases page and unpack it over the old one.");
  $("app-update-install-label").textContent = t(appUpdate.installable ? "Update" : "Download");
}
function updateAuto() {
  try { return localStorage.getItem("deviload-update-auto") !== "false"; } catch { return true; }
}
$("update-auto-toggle").setAttribute("aria-checked", String(updateAuto()));
$("update-auto-toggle").addEventListener("click", () => {
  const next = !updateAuto();
  try { localStorage.setItem("deviload-update-auto", String(next)); } catch { /* storage unavailable */ }
  $("update-auto-toggle").setAttribute("aria-checked", String(next));
});
async function checkAppUpdate(manual = false) {
  if (!invoke) { if (manual) message(t("Update checks are available in the app."), true); return; }
  if (!manual) {
    if (!updateAuto()) return;
    try {
      if (Number(localStorage.getItem("deviload-update-checked") || 0) > Date.now() - 86400000) return;
      localStorage.setItem("deviload-update-checked", String(Date.now()));
    } catch { /* storage unavailable */ }
  }
  try {
    appUpdate = await invoke("check_app_update");
    if (manual) {
      try { localStorage.removeItem("deviload-update-later"); } catch { /* storage unavailable */ }
      if (!appUpdate) message(t("You have the latest version: {version}", {version:appVersion}));
      else $("app-settings-dialog").close();
    }
    showAppUpdate();
  } catch (error) { if (manual) message(errorText(error), true); }
}
$("check-updates").addEventListener("click", async () => {
  const button = $("check-updates");
  button.disabled = true;
  button.classList.add("is-busy");
  try { await checkAppUpdate(true); } finally { button.disabled = false; button.classList.remove("is-busy"); }
});
$("app-update-later").addEventListener("click", () => {
  try { localStorage.setItem("deviload-update-later", JSON.stringify({version:appUpdate?.version, until:Date.now() + 3 * 86400000})); } catch { /* storage unavailable */ }
  showAppUpdate();
});
$("app-update-install").addEventListener("click", async () => {
  if (!appUpdate) return;
  if (!appUpdate.installable) { invoke("open_releases").catch(error => message(errorText(error), true)); return; }
  const ask = window.__TAURI__?.dialog?.ask;
  const active = jobs.some(job => job.status === "running");
  if (active && ask && !(await ask(t("Downloads in progress will stop. You can resume them after the update. Update now?"), {title:"Deviload", kind:"warning"}))) return;
  const button = $("app-update-install");
  button.disabled = true;
  $("app-update-later").disabled = true;
  $("app-update-progress").hidden = false;
  $("app-update-text").textContent = t("Downloading the update…");
  try { await invoke("install_app_update"); }
  catch (error) {
    message(errorText(error), true);
    $("app-update-progress").hidden = true;
    button.disabled = false;
    $("app-update-later").disabled = false;
    showAppUpdate();
  }
});
window.__TAURI__?.event?.listen?.("app-update-progress", event => {
  const share = Math.max(0, Math.min(1, Number(event.payload) || 0));
  $("app-update-progress").querySelector("span").style.width = `${Math.round(share * 100)}%`;
  $("app-update-progress").setAttribute("aria-valuenow", String(Math.round(share * 100)));
  if (share >= 1) $("app-update-text").textContent = t("Installing the update…");
});
onLanguageChange(showAppUpdate);
function systemNotice(title, detail) {
  if (localStorage.getItem("deviload-os-notify") !== "true") return;
  const notification = window.__TAURI__?.notification;
  if (!notification) return;
  Promise.resolve(notification.sendNotification({title, body:detail.slice(0,180)})).catch(() => {});
}

document.addEventListener("keydown", event => {
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === "l") {
    event.preventDefault(); showDownloads(true); return;
  }
  if (modifier && event.key.toLowerCase() === "k") {
    event.preventDefault(); showDownloads(); $("job-search").focus(); return;
  }
  if (modifier && event.key === "Enter" && !$("add").disabled) {
    event.preventDefault(); showDownloads(); $("add").click(); return;
  }
  if (event.key === "Escape") {
    for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  }
});
function hasLinkData(event) {
  const types = [...(event.dataTransfer?.types || [])];
  return types.includes("text/uri-list") || types.includes("text/plain") || types.includes("Files");
}
let dragDepth = 0;
document.addEventListener("dragenter", event => {
  if (!hasLinkData(event) || document.querySelector("dialog[open]")) return;
  dragDepth++;
  $("drop-overlay").hidden = false;
});
document.addEventListener("dragleave", () => {
  if (dragDepth && --dragDepth === 0) $("drop-overlay").hidden = true;
});
document.addEventListener("dragover", event => {
  if (hasLinkData(event) && !document.querySelector("dialog[open]")) event.preventDefault();
});
document.addEventListener("drop", async event => {
  dragDepth = 0;
  $("drop-overlay").hidden = true;
  if (!hasLinkData(event) || document.querySelector("dialog[open]")) return;
  event.preventDefault();
  let value = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
  if (!value && event.dataTransfer.files.length) {
    const file = event.dataTransfer.files[0];
    if (/\.(txt|url)$/i.test(file.name) && file.size <= 131072) value = await file.text();
  }
  // Windows .url shortcuts keep the address on a URL= line.
  const links = value.split(/\r?\n/).map(line => line.replace(/^URL=/i, "").trim())
    .filter(line => line && !line.startsWith("#") && !line.startsWith("["));
  if (!links.length) { message(t("Drop a link or a small .txt/.url file with links."), true); return; }
  addLinks(links.join(" "));
  message(t("Links added by drag and drop."));
});
wireMotion(heroOrb);

function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined) el.textContent = value;
  return el;
}
function dismissToast(toast) {
  clearTimeout(Number(toast.dataset.timer));
  toast.classList.add("leaving");
  setTimeout(() => toast.remove(), 220);
}
function message(value, error = false) {
  if (!value) return;
  const box = $("toasts");
  const same = [...box.children].find(toast => toast.dataset.text === value && !toast.classList.contains("leaving"));
  if (same) same.remove();
  const toast = node("div", "toast" + (error ? " error" : ""));
  toast.dataset.text = value;
  toast.setAttribute("role", error ? "alert" : "status");
  const icon = node("span", "icon");
  icon.dataset.icon = error ? "warning-circle" : "check-circle";
  icon.setAttribute("aria-hidden", "true");
  const close = node("button", "toast-close");
  close.type = "button";
  close.setAttribute("aria-label", t("Close"));
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
  close.addEventListener("click", () => dismissToast(toast));
  toast.append(icon, node("p", "", value), close);
  box.append(toast);
  while (box.children.length > 4) box.firstElementChild.remove();
  toast.dataset.timer = String(setTimeout(() => dismissToast(toast), error ? 9000 : 4500));
}
function clearToasts() { $("toasts").replaceChildren(); }
function setQuality(value) {
  quality = value;
  $("quality-select").value = value;
  document.querySelectorAll("[data-quality]").forEach(button => {
    const selected = button.dataset.quality === value;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  syncFormatHint();
  pop($("format-hint"), 5);
  syncModeButtons();
  heroOrb.bump();
}
function syncFormatHint() {
  $("format-hint").textContent = selectedFormat ? t("Stream {id} selected for this link.", {id:selectedFormat.id})
    : ["mp3","flac","wav"].includes(quality) ? t("Audio extraction. FLAC and WAV cannot restore quality the source never had.")
    : $("profile").value === "mobile" ? t("For phone: the result is an MP4, re-encoded when needed.") : t("Video is merged into MKV without re-encoding.");
}
function syncModeButtons() {
  const audio = ["mp3","flac","wav"].includes(quality);
  for (const [id,selected] of [["mode-video",!audio],["mode-audio",audio],
      ["mode-playlist",$("playlist").checked],["mode-subtitles",$("subtitles").checked]]) {
    const button = $(id);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}
$("mode-video").addEventListener("click", () => { clearSelectedFormat(); $("profile").value = "custom"; setQuality("1080"); });
$("mode-audio").addEventListener("click", () => { clearSelectedFormat(); $("profile").value = "custom"; setQuality("mp3"); });
$("mode-playlist").addEventListener("click", () => { $("playlist").click(); syncModeButtons(); });
$("mode-subtitles").addEventListener("click", () => { $("subtitles").click(); syncModeButtons(); });
$("playlist").addEventListener("change", syncModeButtons);
$("subtitles").addEventListener("change", syncModeButtons);
const linkField = $("urls");
function syncLinkTools() {
  const filled = Boolean(linkField.value.trim());
  $("quick-clear").hidden = !filled;
  $("paste").hidden = filled;
}
function addLinks(text) {
  const links = linkField.value.trim().split(/\s+/).filter(Boolean);
  for (const link of text.trim().split(/\s+/)) if (link && !links.includes(link)) links.push(link);
  linkField.value = links.join(" ");
  linkField.dispatchEvent(new Event("input"));
  showDownloads();
  linkField.focus({preventScroll:true});
  pop(linkField.closest(".quick-link"), 6);
}
linkField.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); $("add").click(); } });
$("quick-clear").addEventListener("click", () => { linkField.value = ""; linkField.dispatchEvent(new Event("input")); linkField.focus(); });
let clipboardCandidate = "", dismissedClipboard = "";
function clipboardEnabled() { return localStorage.getItem("deviload-clipboard") !== "false"; }
function syncClipboardToggle() { syncSwitch("clipboard-toggle", clipboardEnabled()); }
syncClipboardToggle();
async function scanClipboard() {
  if (!clipboardEnabled() || document.visibilityState !== "visible" || !document.hasFocus()) return;
  const api = window.__TAURI__?.clipboardManager;
  if (!api?.readText) return;
  try {
    const text = (await api.readText() || "").trim();
    const url = text.length <= 2048 && !/\s/.test(text) ? new URL(text) : null;
    if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password ||
        text === dismissedClipboard || linkField.value.includes(text)) {
      $("clipboard-suggestion").hidden = true; return;
    }
    clipboardCandidate = text;
    $("clipboard-host").textContent = url.hostname.replace(/^www\./, "");
    $("clipboard-suggestion").hidden = false;
  } catch { $("clipboard-suggestion").hidden = true; }
}
$("clipboard-toggle").addEventListener("click", () => {
  const enabled = !clipboardEnabled();
  localStorage.setItem("deviload-clipboard", String(enabled));
  syncClipboardToggle();
  if (enabled) scanClipboard();
  else { clipboardCandidate = ""; $("clipboard-suggestion").hidden = true; }
});
$("clipboard-use").addEventListener("click", () => {
  if (!clipboardCandidate) return;
  dismissedClipboard = clipboardCandidate;
  $("clipboard-suggestion").hidden = true;
  addLinks(clipboardCandidate);
});
$("clipboard-dismiss").addEventListener("click", () => {
  dismissedClipboard = clipboardCandidate;
  $("clipboard-suggestion").hidden = true;
});
window.addEventListener("focus", scanClipboard);
document.addEventListener("visibilitychange", scanClipboard);
setInterval(scanClipboard, 3500);
$("search-tab").addEventListener("click", () => navigate("search", true));
$("downloads-tab").addEventListener("click", () => showDownloads());
function syncPlaylist() {
  const enabled = $("playlist").checked;
  $("playlist-items").disabled = !enabled;
  $("playlist-browse").disabled = !enabled;
  $("playlist-items").closest(".playlist-count").classList.toggle("disabled", !enabled);
}
$("playlist").addEventListener("change", syncPlaylist);
syncPlaylist();
function parsePlaylistSelection(spec, entries) {
  const all = entries.map(item => item.index);
  if (!spec) return new Set(all);
  if (/^\d+$/.test(spec)) return new Set(all.filter(index => index <= Number(spec)));
  const selected = new Set();
  for (const part of spec.split(",")) {
    const [first,last] = part.split("-").map(Number);
    for (const index of all) if (index >= first && index <= (last || first)) selected.add(index);
  }
  return selected;
}
$("playlist-browse").addEventListener("click", async () => {
  if (!invoke) { message(t("The track list is available in the installed app."), true); return; }
  const address = $("urls").value.trim().split(/\s+/)[0];
  if (!address) { $("urls").focus(); message(t("Paste a playlist link first."), true); return; }
  const dialog = $("playlist-dialog");
  dialog.showModal();
  $("playlist-list").replaceChildren();
  $("playlist-status").textContent = t("Reading the playlist…");
  try {
    const info = await invoke("playlist_entries", {address});
    const selected = parsePlaylistSelection($("playlist-items").value.trim(), info.entries);
    const playlistTitle = info.title || t("Playlist");
    $("playlist-status").textContent = info.total && info.total > info.entries.length
      ? t("{title} · showing {shown} of {total} (first 100)", {title:playlistTitle, shown:info.entries.length, total:info.total})
      : t("{title} · showing {shown}", {title:playlistTitle, shown:info.entries.length});
    for (const item of info.entries) {
      const label = node("label", "playlist-entry");
      const input = node("input"); input.type = "checkbox"; input.value = item.index; input.checked = selected.has(item.index);
      label.append(input, node("span", "", item.index + ". " + (item.title || t("Untitled"))));
      if (item.duration) label.append(node("small", "", Math.floor(item.duration/60) + ":" + String(Math.round(item.duration%60)).padStart(2,"0")));
      $("playlist-list").append(label);
    }
    if (!info.entries.length) $("playlist-status").textContent = t("The playlist has no available items.");
  } catch (error) { $("playlist-status").textContent = errorText(error); }
});
$("playlist-close").addEventListener("click", () => $("playlist-dialog").close());
$("playlist-all").addEventListener("click", () => $("playlist-list").querySelectorAll("input").forEach(input => { input.checked = true; }));
$("playlist-none").addEventListener("click", () => $("playlist-list").querySelectorAll("input").forEach(input => { input.checked = false; }));
$("playlist-apply").addEventListener("click", () => {
  const indices = [...$("playlist-list").querySelectorAll("input:checked")].map(input => Number(input.value));
  if (!indices.length) { $("playlist-status").textContent = t("Select at least one track."); return; }
  const spec = playlistSelection(indices);
  if (spec.length > 80) { $("playlist-status").textContent = t("Too many scattered tracks; select fewer groups."); return; }
  $("playlist-items").value = spec;
  $("playlist-dialog").close();
  message(t("Tracks selected: {count}. Range: {range}", {count:indices.length, range:spec}));
});let signedInPath = null;
if (!navigator.userAgent.includes("Mac")) {
  // Chromium browsers on Windows encrypt cookies so yt-dlp cannot read them.
  document.querySelectorAll('#cookies-mode option[data-os="mac"]').forEach(option => option.remove());
}
function syncAuth() {
  const mode = $("cookies-mode").value;
  $("cookies-file-wrap").hidden = mode !== "file";
  $("auth-hint").textContent = mode === "account"
    ? (signedInPath ? t("Downloads use your Deviload sign-in.") : t("Sign in above; until then downloads run without an account."))
    : mode === "file" ? t("Pick a Netscape cookies.txt file. It stays on your computer only.")
    : mode === "none" ? t("Downloads run without an account. Private and age-restricted videos will fail.")
    : t("Sign in to YouTube in the selected browser. yt-dlp reads its cookies only while downloading.");
}
function renderAccount() {
  const signed = Boolean(signedInPath);
  const button = $("open-youtube-view");
  button.classList.toggle("signed-in", signed);
  $("youtube-label").textContent = signed ? "YouTube" : t("Sign in");
  button.title = signed ? t("Signed in to YouTube · open YouTube") : t("Sign in to YouTube");
  button.setAttribute("aria-label", button.title);
  $("account-state").textContent = signed ? t("Signed in to YouTube") : t("Not signed in");
  $("account-hint").textContent = signed ? t("Downloads use this session. It is stored only on this computer.")
    : t("Needed for age-restricted, private and members-only videos.");
  $("account-action").textContent = signed ? t("Sign out") : t("Sign in");
  $("account-action").className = signed ? "outline small" : "primary small";
  syncAuth();
}
async function refreshAccount() {
  signedInPath = invoke ? await invoke("youtube_login_status").catch(() => null) : null;
  renderAccount();
}
async function signIn() {
  if (!invoke) { message(t("The YouTube window is available in the Deviload app."), true); return; }
  try {
    await invoke("open_youtube", {signIn:true});
    message(t("Sign in to your Google account in the window that opened. Deviload saves the sign-in by itself."));
  } catch (error) { message(errorText(error), true); }
}
$("cookies-mode").addEventListener("change", () => {
  try { localStorage.setItem("deviload-cookies-mode", $("cookies-mode").value); } catch { /* storage unavailable */ }
  syncAuth();
});
$("account-action").addEventListener("click", async () => {
  if (!signedInPath) { signIn(); return; }
  const ask = window.__TAURI__?.dialog?.ask;
  if (ask && !(await ask(t("Sign out of YouTube? The saved session will be deleted from this computer."), {title:"Deviload", kind:"warning"}))) return;
  const button = $("account-action");
  button.disabled = true;
  try {
    await invoke("youtube_sign_out");
    signedInPath = null;
    renderAccount();
    message(t("Signed out of YouTube. The saved session was deleted."));
  } catch (error) { message(errorText(error), true); }
  finally { button.disabled = false; }
});
$("browse-cookies").addEventListener("click", async () => {
  const open = window.__TAURI__?.dialog?.open;
  if (!open) return;
  try {
    const path = await open({multiple:false, directory:false, filters:[{name:"cookies.txt", extensions:["txt"]}]});
    if (typeof path === "string" && path) $("cookies").value = path;
  } catch (error) { message(errorText(error), true); }
});
window.__TAURI__?.event?.listen?.("youtube-session", async event => {
  const before = Boolean(signedInPath);
  await refreshAccount();
  if (event.payload && signedInPath && !before) {
    if ($("cookies-mode").value === "none") { $("cookies-mode").value = "account"; syncAuth(); }
    message(t("Signed in to YouTube. Downloads now use your account."));
    brandMascot.celebrate();
  }
});
renderAccount();$("cookies-mode").addEventListener("change", syncAuth);
syncAuth();
for (const button of document.querySelectorAll("[data-folder]")) {
  button.addEventListener("click", () => {
    const path = folderPaths[button.dataset.folder];
    if (!path) { message(t("This system folder is not available on this computer."), true); return; }
    $("folder").value = path;
    syncOptionsSummary();
    document.querySelectorAll("[data-folder]").forEach(item => item.classList.toggle("active", item === button));
    message(t("Save folder: {path}", {path}));
  });
}
function showDefaultFolder(folder) {
  $("default-folder-text").textContent = folder || t("The folder of the last download.");
  $("default-folder-text").title = folder || "";
  $("default-folder-reset").hidden = !folder;
}
async function setDefaultFolder(folder) {
  try {
    const saved = await invoke("set_default_folder", {folder});
    showDefaultFolder(saved);
    if (saved) { $("folder").value = saved; $("folder").dispatchEvent(new Event("input", {bubbles:true})); }
    message(saved ? t("New downloads go to {path} by default.", {path:saved}) : t("Downloads go to the folder of the last download again."));
  } catch (error) { message(errorText(error), true); }
}
$("default-folder-pick").addEventListener("click", async () => {
  const open = window.__TAURI__?.dialog?.open;
  if (!open) { message(t("Folder selection is available in the Deviload app."), true); return; }
  const path = await open({directory:true,multiple:false,defaultPath:$("folder").value.trim() || undefined,title:t("Choose the default save folder")}).catch(() => null);
  if (typeof path === "string" && path) await setDefaultFolder(path);
});
$("default-folder-reset").addEventListener("click", () => setDefaultFolder(""));
$("folder").addEventListener("input", () => { document.querySelectorAll("[data-folder]").forEach(item => item.classList.remove("active")); syncOptionsSummary(); });
$("browse-folder").addEventListener("click", async () => {
  const open = window.__TAURI__?.dialog?.open;
  if (!open) { message(t("Folder selection is available in the Deviload app."), true); return; }
  const button = $("browse-folder");
  button.disabled = true;
  try {
    const path = await open({directory:true,multiple:false,defaultPath:$("folder").value.trim() || undefined,title:t("Choose a folder for downloads")});
    if (typeof path === "string" && path) {
      $("folder").value = path;
      $("folder").dispatchEvent(new Event("input", {bubbles:true}));
      message(t("Save folder: {path}", {path}));
    }
  } catch (error) { message(t("Could not choose the folder: {error}", {error:errorText(error)}), true); }
  finally { button.disabled = false; }
});
$("profile").addEventListener("change", () => {
  const profile = $("profile").value;
  if (profile === "custom") return;
  if (profile === "music") {
    setQuality("mp3");
    if (folderPaths.music) $("folder").value = folderPaths.music;
    $("subtitles").checked = false; $("sponsorblock").checked = false;
  } else if (profile === "archive") {
    setQuality("best");
    $("subtitles").checked = true; $("sponsorblock").checked = false;
  } else if (profile === "mobile") {
    setQuality("720");
    $("subtitles").checked = false; $("sponsorblock").checked = false;
  } else if (profile === "maximum") {
    setQuality("best");
    $("subtitles").checked = false; $("sponsorblock").checked = false;
  }
  $("archive").checked = true;
  const description = {music:"MP3 with cover art and tags",archive:"Best source and subtitles",mobile:"720p and a final MP4",maximum:"Best available quality"}[profile];
  message(t("Profile: {description}.", {description:t(description)}));
});
function setDrawer(open) {
  $("download-drawer").hidden = !open;
  $("options-toggle").setAttribute("aria-expanded", String(open));
  try { localStorage.setItem("deviload-drawer", open ? "open" : "closed"); } catch { /* storage unavailable */ }
}
function syncOptionsSummary() {
  const folder = $("folder").value.trim();
  const name = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
  $("options-summary").textContent = [name, t("{count} at a time", {count:$("parallel").value})].filter(Boolean).join(" · ");
}
$("options-toggle").addEventListener("click", () => setDrawer($("download-drawer").hidden));
$("download-drawer").addEventListener("change", event => {
  if (event.target.id === "profile") { clearSelectedFormat(); return; }
  if (["folder", "parallel"].includes(event.target.id)) { syncOptionsSummary(); return; }
  $("profile").value = "custom";
  setQuality(quality);
});
$("quality-select").addEventListener("change", event => { clearSelectedFormat(); $("profile").value = "custom"; setQuality(event.target.value); });
for (const button of document.querySelectorAll("[data-quality]")) {
  button.addEventListener("click", () => { clearSelectedFormat(); $("profile").value = "custom"; setQuality(button.dataset.quality); });
}
function parseClipTime(value) {
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return NaN;
  const numbers = parts.map(Number);
  if (numbers.length > 1 && numbers.slice(1).some(number => number >= 60)) return NaN;
  return numbers.reduce((total,number) => total * 60 + number, 0);
}
function syncClip() {
  const enabled = $("clip-enabled").checked;
  for (const id of ["clip-start","clip-end","clip-output"]) $(id).disabled = !enabled;
  if (enabled && $("playlist").checked) { $("playlist").checked = false; syncPlaylist(); syncModeButtons(); }
}
$("clip-enabled").addEventListener("change", syncClip);
$("playlist").addEventListener("change", () => {
  if ($("playlist").checked && $("clip-enabled").checked) { $("clip-enabled").checked = false; syncClip(); }
});
function isAudioJob(job) {
  return job.status === "done" && /\.(mp3|flac|wav)$/i.test(job.file || "");
}
function audioStatus(value, error = false) {
  $("audio-status").textContent = value;
  $("audio-status").classList.toggle("error", error);
}
async function openAudioTools(id) {
  if (!invoke) { message(t("Audio tools are available in the Deviload app."), true); return; }
  const job = jobs.find(item => item.id === id && isAudioJob(item));
  if (!job) return;
  currentAudioId = id;
  const dialog = $("audio-dialog");
  if (!dialog.open) dialog.showModal();
  $("audio-file").textContent = job.file.split(/[\\/]/).pop();
  $("audio-save").disabled = true;
  $("audio-normalize").disabled = true;
  audioStatus(t("Reading tags…"));
  try {
    const info = await invoke("audio_info", {id});
    if (!dialog.open || currentAudioId !== id) return;
    for (const field of ["title", "artist", "album", "track"]) $("audio-" + field).value = info[field] || "";
    audioStatus(info.duration ? t("Duration: {seconds} s", {seconds:info.duration.toFixed(1)}) : t("Duration: unknown"));
    $("audio-save").disabled = false;
    $("audio-normalize").disabled = false;
  } catch (error) { audioStatus(errorText(error), true); }
}
$("audio-close").addEventListener("click", () => $("audio-dialog").close());
$("audio-dialog").addEventListener("close", () => { currentAudioId = null; });
$("audio-save").addEventListener("click", async () => {
  if (currentAudioId === null) return;
  const id = currentAudioId;
  $("audio-save").disabled = true;
  audioStatus(t("Saving a new tagged copy…"));
  const tags = Object.fromEntries(["title","artist","album","track"].map(key => [key,$("audio-" + key).value]));
  try {
    const file = await invoke("audio_save_tags", {id,tags});
    if (currentAudioId === id) audioStatus(t("Done: {file} · next to the original", {file:file.split(/[\\/]/).pop()}));
    addNotice(t("Tags saved"), file.split(/[\\/]/).pop());
  } catch (error) { if (currentAudioId === id) audioStatus(errorText(error), true); }
  finally { if (currentAudioId === id) $("audio-save").disabled = false; }
});
$("audio-normalize").addEventListener("click", async () => {
  if (currentAudioId === null) return;
  const id = currentAudioId;
  $("audio-normalize").disabled = true;
  audioStatus(t("FFmpeg is normalizing the loudness…"));
  try {
    const file = await invoke("audio_normalize", {id});
    if (currentAudioId === id) audioStatus(t("Done: {file} · next to the original", {file:file.split(/[\\/]/).pop()}));
    addNotice(t("Loudness normalized"), file.split(/[\\/]/).pop());
  } catch (error) { if (currentAudioId === id) audioStatus(errorText(error), true); }
  finally { if (currentAudioId === id) $("audio-normalize").disabled = false; }
});async function openPlayer(id) {
  if (!invoke || !convertFileSrc) { message(t("The player is available in the Deviload app."), true); return; }
  const job = jobs.find(item => item.id === id && item.status === "done");
  if (!job) return;
  currentPlayerId = id;
  const dialog = $("player-dialog");
  const video = $("player-video"), audio = $("player-audio"), image = $("player-image");
  video.pause(); audio.pause(); video.removeAttribute("src"); audio.removeAttribute("src"); image.removeAttribute("src");
  video.hidden = true; audio.hidden = true; image.hidden = true;
  video.querySelectorAll("track").forEach(track => track.remove());
  $("player-chapters").replaceChildren(); $("player-chapters").hidden = true;
  $("player-title").textContent = job.file.split(/[\\/]/).pop();
  renderCinemaQueue();
  $("player-status").textContent = t("Opening the file…");
  if (!dialog.open) dialog.showModal();
  brandMascot.setActivity("cinema"); brandMascot.reactCinema();
  try {
    const file = await invoke("media_source", {id});
    if (!dialog.open || currentPlayerId !== id) return;
    const element = /\.(gif)$/i.test(file) ? image : /\.(mp3|flac|wav|m4a|ogg)$/i.test(file) ? audio : video;
    element.hidden = false;
    element.src = convertFileSrc(file);
    if (element !== image) {
      const saved = Number(cinemaPositions[job.file] || 0);
      element.addEventListener("loadedmetadata", () => { if (currentPlayerId === id && saved > 1 && saved < element.duration - 10) element.currentTime = saved; }, {once:true});
      element.load();
    }
    $("player-status").textContent = t("Use the player buttons to control playback.");
    if (element === video) {
      let metadata;
      try { metadata = await invoke("player_metadata", {id}); }
      catch { return; }
      if (!dialog.open || currentPlayerId !== id || video.hidden) return;
      const chapters = $("player-chapters");
      for (const chapter of metadata.chapters || []) {
        const title = chapter.title || t("Chapter · {time}", {time:Math.floor(chapter.start / 60) + ":" + String(Math.floor(chapter.start % 60)).padStart(2,"0")});
        const button = node("button", "", title);
        button.type = "button"; button.addEventListener("click", () => { video.currentTime = chapter.start; video.play().catch(() => {}); });
        chapters.append(button);
      }
      chapters.hidden = !chapters.childElementCount;
      if (metadata.subtitles) {
        const track = document.createElement("track");
        const subtitleLanguage = metadata.subtitleLanguage || "und";
        track.kind = "subtitles";
        track.label = subtitleLanguage === "und" ? t("Subtitles") : t("Subtitles · {language}", {language:subtitleLanguage});
        track.srclang = subtitleLanguage;
        track.src = metadata.subtitles;
        video.append(track);
      }
    }
  } catch (error) { $("player-status").textContent = errorText(error); }
}
$("player-video").addEventListener("error", () => { if ($("player-video").getAttribute("src")) $("player-status").textContent = t("The built-in player does not support this codec."); });
$("player-audio").addEventListener("error", () => { if ($("player-audio").getAttribute("src")) $("player-status").textContent = t("The built-in player cannot play this audio format."); });
$("close-player").addEventListener("click", () => $("player-dialog").close());
$("player-dialog").addEventListener("close", () => {
  saveCinemaPosition();
  currentPlayerId = null;
  brandMascot.setActivity($("share-dialog").open ? "share" : "idle");
  for (const id of ["player-video", "player-audio"]) { const el = $(id); el.pause(); el.removeAttribute("src"); el.load(); }
  $("player-image").removeAttribute("src"); $("player-image").hidden = true;
});
let lastCinemaSave = -1;
function saveCinemaPosition() {
  const job = jobs.find(item => item.id === currentPlayerId);
  if (!job) return;
  const element = $("player-video").hidden ? $("player-audio") : $("player-video");
  if (!Number.isFinite(element.currentTime)) return;
  const second = element.ended ? 0 : Math.floor(element.currentTime);
  if (second === lastCinemaSave) return;
  lastCinemaSave = second;
  cinemaPositions[job.file] = second;
  persistSection("positions", cinemaPositions);
}
for (const id of ["player-video", "player-audio"]) {
  $(id).addEventListener("timeupdate", () => { if (Math.floor($(id).currentTime) % 5 === 0) saveCinemaPosition(); });
  $(id).addEventListener("ended", () => {
    saveCinemaPosition();
    const index = cinemaIds.indexOf(currentPlayerId);
    if (index >= 0 && index < cinemaIds.length - 1) openPlayer(cinemaIds[index + 1]);
  });
}
function renderCinemaQueue() {
  const list = $("cinema-items");
  list.replaceChildren();
  for (const id of cinemaIds) {
    const job = jobs.find(item => item.id === id);
    if (!job) continue;
    const button = node("button", id === currentPlayerId ? "selected" : "", job.file.split(/[\\/]/).pop());
    button.type = "button";
    button.addEventListener("click", () => { saveCinemaPosition(); openPlayer(id); });
    list.append(button);
  }
  const index = cinemaIds.indexOf(currentPlayerId);
  $("cinema-prev").disabled = index <= 0;
  $("cinema-next").disabled = index < 0 || index >= cinemaIds.length - 1;
  $("player-cut").hidden = !jobs.some(job => job.id === currentPlayerId && isVideoJob(job));
}
$("cinema-open").addEventListener("click", () => {
  if (!cinemaIds.length) { message(t("The library has no files to watch yet."), true); return; }
  openPlayer(cinemaIds[0]);
});
$("cinema-prev").addEventListener("click", () => { const index = cinemaIds.indexOf(currentPlayerId); if (index > 0) { saveCinemaPosition(); openPlayer(cinemaIds[index - 1]); } });
$("cinema-next").addEventListener("click", () => { const index = cinemaIds.indexOf(currentPlayerId); if (index >= 0 && index < cinemaIds.length - 1) { saveCinemaPosition(); openPlayer(cinemaIds[index + 1]); } });
$("player-cut").addEventListener("click", () => { if (currentPlayerId == null) return; const id = currentPlayerId; $("player-dialog").close(); devilCut.open(id); });
$("player-share").addEventListener("click", () => { if (currentPlayerId != null) startShare(currentPlayerId); });
// Devil Cut opens in its own window; this page lists its projects.
const devilCut = createCutHome({t, node, getJobs:() => jobs, isVideoJob,
  openEditor:request => invoke ? invoke("open_devil_cut", request).catch(error => message(errorText(error), true)) : message(t("Devil Cut works in the installed Deviload app."), true),
  deleteProject:id => invoke("save_ui_project", {id, project:null})});
$("open-editor").addEventListener("click", () => devilCut.open());
window.__TAURI__?.event?.listen?.("devilcut-projects", async () => {
  try { devilCut.setProjects((await invoke("ui_store")).projects || {}); } catch { /* keep the current list */ }
});
$("devilcut-tab").addEventListener("click", () => navigate("editor"));
function openConverter(files = []) {
  if (!invoke) { message(t("The converter works in the Deviload app."), true); return; }
  invoke("open_converter", {files}).catch(error => message(errorText(error), true));
}
$("converter-tab").addEventListener("click", () => openConverter());
// "More" menus open upwards near the bottom of the window, and close on a click elsewhere or when another opens.
document.addEventListener("toggle", event => {
  const menu = event.target;
  if (!menu.classList?.contains("library-more") || !menu.open) return;
  document.querySelectorAll(".library-more[open]").forEach(other => { if (other !== menu) other.open = false; });
  const list = menu.querySelector(".library-more-actions");
  menu.classList.remove("up");
  if (list && list.getBoundingClientRect().bottom > innerHeight - 8) menu.classList.add("up");
}, true);
document.addEventListener("pointerdown", event => {
  document.querySelectorAll(".library-more[open]").forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
});
// The Jellyfin / Plex layout names files itself, so the file name choice does not apply.
function syncNameRule() {
  const server = $("folder-rule").value === "server";
  $("name-rule").disabled = server;
  $("name-rule").title = server ? t("Jellyfin and Plex need the channel, the date and the title in the name") : "";
}
$("folder-rule").addEventListener("change", syncNameRule);
function showMediaServer(server = {}) {
  $("server-kind").value = server.kind || "";
  $("server-url").value = server.url || "";
  $("server-token").value = server.token || "";
  for (const id of ["server-url", "server-token"]) $(id).disabled = !$("server-kind").value;
}
$("server-kind").addEventListener("change", () => { for (const id of ["server-url", "server-token"]) $(id).disabled = !$("server-kind").value; });
$("server-save").addEventListener("click", async () => {
  const button = $("server-save");
  const server = {kind:$("server-kind").value, url:$("server-url").value.trim(), token:$("server-token").value.trim()};
  button.disabled = true;
  try {
    await invoke("set_media_server", {server});
    if (!server.kind) { message(t("The media server is off.")); return; }
    await invoke("check_media_server");
    message(t("Connected: the server is looking for new files."));
  } catch (error) { message(errorText(error), true); }
  finally { button.disabled = false; }
});
// Sleep or shut down after the downloads: Rust waits for the queue and counts down a minute.
$("after-downloads").addEventListener("change", async () => {
  const action = $("after-downloads").value;
  try {
    await invoke("set_after_downloads", {action});
    const busy = jobs.some(job => ["running", "queued"].includes(job.status));
    if (action !== "none") message(t(action === "sleep"
      ? (busy ? "The computer goes to sleep when the current downloads finish." : "The computer goes to sleep after the next downloads.")
      : (busy ? "The computer shuts down when the current downloads finish." : "The computer shuts down after the next downloads.")));
  } catch (error) { $("after-downloads").value = "none"; message(errorText(error), true); }
});
let powerTimer = 0;
function closePower() {
  clearInterval(powerTimer);
  $("after-downloads").value = "none";
  if ($("power-dialog").open) $("power-dialog").close();
}
window.__TAURI__?.event?.listen?.("power-countdown", event => {
  const {action, seconds} = event.payload;
  let left = seconds;
  const text = () => t(action === "sleep" ? "The computer goes to sleep in {seconds} s." : "The computer shuts down in {seconds} s.", {seconds:left});
  $("power-text").textContent = text();
  clearInterval(powerTimer);
  powerTimer = setInterval(() => { left = Math.max(0, left - 1); $("power-text").textContent = text(); }, 1000);
  if (!$("power-dialog").open) $("power-dialog").showModal();
});
window.__TAURI__?.event?.listen?.("power-cancelled", () => { closePower(); message(t("Cancelled. The computer stays on.")); });
window.__TAURI__?.event?.listen?.("power-simulated", () => { closePower(); message(t("Test copy: the computer was not turned off.")); });
window.__TAURI__?.event?.listen?.("power-failed", event => { closePower(); message(errorText(event.payload), true); });
$("power-cancel").addEventListener("click", () => invoke("cancel_power").catch(() => {}));
$("power-dialog").addEventListener("cancel", event => { event.preventDefault(); invoke("cancel_power").catch(() => {}); });
let searchRequest = 0;
$("media-search-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!invoke) { $("media-search-status").textContent = t("Search works in the installed Deviload app."); return; }
  const query = $("media-query").value.trim();
  if (!query) return;
  const request = ++searchRequest;
  const button = $("media-search-button");
  button.disabled = true;
  $("media-search-status").textContent = t("Searching…");
  $("media-results").replaceChildren();
  setPose($("search-mascot"), "working");
  try {
    const hits = await invoke("search_media", {query,source:$("media-source").value});
    if (request !== searchRequest) return;
    $("media-search-status").textContent = hits.length ? t("Found: {count}", {count:hits.length}) : t("Nothing found. Try another query.");
    setPose($("search-mascot"), hits.length ? "victory" : "look", hits.length ? "look" : null);
    for (const hit of hits) {
      const card = node("article", "search-result");
      if (hit.thumbnail) {
        const picture = node("img", "search-thumb");
        picture.src = hit.thumbnail;
        picture.alt = "";
        picture.loading = "lazy";
        picture.referrerPolicy = "no-referrer";
        card.append(picture);
      }
      const body = node("div", "search-result-body");
      body.append(node("strong", "", hit.title || t("Untitled")),
        node("span", "", [hit.channel, hit.duration ? Math.floor(hit.duration/60) + ":" + String(hit.duration%60).padStart(2,"0") : ""].filter(Boolean).join(" · ")));
      const add = node("button", "outline small", t("Add"));
      add.type = "button";
      add.addEventListener("click", () => {
        const existing = $("urls").value.trim();
        if (!existing.split(/\s+/).includes(hit.url)) $("urls").value = [existing,hit.url].filter(Boolean).join("\n");
        $("urls").dispatchEvent(new Event("input"));
        showDownloads(true);
        message(t("Link added. Choose a format and press “Download”."));
        pop($("urls"), 6);
      });
      card.append(body, add);
      $("media-results").append(card);
    }
  } catch (error) {
    if (request === searchRequest) { $("media-search-status").textContent = errorText(error); setPose($("search-mascot"), "error", "look", 3500); }
  } finally { if (request === searchRequest) button.disabled = false; }
});let inspectTimer = 0, inspectSerial = 0, inspectedInfo = null;
function linksIn(text) {
  return text.trim().split(/\s+/).filter(item => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(item));
}
function renderLinkCount(count) {
  const card = $("inspect-card");
  const body = node("div", "inspect-body");
  body.append(node("strong", "", t("{count} links ready", {count})),
    node("span", "", t("They go to the queue with the format selected above.")));
  const icon = node("span", "inspect-glyph icon");
  icon.dataset.icon = "list";
  card.replaceChildren(icon, body);
  card.dataset.state = "ready";
  card.hidden = false;
}
function renderInspect(info, address) {
  const card = $("inspect-card");
  card.replaceChildren();
  card.dataset.state = "ready";
  if (info.thumbnail) {
    const picture = node("img", "inspect-cover");
    picture.src = info.thumbnail; picture.alt = "";
    picture.referrerPolicy = "no-referrer";
    card.append(picture);
  }
  const body = node("div", "inspect-body");
  body.append(node("strong", "", info.title || t("Untitled")));
  const parts = [info.channel];
  if (info.duration) {
    const seconds = Math.round(info.duration);
    parts.push(Math.floor(seconds/60) + ":" + String(seconds%60).padStart(2,"0"));
  }
  if (info.itemCount) parts.push(t("Items: {count}", {count:info.itemCount}));
  if (info.chapterCount) parts.push(t("Chapters: {count}", {count:info.chapterCount}));
  body.append(node("span", "", parts.filter(Boolean).join(" · ")));
  card.append(body);
  if (info.isList) {
    const follow = node("button", "outline small inspect-watch", t("Watch for new videos"));
    follow.type = "button";
    follow.addEventListener("click", () => addWatch(address, follow));
    card.append(follow);
  }
  if (info.formats?.length) {
    const formats = node("details", "inspect-formats");
    formats.open = false;
    formats.append(node("summary", "", t("Pick an exact stream ({count})", {count:info.formats.length})));
    formats.append(node("p", "", t("Pick a stream for this link. If the video has no sound, Deviload adds the best audio track.")));
    const list = node("div", "inspect-format-list");
    for (const format of info.formats) {
      const button = node("button", "inspect-format" + (selectedFormat?.id === format.id ? " selected" : ""));
      button.type = "button";
      const resolution = format.hasVideo ? (format.height ? format.height + "p" : t("Video")) : t("Audio");
      const codecs = [format.videoCodec !== "none" ? format.videoCodec.split(".")[0] : "",
        format.audioCodec !== "none" ? format.audioCodec.split(".")[0] : ""].filter(Boolean).join(" + ");
      const size = format.bytes ? " · ≈" + sizeText(format.bytes) : "";
      button.textContent = resolution + (format.fps ? " · " + Math.round(format.fps) + " FPS" : "") +
        " · " + format.extension.toUpperCase() + " · " + codecs + size;
      button.title = t("Stream {id}", {id:format.id});
      button.addEventListener("click", () => {
        selectedFormat = {url:address,id:format.id,hasAudio:format.hasAudio,hasVideo:format.hasVideo,bytes:format.bytes};
        if (!format.hasVideo) setQuality("mp3");
        else if (["mp3","flac","wav"].includes(quality)) setQuality("best");
        document.querySelectorAll(".inspect-format").forEach(peer => peer.classList.toggle("selected", peer === button));
        syncFormatHint();
      });
      list.append(button);
    }
    formats.append(list);
    card.append(formats);
  }
  card.hidden = false;
}
async function inspectLink(address) {
  if (!invoke) return;
  const serial = ++inspectSerial;
  const card = $("inspect-card");
  const loading = node("div", "inspect-loading");
  loading.append(mascotSpot("working", "inspect-mascot"), node("span", "", t("Loading the preview…")));
  card.replaceChildren(loading);
  card.dataset.state = "loading";
  card.hidden = false;
  try {
    const info = await invoke("inspect_media", {address});
    if (serial !== inspectSerial) return;
    inspectedAddress = address;
    inspectedInfo = info;
    renderInspect(info, address);
  } catch (error) {
    if (serial !== inspectSerial) return;
    card.dataset.state = "error";
    card.replaceChildren(node("p", "inspect-error", t("No preview for this link: {error}", {error:errorText(error)})));
  }
}
linkField.addEventListener("input", () => {
  syncLinkTools();
  clearTimeout(inspectTimer);
  const links = linksIn(linkField.value);
  if (selectedFormat && (links.length !== 1 || links[0] !== selectedFormat.url)) { selectedFormat = null; syncFormatHint(); }
  const card = $("inspect-card");
  if (!links.length) { inspectSerial++; inspectedAddress = ""; inspectedInfo = null; card.hidden = true; card.replaceChildren(); return; }
  if (links.length > 1) { inspectSerial++; inspectedAddress = ""; inspectedInfo = null; renderLinkCount(links.length); return; }
  if (links[0] === inspectedAddress) return;
  inspectTimer = setTimeout(() => inspectLink(links[0]), 450);
});
syncLinkTools();
$("paste").addEventListener("click", async () => {
  try {
    const readText = window.__TAURI__?.clipboardManager?.readText || navigator.clipboard?.readText?.bind(navigator.clipboard);
    if (!readText) throw new Error(t("The clipboard is unavailable"));
    const text = (await readText() || "").trim();
    if (!text) { message(t("The clipboard is empty.")); return; }
    addLinks(text);
  } catch { message(t("Could not read the clipboard. Paste the link with Ctrl+V / ⌘V."), true); }
});
$("open-youtube-view").addEventListener("click", async () => {
  if (!signedInPath) { signIn(); return; }
  try { await invoke("open_youtube", {signIn:false}); }
  catch (error) { message(errorText(error), true); }
});
$("open-folder").addEventListener("click", async () => {
  if (!invoke) { message(t("The folder opens in the installed Deviload app."), true); return; }
  try { await invoke("open_downloads", {folder:$("folder").value.trim() || null}); }
  catch (error) { message(errorText(error), true); }
});
function changeStatus(row, status) {
  const previous = row.dataset.status;
  if (previous === status) return;
  row.dataset.status = status;
  if (previous) {
    pop(row, status === "done" ? 10 : 4);
    if (status === "done" || status === "error") heroOrb.bump();
  }
}
function createCard(job) {
  const row = node("article", "job");
  row.dataset.id = job.id;
  const cover = node("div", "media-cover");
  const preview = mediaPreview(job.url);
  if (preview) {
    cover.classList.add("has-preview");
    const img = node("img");
    img.src = preview;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => { cover.classList.remove("has-preview"); cover.classList.add("no-preview"); });
    cover.append(img);
  } else cover.classList.add("no-preview");
  const icon = node("div", "cover-orb media-pulse");
  icon.setAttribute("aria-hidden", "true");
  cover.append(icon, node("span", "media-badge"));
  taskOrbs.set(job.id, new MediaPulse(icon, job.status));
  const content = node("div", "job-content");
  const body = node("div", "job-body");
  body.append(node("h3", "job-title"), node("p", "job-source"), node("div", "job-meta"), node("p", "job-help"));
  content.append(body, node("div", "job-controls"));
  row.append(cover, content);
  pop(row, 12);
  return row;
}
function addAction(controls, label, className, handler, title = "", iconName = "") {
  const button = node("button", className, label);
  if (iconName) { const icon = node("span", "icon"); icon.dataset.icon = iconName; icon.setAttribute("aria-hidden", "true"); button.prepend(icon); }
  button.type = "button";
  if (title) button.title = title;
  button.addEventListener("click", handler);
  controls.append(button);
}
function showReaction(kind, detail) {
  const overlay = $("reaction-overlay");
  clearTimeout(reactionTimer);
  overlay.hidden = false;
  overlay.dataset.kind = kind;
  $("reaction-title").textContent = kind === "success" ? t("DONE!") : t("DOWNLOAD FAILED");
  $("reaction-detail").textContent = detail;
  document.body.dataset.reaction = kind;
  overlay.classList.remove("reaction-appear");
  void overlay.offsetWidth;
  overlay.classList.add("reaction-appear");
  reactionTimer = setTimeout(() => { overlay.hidden = true; delete document.body.dataset.reaction; }, 3200);
}

function render(data) {
  jobs = data.jobs || [];
  if (noticeReady) for (const job of jobs) {
    const old = knownJobStates.get(job.id);
    if (old && old !== job.status && job.status === "running") brandMascot.reactStart();
    if (old && old !== job.status && ["done","error"].includes(job.status)) {
      const detail = job.status === "error" ? t(diagnoseError(job.log, Boolean(signedInPath)).title) : (job.file.split(/[\\/]/).pop() || job.url);
      const title = t(job.status === "done" ? "Download ready" : "Download failed");
      addNotice(title, detail);
      systemNotice("Deviload · " + title, detail);
      if (job.status === "done") brandMascot.celebrate(); else brandMascot.fail();
      showReaction(job.status === "done" ? "success" : "error", detail);
    }
  }
  knownJobStates = new Map(jobs.map(job => [job.id,job.status])); noticeReady = true;
  const state = orbState(jobs);
  syncTray(state, jobs.filter(job => job.status === "running").length);
  heroOrb.setState(state);
  brandMascot.setState(state);
  const runningJobs = jobs.filter(job => job.status === "running");
  brandMascot.setSource(runningJobs[0]?.url || null);
  renderLiveDownload(runningJobs);
  $("orb-label").textContent = t(stateNames[state]);
  $("queue-orb").setAttribute("aria-label", t(stateNames[state]));
  const totals = counts(jobs);
  $("total").textContent = totals.total;
  $("active-count").textContent = visibleJobs(jobs, "active", "").length;
  $("scheduled-count").textContent = visibleJobs(jobs, "scheduled", "").length;
  $("library-count").textContent = totals.done;
  $("issue-count").textContent = visibleJobs(jobs, "issues", "").length;
  $("stat-total").textContent = totals.total;
  $("stat-active").textContent = jobs.filter(job => ["queued","running","cancelling","pausing"].includes(job.status)).length;
  $("stat-done").textContent = totals.done;
  $("counts").textContent = t("{active} active · {done} finished", {active:totals.active, done:totals.done});
  $("queue-title").textContent = t(filters[currentFilter][1]);
  const visible = visibleJobs(jobs, currentFilter, search);
  $("empty").hidden = visible.length > 0;
  const emptyTitle = search ? "Nothing found" :
    currentFilter === "active" ? "No current tasks" :
    currentFilter === "scheduled" ? "No scheduled tasks" :
    currentFilter === "issues" ? "Everything is on track" : "Your media will appear here";
  $("empty").querySelector("h3").textContent = t(emptyTitle);
  setPose($("empty-mascot"), search ? "look" : currentFilter === "issues" ? "victory" : "front");
  $("empty").querySelector("p").textContent = t(search ? "Try a different search query." :
    currentFilter === "all" ? "Add a link above and the first card appears here." :
    "Cards appear here when task states change.");
  const existing = new Map([...$("jobs").children].map(row => [Number(row.dataset.id), row]));
  let slot = 0;
  for (const job of visible) {
    let row = existing.get(job.id);
    if (!row) row = createCard(job);
    // Move a card only when its place changed: moving it on every refresh swallows a click in progress.
    const here = $("jobs").children[slot];
    if (here !== row) $("jobs").insertBefore(row, here || null);
    slot++;
    existing.delete(job.id);
    taskOrbs.get(job.id)?.setState(job.status);
    taskOrbs.get(job.id)?.setProgress(job.percent);
    changeStatus(row, job.status);
    row.querySelector(".media-badge").textContent = statusLabel(job.status);
    const name = job.file ? job.file.split(/[\\/]/).pop() : job.url;
    const title = row.querySelector(".job-title");
    title.textContent = name;
    title.title = job.file || job.url;
    try { row.querySelector(".job-source").textContent = new URL(job.url).hostname.replace(/^www\./, "") + " · " + job.url; }
    catch { row.querySelector(".job-source").textContent = job.url; }
    const meta = row.querySelector(".job-meta");
    const nextRun = job.status === "queued" && job.scheduledAt && job.scheduledAt * 1000 > Date.now()
      ? t(job.retryAttempts ? "Retry {attempt}/2 · {time}" : "Starts · {time}", {attempt:job.retryAttempts,
        time:new Date(job.scheduledAt * 1000).toLocaleString(locale(), {day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})})
      : null;
    meta.replaceChildren(node("span", "", job.options.quality.toUpperCase()),
      node("span", "", nextRun || (job.status === "running" ? (job.percent >= 99.95 ? t("Processing the file") : [Math.round(job.percent) + "%", speedText(job.speed)].filter(Boolean).join(" · ")) : statusLabel(job.status))));
    const issue = job.status === "error" ? diagnoseError(job.log, Boolean(signedInPath)) : null;
    // yt-dlp skips what the download archive lists, even when the file was deleted since.
    const skipped = job.status === "done" && job.archived > 0 ? job.archived : 0;
    // After a failure Deviload may be trying a fix by itself.
    const healing = ["queued", "running"].includes(job.status) && job.healed?.length ? job.healed.at(-1) : "";
    const help = row.querySelector(".job-help");
    const helpKey = issue ? issue.title + issue.message + language() : skipped ? "archived" + skipped + (job.file ? "+" : "") + language()
      : healing ? "healing" + healing + language() : "";
    if (help.dataset.key !== helpKey) {
      help.dataset.key = helpKey;
      const text = node("div", "job-help-text");
      if (issue) text.append(node("strong", "", t(issue.title)), node("span", "", t(issue.message)));
      else if (skipped) text.append(node("strong", "", t(job.file ? "Some items were downloaded before" : "Nothing new: downloaded before")),
        node("span", "", tn("{count} item was skipped because it was downloaded before, even if its file was deleted since. “Download again” brings back what is missing.",
          "{count} items were skipped because they were downloaded before, even if their files were deleted since. “Download again” brings back what is missing.", skipped)));
      else if (healing) text.append(node("strong", "", t("Deviload is fixing it")), node("span", "", t({
        "sign-in":"YouTube asked to sign in, so the download runs again with your account.",
        format:"The chosen stream is gone, so the download runs again with the usual quality choice.",
        update:"yt-dlp looked outdated. Deviload updates it when the current downloads finish, then tries again.",
        wait:"YouTube asked to slow down. The download tries again in 10 minutes.",
      }[healing] || "The download runs again.")));
      help.replaceChildren(...(issue ? [mascotSpot("error", "help-mascot"), text] : skipped || healing ? [mascotSpot(healing ? "working" : "look", "help-mascot"), text] : []));
    }
    help.hidden = !issue && !skipped && !healing;
    const controls = row.querySelector(".job-controls");
    const key = actions(job.status).join(",") + (skipped ? "|again" : "") + (issue?.action || "") + (isVideoJob(job) ? "|video" : job.status === "done" && job.file ? "|file" : "");
    if (controls.dataset.actions !== key) {
      controls.dataset.actions = key;
      controls.replaceChildren();
      // A fixed set of visible buttons per state keeps the rows in even columns; the rest goes under "More".
      const more = node("details", "library-more job-more");
      const menu = node("div", "library-more-actions");
      more.append(node("summary", "", t("More")), menu);
      for (const action of actions(job.status)) {
        const title = {retry:"Retry",cancel:"Cancel",pause:"Pause",resume:"Resume"}[action];
        const icon = {retry:"arrow-clockwise",cancel:"x-circle",pause:"pause",resume:"play"}[action];
        addAction(controls, t(title), "quiet", async event => {
          const button = event.currentTarget;
          button.disabled = true;
          try { await invoke("change_job", {id:job.id,action}); await refresh(); }
          catch (error) { message(errorText(error), true); }
          finally { button.disabled = false; }
        }, "", icon);
      }
      if (["queued","paused"].includes(job.status)) {
        for (const [direction,title,icon] of [["up","Move up","arrow-up"],["down","Move down","arrow-down"]]) {
          addAction(menu, t(title), "quiet", async event => {
            const button = event.currentTarget;
            button.disabled = true;
            try { await invoke("move_job", {id:job.id,direction}); await refresh(); }
            catch (error) { message(errorText(error), true); }
            finally { button.disabled = false; }
          }, "", icon);
        }
      }
      if (issue?.action === "login") addAction(controls, t(signedInPath ? "Sign in again" : "Sign in to YouTube"), "quiet fix-action", signIn, "", "play");
      if (issue?.action === "update") addAction(controls, t("Update yt-dlp"), "quiet fix-action", event => updateYtdlp(event.currentTarget), "", "arrow-clockwise");
      if (issue?.action === "proxy") addAction(controls, t("Proxy settings"), "quiet fix-action", openProxySettings, "", "gear");
      if (job.status === "done" && job.file) {
        addAction(controls, t("Watch"), "quiet", () => openPlayer(job.id), t("Play the finished file in Deviload."), "play");
        addAction(controls, t("To phone"), "transfer-button", () => startShare(job.id), t("Send this file to a phone with a QR code."), "phone-transfer");
        addAction(menu, t("Show in folder"), "quiet", async () => {
          try { await invoke("reveal_download", {id:job.id}); }
          catch (error) { message(errorText(error), true); }
        }, "", "folder-open");
        if (isAudioJob(job)) addAction(menu, t("Audio"), "quiet", () => openAudioTools(job.id), t("Edit tags or normalize loudness."), "music-notes");
        if (isVideoJob(job)) addAction(menu, "Devil Cut", "quiet", () => devilCut.open(job.id), t("Trim the video or make a GIF locally."), "scissors");
      }
      if (skipped) {
        addAction(controls, t("Download again"), "quiet", async event => {
          event.currentTarget.disabled = true;
          try { await invoke("change_job", {id:job.id, action:"again"}); await refresh(); }
          catch (error) { message(errorText(error), true); }
        }, t("Download without the archive check; files still on the disk are not downloaded twice."), "arrow-clockwise");
      }
      if (["done", "error", "cancelled", "interrupted"].includes(job.status)) {
        // Tidying a finished file is occasional; a failed or cancelled task is mostly there to be removed.
        addAction(job.status === "done" ? menu : controls, t("Remove"), "quiet", async () => {
          try { await invoke("remove_job", {id:job.id}); await refresh(); }
          catch (error) { message(errorText(error), true); }
        }, job.status === "done" ? t("Remove from the queue. The file stays in the library.") : t("Remove from the queue."), "x-circle");
      }
      addAction(menu, t("Log"), "quiet", () => {
        logJobId = job.id;
        $("log-content").textContent = jobs.find(item => item.id === job.id)?.log.join("\n") || t("The log is empty so far");
        $("log-dialog").showModal();
      }, "", "list");
      controls.append(more);
    }
  }
  existing.forEach((row,id) => { taskOrbs.get(id)?.destroy(); taskOrbs.delete(id); row.remove(); });
  renderMediaLibrary();
  devilCut.refresh();
  if (data.warning) message(translateMessage(data.warning), true);
}
function renderLiveDownload(runningJobs) {
  const current = runningJobs[0];
  liveFire.setActive(Boolean(current));
  if (!current) return;
  const name = current.file ? current.file.split(/[\\/]/).pop() : current.url;
  const percent = Math.max(0, Math.min(100, Number(current.percent) || 0));
  $("live-name").textContent = name;
  $("live-name").title = current.file || current.url;
  const finalizing = percent >= 99.95;
  const recentLog = (current.log || []).slice(-12).join("\n");
  const phase = t(/Creating a GIF/i.test(recentLog) ? "Creating a GIF" :
    /\[Merger\]/i.test(recentLog) ? "Merging video and audio" :
    /\[ExtractAudio\]/i.test(recentLog) ? "Creating the audio file" :
    /\[VideoConvertor\]/i.test(recentLog) ? "Converting the video" :
    /\[(?:EmbedThumbnail|Metadata|EmbedSubtitle|MoveFiles)\]/i.test(recentLog) ? "Saving metadata" :
    "Finishing the file");
  $("live-more").textContent = finalizing ? phase : runningJobs.length > 1 ? t("+{count} more", {count:runningJobs.length - 1}) : speedText(current.speed);
  $("live-percent").textContent = finalizing ? t("PROCESSING") : Math.round(percent) + "%";
  const track = $("live-download").querySelector(".track");
  if (finalizing) track.setAttribute("aria-valuetext", phase);
  else track.removeAttribute("aria-valuetext");
  liveFire.setProgress(finalizing ? 98 : percent);
}
let libraryEditingId = null;
function saveLibraryMeta() { persistSection("library", libraryMeta); }
function libraryEntry(job) { return libraryMeta[job.file] || {favorite:false,collection:"",tags:[]}; }
function refreshCollections() {
  const select = $("library-collection"), current = select.value;
  const names = [...new Set(Object.values(libraryMeta).map(item => item.collection).filter(Boolean))].sort();
  select.replaceChildren(new Option(t("All collections"), ""));
  for (const name of names) select.add(new Option(name, name));
  select.value = names.includes(current) ? current : "";
}
function openLibraryEdit(job) {
  libraryEditingId = job.id;
  const entry = libraryEntry(job);
  $("library-edit-file").textContent = job.file.split(/[\\/]/).pop();
  $("library-edit-collection").value = entry.collection || "";
  $("library-edit-tags").value = (entry.tags || []).join(", ");
  $("library-edit-favorite").checked = !!entry.favorite;
  $("library-edit-dialog").showModal();
}
$("library-edit-close").addEventListener("click", () => $("library-edit-dialog").close());
$("library-edit-save").addEventListener("click", () => {
  const job = jobs.find(item => item.id === libraryEditingId);
  if (!job) return;
  libraryMeta[job.file] = {
    favorite:$("library-edit-favorite").checked,
    collection:$("library-edit-collection").value.trim().slice(0,40),
    tags:[...new Set($("library-edit-tags").value.split(",").map(value => value.trim().slice(0,30)).filter(Boolean))].slice(0,10)
  };
  saveLibraryMeta();
  $("library-edit-dialog").close();
  refreshCollections();
  renderMediaLibrary();
});
$("library-collection").addEventListener("change", renderMediaLibrary);
try { $("library-sort").value = localStorage.getItem("deviload-library-sort") || "new"; } catch { /* storage unavailable */ }
$("library-sort").addEventListener("change", () => {
  try { localStorage.setItem("deviload-library-sort", $("library-sort").value); } catch { /* storage unavailable */ }
  renderMediaLibrary();
});
// Files finished before sizes were recorded get measured once, the first time the library opens.
let libraryMeasured = false;
$("library-tab").addEventListener("click", async () => {
  if (libraryMeasured || !invoke) return;
  libraryMeasured = true;
  try { if (await invoke("measure_library")) await refresh(); } catch { libraryMeasured = false; }
});
refreshCollections();
let libraryKey = "";
function renderMediaLibrary() {
  const done = jobs.filter(inLibrary);
  $("media-library-total").textContent = String(done.length);
  $("clear-library").hidden = !done.length;
  const visible = done.filter(job => {
    if (mediaFilter === "audio" && !isLibraryAudio(job)) return false;
    if (mediaFilter === "video" && isLibraryAudio(job)) return false;
    const entry = libraryEntry(job);
    if (mediaFilter === "favorite" && !entry.favorite) return false;
    if ($("library-collection").value && entry.collection !== $("library-collection").value) return false;
    return [job.file, job.url, entry.collection, ...(entry.tags || [])].join(" ").toLocaleLowerCase().includes(mediaSearch);
  });
  const order = $("library-sort").value;
  const name = job => job.file.split(/[\\/]/).pop().toLocaleLowerCase();
  const compare = {new:(a, b) => b.id - a.id, old:(a, b) => a.id - b.id, size:(a, b) => (b.bytes || 0) - (a.bytes || 0),
    length:(a, b) => (b.duration || 0) - (a.duration || 0), name:(a, b) => name(a).localeCompare(name(b))}[order] || ((a, b) => b.id - a.id);
  visible.sort(compare);
  const total = done.reduce((sum, job) => sum + (job.bytes > 1 ? job.bytes : 0), 0);
  $("media-library-size").textContent = total ? t("Takes {size}.", {size:bigSizeText(total)}) : "";
  cinemaIds = visible.map(job => job.id);
  // The queue is polled every second; rebuilding unchanged cards resets hover and closes open menus.
  const key = JSON.stringify([t("More"), done.length, order, visible.map(job => [job.id, job.file, job.url, job.bytes, job.duration, libraryEntry(job)])]);
  if (key === libraryKey) return;
  libraryKey = key;
  const grid = $("media-library-grid");
  grid.replaceChildren();
  $("media-library-empty").hidden = visible.length > 0;
  $("media-library-empty-text").textContent = done.length ? t("Nothing matches your search.") : t("Files appear here once downloads finish.");
  setPose($("library-mascot"), done.length ? "look" : "front");
  for (const job of visible) {
    const card = node("article", "media-library-item");
    const art = node("div", "media-library-art");
    const preview = mediaPreview(job.url);
    if (preview) {
      const image = node("img"); image.src = preview; image.alt = ""; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.remove());
      art.append(image);
    }
    const type = node("span", "media-library-type", isLibraryAudio(job) ? t("AUDIO") : /\.gif$/i.test(job.file) ? "GIF" : t("VIDEO"));
    art.append(type);
    const info = node("div", "media-library-info");
    const name = node("h3", "", job.file.split(/[\\/]/).pop()); name.title = job.file;
    let source = job.url;
    try { source = new URL(job.url).hostname.replace(/^www\./, ""); } catch { /* Keep original source. */ }
    const facts = [job.duration > 0 ? lengthText(job.duration) : "", job.bytes > 1 ? bigSizeText(job.bytes) : ""].filter(Boolean);
    info.append(name, node("p", "", [source, ...facts].filter(Boolean).join(" · ")));
    const entry = libraryEntry(job);
    const tags = [entry.favorite ? "★" : "", entry.collection, ...(entry.tags || [])].filter(Boolean);
    if (tags.length) info.append(node("p", "library-tags", tags.join(" · ")));
    const buttons = node("div", "media-library-actions");
    addAction(buttons, t("Watch"), "quiet", () => openPlayer(job.id));
    addAction(buttons, t("To phone · QR"), "transfer-button", () => startShare(job.id), t("Open a QR code to send this file to a phone"), "phone-transfer");
    const more = node("details", "library-more");
    const moreActions = node("div", "library-more-actions");
    more.append(node("summary", "", t("More")), moreActions);
    addAction(moreActions, t("Organize"), "quiet", () => openLibraryEdit(job));
    addAction(moreActions, t("Show in folder"), "quiet", async () => {
      try { await invoke("reveal_download", {id:job.id}); }
      catch (error) { message(errorText(error), true); }
    }, "", "folder-open");
    addAction(moreActions, t("Convert"), "quiet", () => openConverter([job.file]), t("MP4, MP3, GIF or a smaller file"), "arrows-left-right");
    if (isAudioJob(job)) addAction(moreActions, t("Audio"), "quiet", () => openAudioTools(job.id));
    else if (isVideoJob(job)) addAction(moreActions, "Devil Cut", "quiet", () => devilCut.open(job.id), "", "scissors");
    addAction(moreActions, t("Remove from library"), "quiet", async () => {
      try { await invoke("remove_from_library", {id:job.id}); await refresh(); message(t("Removed from the library. The file stays on the disk.")); }
      catch (error) { message(errorText(error), true); }
    }, t("The file stays on the disk."), "trash");
    buttons.append(more);
    info.append(buttons);
    card.append(art, info);
    grid.append(card);
  }
}
$("clear-library").addEventListener("click", async () => {
  const ask = window.__TAURI__?.dialog?.ask;
  if (ask && !(await ask(t("Clear the library? The files stay on the disk, only the list is emptied."), {title:"Deviload", kind:"warning"}))) return;
  try { await invoke("clear_library"); await refresh(); message(t("The library is empty. The files stay on the disk.")); }
  catch (error) { message(errorText(error), true); }
});
$("find-duplicates").addEventListener("click", async () => {
  if (!invoke) return;
  const button = $("find-duplicates"), results = $("duplicate-results");
  button.disabled = true; results.hidden = false; results.replaceChildren(node("p", "", t("Comparing finished files byte by byte…")));
  try {
    const groups = await invoke("find_duplicates");
    results.replaceChildren();
    if (!groups.length) { results.append(node("p", "", t("The library has no identical files."))); return; }
    results.append(node("strong", "", t("Duplicate groups: {count}. No files are deleted.", {count:groups.length})));
    for (const group of groups) {
      const article = node("div", "duplicate-group");
      article.append(node("p", "", t("{count} files · {size} MB each", {count:group.files.length, size:(group.bytes / 1048576).toFixed(1)})));
      const list = node("ul");
      for (const file of group.files) list.append(node("li", "", file));
      article.append(list); results.append(article);
    }
  } catch (error) { results.replaceChildren(node("p", "", errorText(error))); }
  finally { button.disabled = false; }
});
function openMediaLibrary() {
  navigate("library");
  pop($("media-library-title"));
}
$("library-tab").addEventListener("click", openMediaLibrary);
$("media-library-search").addEventListener("input", event => { mediaSearch = event.target.value.toLocaleLowerCase().trim(); renderMediaLibrary(); });
for (const button of document.querySelectorAll("[data-media-filter]")) {
  button.addEventListener("click", () => {
    mediaFilter = button.dataset.mediaFilter;
    for (const peer of document.querySelectorAll("[data-media-filter]")) {
      peer.classList.toggle("selected", peer === button);
      peer.setAttribute("aria-pressed", String(peer === button));
    }
    renderMediaLibrary();
  });
}
window.addEventListener("scroll", () => document.documentElement.classList.toggle("is-scrolled", scrollY > 4), {passive:true});
if (invoke && navigator.userAgent.includes("Windows")) {
  const chrome = $("window-chrome");
  chrome.hidden = false;
  document.documentElement.classList.add("custom-window");
  const controls = {"window-minimize":"minimize","window-maximize":"toggle_maximize","window-close":"close"};
  for (const [id, action] of Object.entries(controls)) {
    $(id).addEventListener("click", () => invoke("window_action", {action}).catch(error => message(errorText(error), true)));
  }
  document.querySelector(".window-drag-strip")?.addEventListener("pointerdown", event => {
    if (event.button === 0) invoke("window_action", {action:"start_dragging"}).catch(() => {});
  });
  document.querySelector(".window-drag-strip")?.addEventListener("dblclick", () => invoke("window_action", {action:"toggle_maximize"}).catch(() => {}));
  const topbar = document.querySelector(".topbar");
  topbar.addEventListener("pointerdown", event => {
    if (event.button === 0 && event.target === topbar) invoke("window_action", {action:"start_dragging"}).catch(() => {});
  });
  topbar.addEventListener("dblclick", event => {
    if (event.target === topbar) invoke("window_action", {action:"toggle_maximize"}).catch(() => {});
  });
  // An open dialog covers the top bar; its header and the dimmed area around it move the window.
  document.addEventListener("pointerdown", event => {
    const dialog = event.button === 0 ? event.target.closest?.("dialog[open]") : null;
    if (!dialog) return;
    const box = dialog.getBoundingClientRect();
    const outside = event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
    const header = event.target.closest(".dialog-head") && !event.target.closest("button, input, select, textarea, a, summary, label");
    if (outside || header) invoke("window_action", {action:"start_dragging"}).catch(() => {});
  });
}
async function refresh() {
  if (!invoke) return;
  try { render(await invoke("snapshot")); }
  catch (error) { message(errorText(error), true); }
}
$("job-search").addEventListener("input", event => { search = event.target.value; render({jobs}); });
for (const [filter,[id]] of Object.entries(filters)) {
  $(id).addEventListener("click", () => {
    navigate("downloads");
    if (currentFilter === filter) { heroOrb.bump(); return; }
    currentFilter = filter;
    for (const [name,[buttonId]] of Object.entries(filters)) {
      $(buttonId).classList.toggle("selected", name === filter);
      $(buttonId).setAttribute("aria-pressed", String(name === filter));
    }
    taskOrbs.forEach(orb => orb.destroy());
    taskOrbs.clear();
    $("jobs").replaceChildren();
    render({jobs});
    pop($("queue-title"));
    if (!$("empty").hidden) pop($("empty"), 12);
  });
}
function buildDownloadRequest() {
  const mode = $("cookies-mode").value;
  const clipEnabled = $("clip-enabled").checked;
  const clipStart = clipEnabled ? parseClipTime($("clip-start").value) : null;
  const clipEnd = clipEnabled ? parseClipTime($("clip-end").value) : null;
  if (clipEnabled && (!Number.isFinite(clipStart) || !Number.isFinite(clipEnd) || clipEnd - clipStart < .1 || clipStart < 0)) throw new Error(t("Enter valid clip boundaries, for example from 00:30 to 01:15."));
  if (clipEnabled && $("clip-output").value === "gif" && (clipEnd - clipStart > 60 || ["mp3","flac","wav"].includes(quality))) throw new Error(t("GIF: pick video and a clip of up to 60 seconds."));
  const inputUrls = $("urls").value.trim().split(/\s+/).filter(Boolean);
  if (selectedFormat && (inputUrls.length !== 1 || inputUrls[0] !== selectedFormat.url)) {
    throw new Error(t("The selected stream belongs to one checked link. Check the link again or clear the choice."));
  }
  const options = {folder:$("folder").value.trim(),quality,profile:$("profile").value,playlist:$("playlist").checked,
    playlistItems:$("playlist").checked ? $("playlist-items").value.trim() : "",splitChapters:$("split-chapters").checked,
    subtitles:$("subtitles").checked,sponsorblock:$("sponsorblock").checked,
    archive:$("archive").checked,cookies:mode === "file" ? $("cookies").value.trim() : mode === "account" ? (signedInPath || "") : "",
    cookiesBrowser:["chrome","edge","firefox","brave","safari"].includes(mode) ? mode : "",rateMbps:Number($("rate").value),
    clipStart,clipEnd,clipFormat:clipEnabled ? $("clip-output").value : "source",
    folderRule:$("folder-rule").value,nameRule:$("name-rule").value,
    formatId:selectedFormat?.id || "",formatHasAudio:!!selectedFormat?.hasAudio};
  const startValue = $("start-at").value;
  const scheduledAt = startValue ? Math.floor(new Date(startValue).getTime() / 1000) : null;
  if (startValue && (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now() / 1000)) {
    throw new Error(t("Pick a time in the future."));
  }
  return {
    text:$("urls").value, options, parallel:Number($("parallel").value),
    scheduledAt, autoRetry:$("auto-retry").checked,
    estimatedBytes:selectedFormat?.bytes || null
  };
}
function showPreflight(report) {
  const panel = $("preflight-status");
  panel.replaceChildren();
  panel.hidden = false;
  panel.classList.toggle("blocked", !report.ready);
  const free = report.availableBytes === null ? t("unknown") : t("{size} GB", {size:(report.availableBytes / 1073741824).toFixed(1)});
  panel.append(node("strong", "", report.ready ? t("Ready to download · {free} free", {free}) : t("Needs fixes")));
  for (const item of [...report.blockers, ...report.warnings]) panel.append(node("p", "", translateMessage(item)));
}
async function preflightRequest(request) {
  const report = await invoke("preflight_download", {
    text:request.text, options:request.options, estimatedBytes:request.estimatedBytes
  });
  showPreflight(report);
  return report;
}
$("preflight").addEventListener("click", async () => {
  if (!invoke) { message(t("The check is available in the app."), true); return; }
  const button = $("preflight"); button.disabled = true;
  try {
    const report = await preflightRequest(buildDownloadRequest());
    message(report.ready ? t("Check passed.") : report.blockers.map(translateMessage).join(" "), !report.ready);
  } catch (error) { $("preflight-status").hidden = true; message(errorText(error), true); }
  finally { button.disabled = false; }
});
$("add").addEventListener("click", async () => {
  if (!invoke) { message(t("Open the installed Deviload app to download."), true); return; }
  if (!linkField.value.trim()) { linkField.focus(); message(t("Paste a link first."), true); return; }
  showDownloads();
  const button = $("add");
  button.disabled = true;
  button.classList.add("is-busy");
  try {
    const request = buildDownloadRequest();
    const report = await preflightRequest(request);
    if (!report.ready) { setDrawer(true); throw new Error(report.blockers.map(translateMessage).join(" ")); }
    const count = await invoke("enqueue", {
      text:request.text, options:request.options, parallel:request.parallel,
      scheduledAt:request.scheduledAt, autoRetry:request.autoRetry
    });
    message(count ? t("Tasks added: {count}", {count}) : t("These links are already in the queue."));
    if (count) {
      $("start-at").value = ""; selectedFormat = null; $("preflight-status").hidden = true;
      linkField.value = ""; linkField.dispatchEvent(new Event("input"));
    }
    await refresh();
  } catch (error) { message(errorText(error), true); }
  finally { button.disabled = false; button.classList.remove("is-busy"); }
});
$("clear").addEventListener("click", async () => {
  if (!invoke) return;
  try { await invoke("clear_finished"); await refresh(); message(t("Finished and cancelled tasks left the queue. Finished files stay in the library.")); }
  catch (error) { message(errorText(error), true); }
});
$("close-log").addEventListener("click", () => $("log-dialog").close());
// Log tools: the log itself and the exact yt-dlp call, for bug reports.
let logJobId = null;
async function copyText(text, done) {
  try {
    const writeText = window.__TAURI__?.clipboardManager?.writeText || navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (!writeText) throw new Error(t("The clipboard is unavailable"));
    await writeText(text);
    message(done);
  } catch (error) { message(errorText(error), true); }
}
$("copy-log").addEventListener("click", () => copyText($("log-content").textContent, t("Log copied")));
$("copy-command").addEventListener("click", async () => {
  if (!invoke || logJobId === null) return;
  try { await copyText(await invoke("job_command", {id:logJobId}), t("yt-dlp command copied")); }
  catch (error) { message(errorText(error), true); }
});
// A text file with links, for example a list saved from a browser.
$("load-links").addEventListener("click", async () => {
  const open = window.__TAURI__?.dialog?.open;
  if (!open || !invoke) return;
  try {
    const path = await open({multiple:false, directory:false, filters:[{name:t("Text files"), extensions:["txt", "csv", "m3u", "m3u8"]}]});
    if (typeof path !== "string" || !path) return;
    const text = await invoke("read_link_list", {path});
    const found = [...new Set(text.match(/https?:\/\/[^\s"'<>,;]+/gi) || [])].slice(0, 500);
    if (!found.length) { message(t("No links found in the file"), true); return; }
    addLinks(found.join(" "));
    message(tn("Loaded {count} link", "Loaded {count} links", found.length));
  } catch (error) { message(errorText(error), true); }
});
// Start with Windows, in the tray.
async function syncAutostart() {
  if (!invoke) return;
  try { $("autostart-toggle").setAttribute("aria-checked", String(await invoke("autostart_status"))); } catch { /* not available */ }
}
$("autostart-toggle").addEventListener("click", async () => {
  const next = $("autostart-toggle").getAttribute("aria-checked") !== "true";
  try {
    const enabled = await invoke("set_autostart", {enabled:next});
    $("autostart-toggle").setAttribute("aria-checked", String(enabled));
    if (enabled) {
      // In the tray, closing the window keeps Deviload running.
      if ($("tray-toggle").getAttribute("aria-checked") !== "true") $("tray-toggle").click();
    }
  } catch (error) { message(errorText(error), true); }
});
syncAutostart();
// Watched channels and playlists
let watches = [];
function agoText(seconds) {
  const minutes = Math.round((Date.now() / 1000 - seconds) / 60);
  const format = new Intl.RelativeTimeFormat(locale(), {numeric:"auto"});
  if (minutes < 60) return format.format(-Math.max(0, minutes), "minute");
  if (minutes < 48 * 60) return format.format(-Math.round(minutes / 60), "hour");
  return format.format(-Math.round(minutes / 1440), "day");
}
function renderWatches() {
  $("watch-count").textContent = String(watches.length);
  $("watch-count").hidden = !watches.length;
  const list = $("watch-list");
  list.replaceChildren(...watches.map(watch => {
    const row = node("div", "watch-item" + (watch.error ? " has-error" : ""));
    const text = node("div");
    text.append(node("strong", "", watch.title));
    text.title = watch.url;
    const quality = labelFor(watch.quality);
    const artist = watch.kind === "artist";
    const meta = [artist ? t("Artist") + " · " + quality : quality, watch.checkedAt ? t("checked {time}", {time:agoText(watch.checkedAt)}) : t("not checked yet"),
      artist ? tn("{count} album in the queue", "{count} albums in the queue", watch.queued) : tn("{count} new video downloaded", "{count} new videos downloaded", watch.queued)];
    text.append(node("small", "", meta.join(" · ")));
    if (watch.error) text.append(node("small", "watch-error", translateMessage(watch.error)));
    const check = node("button", "quiet small", t("Check now"));
    check.type = "button";
    check.addEventListener("click", async () => {
      check.disabled = true;
      check.classList.add("is-busy");
      try {
        setPose($("watch-mascot"), "working");
        const count = await invoke("watch_check", {id:watch.id});
        setPose($("watch-mascot"), count ? "victory" : "look", count ? "look" : null);
        if (artist) message(count ? tn("Queued {count} new album", "Queued {count} new albums", count) : t("No new albums"));
        else message(count ? tn("Queued {count} new video", "Queued {count} new videos", count) : t("No new videos"));
      } catch (error) { message(errorText(error), true); }
      finally { check.disabled = false; check.classList.remove("is-busy"); }
    });
    const remove = node("button", "quiet small icon-only");
    remove.type = "button";
    remove.setAttribute("aria-label", t("Stop watching"));
    remove.title = t("Stop watching");
    const icon = node("span", "icon");
    icon.dataset.icon = "trash";
    remove.append(icon);
    remove.addEventListener("click", () => invoke("watch_remove", {id:watch.id}).catch(error => message(errorText(error), true)));
    row.append(text, check, remove);
    return row;
  }));
}
async function refreshWatches() {
  if (!invoke) return;
  try { watches = await invoke("watch_list"); } catch { watches = []; }
  renderWatches();
}
function labelFor(value) {
  return {best:t("Best quality"), mp3:"MP3", flac:"FLAC", wav:"WAV"}[value] || (value + "p");
}
let watchMode = "list";
function setWatchMode(mode) {
  watchMode = mode;
  for (const button of document.querySelectorAll("[data-watch-mode]")) {
    button.classList.toggle("selected", button.dataset.watchMode === mode);
    button.setAttribute("aria-pressed", String(button.dataset.watchMode === mode));
  }
  const artist = mode === "artist";
  $("watch-help-list").hidden = artist;
  $("watch-help-artist").hidden = !artist;
  $("watch-backfill-row").hidden = !artist;
  const label = t(artist ? "Artist channel link" : "Channel or playlist link");
  $("watch-url").placeholder = label;
  $("watch-url").setAttribute("aria-label", label);
}
for (const button of document.querySelectorAll("[data-watch-mode]")) button.addEventListener("click", () => setWatchMode(button.dataset.watchMode));
onLanguageChange(() => setWatchMode(watchMode));
async function addWatch(address, button, artist = false) {
  if (!invoke) return;
  let options;
  try { options = buildDownloadRequest().options; } catch (error) { message(errorText(error), true); return; }
  button.disabled = true;
  button.classList.add("is-busy");
  try {
    const watch = await invoke("watch_add", {url:address, options, artist, backfill:artist && $("watch-backfill").checked});
    if (artist) message(watch.queued
      ? tn("Following {title}: {count} album is in the queue.", "Following {title}: {count} albums are in the queue.", watch.queued, {title:watch.title})
      : t("Following {title}. New albums will download by themselves.", {title:watch.title}));
    else message(t("Watching “{title}”. New videos will download by themselves.", {title:watch.title}));
    await refreshWatches();
    return watch;
  } catch (error) { message(errorText(error), true); }
  finally { button.disabled = false; button.classList.remove("is-busy"); }
}
$("watch-open").addEventListener("click", () => { refreshWatches(); $("watch-dialog").showModal(); });
$("watch-close").addEventListener("click", () => $("watch-dialog").close());
$("watch-add").addEventListener("click", async () => {
  const address = $("watch-url").value.trim();
  if (!address) { $("watch-url").focus(); return; }
  if (await addWatch(address, $("watch-add"), watchMode === "artist")) $("watch-url").value = "";
});
$("watch-url").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); $("watch-add").click(); } });
window.__TAURI__?.event?.listen?.("watches-changed", refreshWatches);
window.__TAURI__?.event?.listen?.("watch-found", event => {
  const {title, count, artist} = event.payload || {};
  const text = artist
    ? tn("{count} new album by {title} is in the queue", "{count} new albums by {title} are in the queue", count, {title})
    : tn("{count} new video from “{title}” is in the queue", "{count} new videos from “{title}” are in the queue", count, {title});
  message(text);
  systemNotice(t(artist ? "New albums" : "New videos"), text);
  brandMascot.celebrate();
  setPose($("watch-mascot"), "victory", "look");
});
onLanguageChange(renderWatches);
setQuality("1080");
async function init() {
  if (!invoke) { $("engines").textContent = ""; $("add").disabled = true; return; }
  try {
    const data = await invoke("snapshot"), options = data.options;
    $("folder").value = data.defaultFolder || options.folder;
    showDefaultFolder(data.defaultFolder);
    $("profile").value = options.profile || "custom";
    signedInPath = await invoke("youtube_login_status");
    const modes = [...$("cookies-mode").options].map(option => option.value);
    let savedMode = null;
    try { savedMode = localStorage.getItem("deviload-cookies-mode"); } catch { savedMode = null; }
    $("cookies-mode").value = modes.includes(savedMode) ? savedMode
      : options.cookiesBrowser && modes.includes(options.cookiesBrowser) ? options.cookiesBrowser
      : options.cookies && options.cookies !== signedInPath ? "file" : "account";
    $("cookies").value = options.cookies && options.cookies !== signedInPath ? options.cookies : "";
    $("playlist-items").value = options.playlistItems || "";
    $("split-chapters").checked = !!options.splitChapters;
    $("rate").value = options.rateMbps;
    $("parallel").value = data.parallel;
    $("folder-rule").value = options.folderRule || "manual";
    $("name-rule").value = options.nameRule || "title";
    syncNameRule();
    showMediaServer(data.mediaServer);
    $("clip-enabled").checked = Number.isFinite(options.clipStart) && Number.isFinite(options.clipEnd);
    if ($("clip-enabled").checked) { $("clip-start").value = String(options.clipStart); $("clip-end").value = String(options.clipEnd); }
    $("clip-output").value = options.clipFormat || "source";
    syncClip();
    for (const key of ["playlist","subtitles","sponsorblock","archive"]) $(key).checked = options[key];
    syncPlaylist(); renderAccount(); syncOptionsSummary();
    try { setDrawer(localStorage.getItem("deviload-drawer") === "open"); } catch { setDrawer(false); }
    folderPaths = Object.fromEntries((await invoke("common_folders")) || []);
    await loadStore();
    refreshCollections();
    setQuality(options.quality);
    render(data);
    refreshEngineInfo();
    checkLegacy();
    refreshWatches();
    setTimeout(() => checkAppUpdate(), 4000);
    setTimeout(autoUpdateYtdlp, 20000);
    window.__TAURI__?.app?.getVersion?.().then(version => { appVersion = version; $("app-version").textContent = "Deviload " + version; }).catch(() => {});
    await invoke("set_close_to_tray", {enabled:localStorage.getItem("deviload-tray") === "true"});
    const deps = await invoke("diagnostics");
    missingComponents = deps.filter(([,ok]) => !ok).map(([name]) => name);
    renderEngines();
    const mac = navigator.userAgent.includes("Mac");
    if (missingComponents.length) message(t(mac
      ? "Components are missing. On a Mac run: brew install yt-dlp ffmpeg deno"
      : "Components are missing. Put yt-dlp, ffmpeg, ffprobe and deno into the bin folder next to Deviload."), true);
  } catch (error) { message(errorText(error), true); }
  const poll = async () => { await refresh(); setTimeout(poll, 900); };
  setTimeout(poll, 900);
}
function syncLanguageButtons() {
  for (const code of ["ru", "en"]) {
    const button = $("lang-" + code), active = language() === code;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}
function syncTrayLabels() {
  invoke?.("set_tray_labels", {open:t("Open Deviload"), quit:t("Quit Deviload")}).catch(() => {});
}
for (const id of ["lang-ru", "lang-en"]) $(id).addEventListener("click", () => setLanguage(language() === "ru" ? "en" : "ru"));
onLanguageChange(() => {
  syncLanguageButtons(); syncTitle(); syncSystemPreferences(); syncClipboardToggle(); syncAuth(); syncFormatHint();
  clearToasts();
  renderAccount(); renderEngineInfo(); syncOptionsSummary();
  if (inspectedInfo && inspectedAddress) renderInspect(inspectedInfo, inspectedAddress);
  else if (linksIn(linkField.value).length > 1) renderLinkCount(linksIn(linkField.value).length);
  renderEngines(); syncTrayLabels();
  if ($("notice-dialog").open) renderNotices();
  taskOrbs.forEach(orb => orb.destroy());
  taskOrbs.clear();
  $("jobs").replaceChildren();
  render({jobs});
  refreshCollections();
  devilCut.relabel();
});
translateDom();
syncLanguageButtons();
syncTitle();
syncTrayLabels();
init();
wireTour(navigate);


// Phone link: one QR code, files both ways and links into the queue.
let phoneOn = false, phoneUrl = "", phoneTimer = 0, phoneQrFor = "", phoneShown = "";
function syncPhoneButton() { $("phone-open").classList.toggle("is-live", phoneOn); }
function phoneRow(title, detail, share = null) {
  const row = node("div", "phone-item");
  const text = node("div");
  text.append(node("strong", "", title), node("small", "", detail));
  if (share !== null) {
    const bar = node("div", "share-progress");
    const fill = node("span");
    fill.style.width = `${Math.round(share * 100)}%`;
    bar.append(fill);
    text.append(bar);
  }
  row.append(text);
  return row;
}
function renderPhone(status) {
  const signature = JSON.stringify(status) + language();
  if (signature === phoneShown) return;
  phoneShown = signature;
  $("share-name").textContent = !status ? t("The phone link is off.")
    : status.connected ? t("Connected: {device}", {device:status.device}) : t("Waiting for the phone…");
  const busy = status && (status.offers.some(offer => offer.state === "receiving") || status.files.some(file => file.sent > 0 && !file.done));
  const finished = status && (status.offers.some(offer => offer.state === "done") || status.files.some(file => file.done));
  const phase = busy ? "sending" : finished ? "complete" : "waiting";
  if ($("share-dialog").dataset.phase !== phase) {
    $("share-dialog").dataset.phase = phase;
    if (phase === "sending") { brandMascot.setActivity("sending"); brandMascot.reactSending(); }
    if (phase === "complete") { brandMascot.setActivity("share"); brandMascot.reactTransferDone(); }
  }
  const offers = $("phone-offers");
  offers.replaceChildren();
  if (status?.offers.length) offers.append(node("h3", "", t("From the phone")));
  for (const offer of status?.offers || []) {
    const labels = {waiting:t("Wants to send · {size}", {size:sizeText(offer.size)}), accepted:t("Starting…"), declined:t("Declined"),
      receiving:t("Receiving · {percent}%", {percent:Math.round(offer.received / offer.size * 100)}), done:t("Saved to the library"), failed:t("Failed")};
    const row = phoneRow(offer.name, `${offer.device || t("Phone")} · ${labels[offer.state]}`, offer.state === "receiving" ? offer.received / offer.size : null);
    if (offer.state === "waiting") {
      const accept = node("button", "primary small", t("Accept"));
      const decline = node("button", "quiet small", t("Decline"));
      accept.type = decline.type = "button";
      accept.addEventListener("click", () => invoke("phone_answer", {id:offer.id, accept:true}).then(pollPhone).catch(error => message(errorText(error), true)));
      decline.addEventListener("click", () => invoke("phone_answer", {id:offer.id, accept:false}).then(pollPhone).catch(error => message(errorText(error), true)));
      row.append(accept, decline);
    }
    offers.append(row);
  }
  const files = $("phone-files");
  files.replaceChildren();
  if (status?.files.length) files.append(node("h3", "", t("Sent to the phone")));
  for (const file of status?.files || []) {
    const state = file.done ? t("On the phone") : file.sent > 0 ? t("Downloading · {percent}%", {percent:Math.round(file.sent / file.size * 100)}) : t("Ready on the phone page");
    files.append(phoneRow(file.name, `${sizeText(file.size)} · ${state}`, file.sent > 0 && !file.done ? file.sent / file.size : null));
  }
}
async function pollPhone() {
  clearTimeout(phoneTimer);
  if (!invoke || !phoneOn) return;
  let status = null;
  try { status = await invoke("phone_status"); } catch { status = null; }
  if (!status) { phoneOn = false; syncPhoneButton(); renderPhone(null); return; }
  renderPhone(status);
  phoneTimer = setTimeout(pollPhone, $("share-dialog").open ? 700 : 4000);
}
function phonePageText() {
  return {lang:language(), strings:{heading:t("Phone link"), fromComputer:t("From the computer"),
    nothingYet:t("Nothing yet. In Deviload press “To phone” next to a file."), download:t("Save to phone"), open:t("Open"),
    toComputer:t("To the computer"), sendFiles:t("Send files"), waiting:t("Waiting for the computer to accept"),
    accepted:t("Starting…"), declined:t("Declined on the computer"), sending:t("Sending"), sent:t("Sent"), failed:t("Failed"),
    linkTitle:t("Download by link"), linkPlaceholder:t("Paste a video link"), linkButton:t("Add to downloads"),
    linkAdded:t("Added to the downloads on the computer"), homeHint:t("Add this page to the home screen to open it in one tap."),
    kilobytes:t("{size} KB"), megabytes:t("{size} MB"), offline:t("The computer does not answer. Deviload must be open with the phone link on.")}};
}
async function openPhone(sendId = null) {
  if (!invoke) { message(t("Sending to a phone is available in the Deviload app."), true); return; }
  const dialog = $("share-dialog");
  if (!dialog.open) dialog.showModal();
  brandMascot.setActivity("share"); brandMascot.reactShare();
  if (!phoneOn) $("share-status").textContent = t("Looking for the local network…");
  try {
    const link = sendId === null ? await invoke("phone_start", {page:phonePageText()}) : await invoke("phone_send", {id:sendId, page:phonePageText()});
    phoneOn = true;
    phoneUrl = link.url;
    syncPhoneButton();
    if (phoneQrFor !== link.url) {
      if (!window.QRCode) throw new Error(t("The QR code generator is unavailable"));
      $("share-qr").replaceChildren();
      new window.QRCode($("share-qr"), {text:link.url, width:230, height:230, colorDark:"#14191e", colorLight:"#ffffff", correctLevel:window.QRCode.CorrectLevel.M});
      phoneQrFor = link.url;
    }
    $("share-url").textContent = link.url;
    $("share-url").href = link.url;
    $("share-status").textContent = t("The link turns off by itself after 30 minutes without the phone, or when you close Deviload.");
    $("share-network-warning").hidden = !link.publicNetwork;
    $("share-network-warning").textContent = link.publicNetwork ? t("This Windows network is marked as public. The firewall may block the phone from the QR link. For a home network switch the profile to “Private” and allow Deviload on local networks.") : "";
    $("share-network-settings").hidden = !link.publicNetwork;
    phoneShown = "";
    pollPhone();
  } catch (error) {
    $("share-status").textContent = errorText(error);
  }
}
function startShare(id) { return openPhone(id); }
$("phone-open").addEventListener("click", () => openPhone());
$("share-close").addEventListener("click", () => $("share-dialog").close());
$("share-dialog").addEventListener("close", () => { brandMascot.setActivity($("player-dialog").open ? "cinema" : "idle"); pollPhone(); });
$("phone-stop").addEventListener("click", async () => {
  await invoke?.("phone_stop").catch(() => {});
  phoneOn = false; phoneQrFor = "";
  $("share-qr").replaceChildren();
  $("share-url").textContent = "";
  $("share-status").textContent = t("The phone link is off. The phone page stops working until you turn it on again.");
  syncPhoneButton();
  renderPhone(null);
});
$("phone-forget").addEventListener("click", async () => {
  const ask = window.__TAURI__?.dialog?.ask;
  if (ask && !(await ask(t("Make a new link? The old QR code, bookmark and home-screen icon on the phone will stop working."), {title:"Deviload", kind:"warning"}))) return;
  try {
    await invoke("phone_forget");
    phoneOn = false; phoneQrFor = "";
    await openPhone();
  } catch (error) { message(errorText(error), true); }
});
window.__TAURI__?.event?.listen?.("phone-offer", event => {
  const {name = "", device = ""} = event.payload || {};
  if (!$("share-dialog").open) $("share-dialog").showModal();
  phoneShown = "";
  pollPhone();
  systemNotice(t("File from the phone"), t("{device} wants to send {name}", {device:device || t("Phone"), name}));
});
window.__TAURI__?.event?.listen?.("phone-received", event => {
  message(t("Received from the phone: {name}", {name:event.payload?.name || ""}));
  refresh();
});
window.__TAURI__?.event?.listen?.("phone-stopped", () => {
  phoneOn = false; phoneQrFor = "";
  $("share-qr").replaceChildren();
  $("share-url").textContent = "";
  $("share-status").textContent = t("The phone link turned itself off after 30 minutes without the phone.");
  syncPhoneButton();
  renderPhone(null);
});
window.__TAURI__?.event?.listen?.("phone-link", () => {
  message(t("The phone added a link to the downloads"));
  refresh();
});
onLanguageChange(() => { phoneShown = ""; if (phoneOn) { invoke?.("phone_start", {page:phonePageText()}).catch(() => {}); pollPhone(); } });
$("share-network-settings").addEventListener("click", async () => {
  try { await invoke("open_network_settings"); }
  catch (error) { $("share-status").textContent = t("Could not open the network settings: {error}", {error:errorText(error)}); }
});
$("share-copy").addEventListener("click", async () => {
  if (!phoneUrl || !phoneOn) return;
  try {
    const writeText = window.__TAURI__?.clipboardManager?.writeText || navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (!writeText) throw new Error(t("The clipboard is unavailable"));
    await writeText(phoneUrl);
    $("share-status").textContent = t("Link copied. It only works in your local network.");
  } catch (error) { $("share-status").textContent = t("Could not copy the link: {error}", {error:errorText(error)}); }
});
