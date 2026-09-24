// Entry point of the Devil Cut window.
import {hydrateMascots} from "./mascot-spot.js";
import {t, errorText, translateDom, setLanguage, onLanguageChange} from "./i18n.js";
import {mediaPreview, isVideoJob, isLibraryAudio} from "./view-model.js";
import {createDevilCut} from "./devil-cut.js";

const invoke = window.__TAURI__?.core?.invoke;
const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
let jobs = [], jobsSignature = "";

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function message(value, error = false) {
  if (!value) return;
  const box = document.getElementById("toasts");
  const toast = node("div", "toast" + (error ? " error" : ""));
  toast.setAttribute("role", error ? "alert" : "status");
  const icon = node("span", "icon");
  icon.dataset.icon = error ? "warning-circle" : "check-circle";
  icon.setAttribute("aria-hidden", "true");
  const close = node("button", "toast-close");
  close.type = "button";
  close.setAttribute("aria-label", t("Close"));
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
  close.addEventListener("click", () => toast.remove());
  toast.append(icon, node("p", "", value), close);
  box.append(toast);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => toast.remove(), error ? 9000 : 4500);
}

const editor = createDevilCut({
  invoke, convertFileSrc, t, message, node, errorText, mediaPreview, isVideoJob, isLibraryAudio,
  getJobs:() => jobs,
  saveProject:(id, project) => invoke("save_ui_project", {id, project}),
  loadProjects:async () => (await invoke("ui_store")).projects || {},
});

async function refreshJobs() {
  try {
    jobs = (await invoke("snapshot")).jobs || [];
    const signature = jobs.filter(job => job.status === "done").map(job => job.id + ":" + job.file).join("|");
    if (signature !== jobsSignature) { jobsSignature = signature; editor.refresh(); }
  } catch { /* the next poll retries */ }
}

function handle(query) {
  const params = new URLSearchParams(query);
  if (params.has("job")) return editor.open(Number(params.get("job")));
  if (params.has("project")) return editor.openProject(params.get("project"));
  return editor.open();
}

translateDom();
onLanguageChange(() => editor.relabel());
// The main window stores the language; follow it when it changes there.
window.addEventListener("storage", event => { if (event.key === "deviload-lang" && event.newValue) setLanguage(event.newValue); });

if (invoke) {
  await refreshJobs();
  await handle(location.search);
  setInterval(refreshJobs, 3000);
  window.__TAURI__.event.listen("devilcut-open", event => handle(String(event.payload)));
}
hydrateMascots();
