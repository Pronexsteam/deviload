import { t, errorText, onLanguageChange } from "./i18n.js";

// The local control API for the person's own tools: stream overlays, Stream Deck buttons, scripts. It listens on
// this computer only, stays off until turned on here, and every request carries the token shown in this row.
export const CONTROL_API_EVENT = "music-control-api";
let running = false;
// Whether the API is on, for players set up after this row has announced it.
export const controlApiRunning = () => running;

export function controlApiExample(status) {
  return `curl -X POST -H "Authorization: Bearer ${status.token}" ${status.url}/next`;
}

// The page an OBS browser source shows: the song playing, on a transparent background.
export function controlApiOverlay(status) {
  return `${String(status.url).replace(/\/api\/v1$/, "")}/overlay?token=${status.token}`;
}

export function wireMusicControlApi({
  invoke,
  host,
  before = null,
  notify = () => {},
  clipboard = navigator.clipboard,
}) {
  let status = { enabled: false, running: false, url: "", token: "", error: null },
    busy = false;
  const box = document.createElement("div"),
    copy = document.createElement("div"),
    text = document.createElement("span"),
    note = document.createElement("small"),
    address = document.createElement("code"),
    actions = document.createElement("div"),
    toggle = document.createElement("button"),
    copyButton = document.createElement("button"),
    overlayButton = document.createElement("button"),
    renew = document.createElement("button");
  box.className = "music-catalog-context music-control-api";
  actions.className = "music-control-api-actions";
  for (const button of [toggle, copyButton, overlayButton, renew]) {
    button.type = "button";
    button.className = "outline small";
  }
  copy.append(text, note, address);
  actions.append(overlayButton, copyButton, renew, toggle);
  box.append(copy, actions);
  host?.insertBefore(box, before);
  const announce = () => {
    running = !!status.running;
    // Read by players set up after this row, without importing it.
    if (document.documentElement.dataset) document.documentElement.dataset.controlApi = running ? "on" : "";
    document.dispatchEvent(new CustomEvent(CONTROL_API_EVENT, { detail: running }));
  };
  function render() {
    text.textContent = status.running
      ? t("Local control API: on")
      : status.enabled && status.error
        ? t("Local control API: {error}", { error: errorText(status.error) })
        : t("Local control API: off");
    note.textContent = t(
      "For stream overlays, Stream Deck and scripts on this computer. Nothing outside it can connect.",
    );
    address.textContent = status.running ? status.url : "";
    address.hidden = !status.running;
    copyButton.hidden = overlayButton.hidden = renew.hidden = !status.running;
    copyButton.textContent = t("Copy example");
    overlayButton.textContent = t("Copy OBS link");
    overlayButton.title = t(
      "Add it in OBS as a Browser source: the song playing, on a transparent background.",
    );
    renew.textContent = t("New token");
    toggle.textContent = status.enabled ? t("Turn off") : t("Turn on");
    for (const button of [toggle, copyButton, overlayButton, renew]) button.disabled = busy;
  }
  async function apply(request) {
    if (busy) return;
    busy = true;
    render();
    try {
      status = await request();
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      busy = false;
      render();
      announce();
    }
  }
  async function refresh() {
    try {
      status = await invoke("music_control_api_status");
    } catch {
      /* Without the status the row stays off. */
    }
    render();
    announce();
  }
  toggle.addEventListener("click", () =>
    apply(() => invoke("music_control_api_set", { enabled: !status.enabled })),
  );
  renew.addEventListener("click", () =>
    apply(() => invoke("music_control_api_set", { enabled: true, renew: true })),
  );
  copyButton.addEventListener("click", async () => {
    try {
      await clipboard.writeText(controlApiExample(status));
      notify(t("Copied with the token. Keep it private."));
    } catch (error) {
      notify(errorText(error), true);
    }
  });
  overlayButton.addEventListener("click", async () => {
    try {
      await clipboard.writeText(controlApiOverlay(status));
      notify(t("OBS link copied. It holds the token; keep it private."));
    } catch (error) {
      notify(errorText(error), true);
    }
  });
  render();
  refresh();
  onLanguageChange(render);
  return {
    refresh,
    get status() {
      return status;
    },
  };
}
