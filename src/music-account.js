import { t, onLanguageChange } from "./i18n.js";

// The person's own YouTube sign-in, the same one downloads use. Music turns to it only when YouTube limits or
// refuses guest playback. It stays on this computer: listening rooms, the phone remote, settings backups and
// diagnostics never receive it.
export function wireMusicAccount({ invoke, host, before = null, listen = window.__TAURI__?.event?.listen }) {
  let signedIn = false,
    busy = false;
  const box = document.createElement("div"),
    copy = document.createElement("div"),
    text = document.createElement("span"),
    note = document.createElement("small"),
    button = document.createElement("button");
  box.className = "music-catalog-context music-account";
  button.type = "button";
  button.className = "outline small";
  copy.append(text, note);
  box.append(copy, button);
  host?.insertBefore(box, before);
  function render() {
    text.textContent = signedIn ? t("YouTube account: signed in") : t("YouTube account: not signed in");
    note.textContent = t(
      "Used only when YouTube limits or refuses guest playback. It stays on this computer and is never shared.",
    );
    button.textContent = signedIn ? t("Sign out") : t("Sign in");
    button.disabled = busy;
  }
  async function refresh() {
    try {
      signedIn = !!(await invoke("youtube_login_status"));
    } catch {
      /* Without the status the row keeps its last state. */
    }
    render();
  }
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    render();
    try {
      if (signedIn) {
        await invoke("youtube_sign_out");
        signedIn = false;
      } else await invoke("open_youtube", { signIn: true });
    } catch {
      /* The sign-in window reports its own problems. */
    } finally {
      busy = false;
      render();
    }
  });
  listen?.("youtube-session", () => refresh());
  render();
  refresh();
  onLanguageChange(render);
  return { refresh };
}
