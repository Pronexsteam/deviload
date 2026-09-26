// One export folder for Devil Cut and the converter. It lives in this app's storage, so both
// windows show the same choice; empty means each result goes next to its source file.
const KEY = "deviload-export-folder";

export function exportFolder() {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}

function setExportFolder(path) {
  try { if (path) localStorage.setItem(KEY, path); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

// Wires a "Save to" row: the folder's name, a Choose button and a reset back to the source's folder.
// Returns the function that redraws the row, for a language change.
export function bindExportFolder({name, pick, reset}, t) {
  const show = () => {
    const folder = exportFolder();
    name.textContent = folder || t("Next to the source file");
    name.title = folder;
    reset.hidden = !folder;
  };
  pick.addEventListener("click", async () => {
    const open = window.__TAURI__?.dialog?.open;
    if (!open) return;
    const folder = await open({directory:true, multiple:false, defaultPath:exportFolder() || undefined, title:t("Where to save the results")}).catch(() => null);
    if (typeof folder === "string" && folder) { setExportFolder(folder); show(); }
  });
  reset.addEventListener("click", () => { setExportFolder(""); show(); });
  window.addEventListener("storage", event => { if (event.key === KEY) show(); });
  show();
  return show;
}
