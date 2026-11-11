import { t, onLanguageChange } from "./i18n.js";

// The person's own sign-ins, side by side in music settings: YouTube and Spotify, each with its logo, its state and
// a sign-in button in its own colours. Both stay on this computer: listening rooms, the phone remote, settings
// backups and diagnostics never receive them.
// YouTube is the sign-in downloads use too; music turns to it only when YouTube limits or refuses guest playback,
// and it reads your YouTube Music library for import. Spotify is used only to read your library for import.
export const ACCOUNTS = [
  {
    key: "youtube",
    brand: "youtubemusic",
    // A one-colour mark: drawn in YouTube red rather than black.
    tint: true,
    name: "YouTube Music",
    status: "youtube_login_status",
    signIn: ["open_youtube", { signIn: true }],
    signOut: "youtube_sign_out",
    event: "youtube-session",
    on: () => t("Signed in. Helps when YouTube limits playback, and brings your library over."),
    off: () => t("Not signed in. Needed to bring your library over and when YouTube limits playback."),
    button: () => t("Sign in with YouTube"),
  },
  {
    key: "spotify",
    brand: "spotify",
    name: "Spotify",
    status: "spotify_account_status",
    signIn: ["spotify_sign_in", {}],
    signOut: "spotify_sign_out",
    event: "spotify-session",
    on: () => t("Signed in. Used only to bring your Liked Songs and playlists over."),
    off: () =>
      t("Not signed in. Needed to bring your Liked Songs and playlists over, private ones included."),
    button: () => t("Sign in with Spotify"),
  },
];

// `addons` holds extra controls for an account, shown under it while it is signed in.
export function wireMusicAccount({
  invoke,
  host,
  before = null,
  listen = window.__TAURI__?.event?.listen,
  addons = {},
}) {
  const box = document.createElement("div"),
    title = document.createElement("strong"),
    note = document.createElement("small");
  box.className = "music-catalog-context music-accounts";
  title.className = "music-accounts-title";
  note.className = "music-accounts-note";
  box.append(title);
  const rows = ACCOUNTS.map(account => {
    const row = document.createElement("div"),
      logo = document.createElement(account.tint ? "span" : "img"),
      copy = document.createElement("div"),
      name = document.createElement("span"),
      state = document.createElement("small"),
      button = document.createElement("button");
    const view = { account, signedIn: false, busy: false, state, button, row };
    row.className = "music-account-row";
    row.dataset.account = account.key;
    if (account.tint) logo.setAttribute("aria-hidden", "true");
    else {
      logo.src = `assets/brands/${account.brand}.svg`;
      logo.alt = "";
    }
    logo.className = `music-account-logo music-account-logo-${account.key}`;
    name.className = "music-account-name";
    name.textContent = account.name;
    copy.className = "music-account-copy";
    copy.append(name, state);
    if (addons[account.key]) copy.append(addons[account.key]);
    button.type = "button";
    row.append(logo, copy, button);
    box.append(row);
    button.addEventListener("click", async () => {
      if (view.busy) return;
      view.busy = true;
      render(view);
      try {
        if (view.signedIn) {
          await invoke(account.signOut);
          view.signedIn = false;
        } else await invoke(...account.signIn);
      } catch {
        /* The sign-in window reports its own problems. */
      } finally {
        view.busy = false;
        render(view);
      }
    });
    listen?.(account.event, () => refresh(view));
    return view;
  });
  box.append(note);
  host?.insertBefore(box, before);

  function render(view) {
    const { account, signedIn, busy, state, button, row } = view;
    row.dataset.signedIn = String(signedIn);
    state.textContent = signedIn ? account.on() : account.off();
    // Signed out: the service's own sign-in button. Signed in: a quiet Sign out.
    button.className = signedIn
      ? "outline small music-account-out"
      : `music-account-in music-account-in-${account.key}`;
    button.textContent = signedIn ? t("Sign out") : account.button();
    button.disabled = busy;
  }
  async function refresh(view) {
    try {
      view.signedIn = !!(await invoke(view.account.status));
    } catch {
      /* Without the status the row keeps its last state. */
    }
    render(view);
  }
  function renderAll() {
    title.textContent = t("Accounts");
    note.textContent = t("Sign-ins stay on this computer and are never shared.");
    rows.forEach(render);
  }
  renderAll();
  rows.forEach(refresh);
  onLanguageChange(renderAll);
  return { refresh: () => Promise.all(rows.map(refresh)) };
}
