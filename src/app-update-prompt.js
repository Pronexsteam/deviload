// Scheduling only. The existing signed native updater owns checking, downloading
// and installation; no release URLs or installer bytes are handled here.
export const APP_UPDATE_INTERVAL = 60 * 60 * 1000;
export const APP_UPDATE_RETRY = 15 * 60 * 1000;
export const APP_UPDATE_SNOOZE = 6 * 60 * 60 * 1000;
const LATER_KEY = "deviload-update-later";
let sessionLater = null;

export function isAppUpdateDismissed(storage, version, now = Date.now()) {
  if (!version) return false;
  if (sessionLater?.version === version && sessionLater.until > now) return true;
  try {
    const later = JSON.parse(storage?.getItem(LATER_KEY) || "null");
    return later?.version === version && Number.isFinite(later.until) && later.until > now;
  } catch { return false; }
}

export function dismissAppUpdate(storage, version, now = Date.now()) {
  if (!version) return;
  sessionLater = {version,until:now + APP_UPDATE_SNOOZE};
  try { storage?.setItem(LATER_KEY, JSON.stringify(sessionLater)); } catch { /* The session dismissal still works. */ }
}

export function clearAppUpdateDismissal(storage) {
  sessionLater = null;
  try { storage?.removeItem(LATER_KEY); } catch { /* Read-only storage must not prevent manual checks. */ }
}

export function updateDownloadProgress(value) {
  const numeric = Number(value), share = Number.isFinite(numeric) ? Math.min(1,Math.max(0,numeric)) : 0;
  return {percent:Math.round(share * 100),phase:share >= 1 ? "installing" : "downloading"};
}

export function createAppUpdateScheduler({check:onCheck,onUpdate = () => {},onError = () => {},onState = () => {},
  now = Date.now,interval = APP_UPDATE_INTERVAL,retry = APP_UPDATE_RETRY} = {}) {
  if (typeof onCheck !== "function") throw new TypeError("An update check function is required");
  let pending = null, available = null, nextCheck = 0, installing = false, dispose = null;
  const snapshot = () => ({checking:Boolean(pending),installing,nextCheck,available});
  const notify = () => onState(snapshot());
  function check({manual = false} = {}) {
    // Never replace the native PendingUpdate handle while it is being used.
    if (installing) return Promise.resolve(available);
    if (pending) return pending;
    if (!manual && now() < nextCheck) return Promise.resolve(available);
    pending = Promise.resolve().then(onCheck).then(update => {
      available = update || null;
      nextCheck = now() + interval;
      onUpdate(available);
      return available;
    },error => {
      nextCheck = now() + retry;
      throw error;
    }).finally(() => { pending = null; notify(); });
    notify();
    return pending;
  }
  async function holdInstall() {
    if (installing) return false;
    installing = true;
    notify();
    // A focus check might already be in flight when the user clicks Update.
    // Reserve the gate first, then wait so its result is the handle installed.
    if (pending) { try { await pending; } catch { /* An older valid handle may remain. */ } }
    return true;
  }
  function releaseInstall({recheck = false} = {}) {
    installing = false;
    // Failed download/install consumed the native handle: refresh before retry.
    if (recheck) nextCheck = 0;
    notify();
  }
  function start({window:host = globalThis.window,document:page = globalThis.document,
    timers = globalThis,startupDelay = 4000} = {}) {
    if (dispose) return dispose;
    const automatic = () => { if (page?.visibilityState !== "hidden") check().catch(onError); };
    const visible = () => { if (page?.visibilityState === "visible") automatic(); };
    const startup = timers.setTimeout(automatic,startupDelay);
    // A light local timer also allows a failed request to retry after 15 minutes.
    const repeating = timers.setInterval(automatic,60_000);
    host?.addEventListener("focus",automatic);
    host?.addEventListener("online",automatic);
    page?.addEventListener("visibilitychange",visible);
    dispose = () => {
      timers.clearTimeout(startup);timers.clearInterval(repeating);
      host?.removeEventListener("focus",automatic);host?.removeEventListener("online",automatic);
      page?.removeEventListener("visibilitychange",visible);dispose = null;
    };
    return dispose;
  }
  return {check,holdInstall,releaseInstall,start,get state(){return snapshot();}};
}
