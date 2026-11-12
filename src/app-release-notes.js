import { t, onLanguageChange } from "./i18n.js";
import {
  shouldShowReleaseNotes,
  markReleaseNotesSeen,
  lastSeenReleaseNotes,
  compareVersions,
} from "./release-notes-state.js";
const instances = new WeakMap();
export function wireReleaseNotes(workspace) {
  if (instances.has(workspace)) return instances.get(workspace);
  const actions = workspace.querySelector(".topbar-actions");
  if (!actions) return null;
  const make = (tag, cls = "") => {
    const node = document.createElement(tag);
    node.className = cls;
    return node;
  };
  const button = make("button", "app-release-open");
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-controls", "app-release-notes");
  const card = make("dialog", "app-release-notes");
  card.id = "app-release-notes";
  card.setAttribute("aria-labelledby", "app-release-title");
  const header = make("header", "app-release-header"),
    eyebrow = make("span", "app-release-version"),
    title = make("h2"),
    intro = make("p", "app-release-intro"),
    close = make("button", "app-release-close");
  const cinemaNotice = make("strong", "app-release-cinema-notice");
  title.id = "app-release-title";
  close.type = "button";
  close.textContent = "×";
  header.append(eyebrow, close, title, intro, cinemaNotice);
  const sections = make("div", "app-release-sections"),
    changed = make("section"),
    fixed = make("section"),
    changedTitle = make("h3"),
    fixedTitle = make("h3"),
    changes = make("ul"),
    fixes = make("ul");
  changed.append(changedTitle, changes);
  fixed.append(fixedTitle, fixes);
  // Earlier releases follow below; the ones someone skipped while updating start open.
  const earlier = make("section", "app-release-earlier"),
    earlierTitle = make("h3"),
    earlierList = make("div", "app-release-earlier-list");
  earlier.append(earlierTitle, earlierList);
  sections.append(changed, fixed, earlier);
  const done = make("button", "app-release-done");
  done.type = "button";
  card.append(header, sections, done);
  document.body.append(card);
  actions.prepend(button);
  let version = null,
    returnFocus = null,
    autoPending = false,
    storage;
  try {
    storage = localStorage;
  } catch {
    /* Optional persistence. */
  }
  const seen = lastSeenReleaseNotes(storage),
    opened = new Set();
  const translate = () => {
    button.textContent = t("What's new");
    title.textContent = version ? t("Deviload {version} is out", { version }) : button.textContent;
    eyebrow.textContent = button.textContent;
    intro.textContent = t("A closer look at what changed and what was fixed.");
    close.ariaLabel = t("Dismiss release notes");
    done.textContent = t("Got it");
    cinemaNotice.hidden = version !== "2.7.9";
    cinemaNotice.textContent = t(
      "TEMPORARY: Devil Cinema uses the official YouTube player for online videos. Our own player is planned for the next update.",
    );
    changedTitle.textContent = t("What changed");
    fixedTitle.textContent = t("What was fixed");
    // Every release with its notes, newest first.
    const releases = [
      {
        version: "2.16.0",
        changes: [
          t("Sound moods in More on the player bar: Slowed + reverb, Nightcore and 8D."),
          t("Turn a few sung lines into a vertical video with the song's sound for stories and shorts."),
          t("A map of the artists you listen to in statistics, with covers and constellations."),
          t("RGB lighting through OpenRGB takes the cover's colour and pulses with the bass."),
          t("Close to the tray, queue tools, song notifications, lyrics search and a source per song."),
        ],
        fixes: [
          t("The mini player opens again on wide windows."),
          t("Leaving a listening room the host closed gives you your own music back."),
          t("Right-click and browser keys no longer show the web view's menu or reload the app."),
        ],
      },
      {
        version: "2.15.0",
        changes: [
          t(
            "Lyrics are in time on every version of a song: Devil Music measures the recording that plays and shifts the words to it.",
          ),
          t(
            "Identify a song from the microphone, this computer's sound or a file, and keep the songs found.",
          ),
          t("New YouTube Music likes come over to Liked songs once a day when you turn it on."),
          t(
            "New releases from artists you follow, moods that open at once and four new ones, and playlists downloaded for offline in one click.",
          ),
          t(
            "An OBS overlay of the song playing, library export to CSV, M3U and JSON, and label videos in Cinema with their sound.",
          ),
        ],
        fixes: [
          t("Lyrics no longer flicker or jump, and the next line arrives as it is sung."),
          t("The song menu opens beside its button instead of off the screen."),
          t("Bringing your music skips songs already in your library and keeps everything in one scroll."),
        ],
      },
      {
        version: "2.13.0",
        changes: [
          t(
            "Songs play through to the end: a reserve copy takes over where YouTube stops, and far seeks land where you click.",
          ),
          t(
            "Bring your YouTube Music and Spotify libraries, private playlists included, through your own sign-in on this computer.",
          ),
          t(
            "Recognize a song playing nearby with the microphone, and cast music to a TV or speaker with Chromecast or DLNA.",
          ),
          t(
            "Playback speed in one click, a Lossless mark for FLAC and WAV files, and music videos in the mini player.",
          ),
        ],
        fixes: [
          t("Songs no longer stop at 30–40 percent."),
          t("The whole play orb responds to clicks, and liking a song in an album keeps your place."),
          t("Lyrics no longer jump on songs with short pauses."),
        ],
      },
      {
        version: "2.12.0",
        changes: [
          t(
            "A liquid glass player: a play orb that breathes with the bass, a timeline that fills like a glass tube, and panels and windows that glide.",
          ),
          t(
            "Lyrics from one button: in the full player with depth, over the music video, on the desktop and as a picture to share.",
          ),
          t(
            "Your week, month and year of listening in a stats window, and a smarter search you can browse with the arrow keys.",
          ),
          t(
            "Only Devil Music mode, a new phone remote and Listen together, and an option to pause when another app plays sound.",
          ),
        ],
        fixes: [
          t("Scrolling stays smooth while music plays, and searches and panels no longer stall."),
          t("Lyrics stay in step with what you hear."),
          t("The window moves and resizes without the interface lagging behind."),
        ],
      },
      {
        version: "2.11.0",
        changes: [
          t(
            "Your own theme: put a photo, GIF or silent video behind Deviload and tune blur, light and colour.",
          ),
          t(
            "Edit layout: move blocks and player buttons, hide the ones you do not need and swap the side panels.",
          ),
          t("Music videos in the mini player, in a window you can resize and keep on top."),
          t("A folded library stays at hand as a rail of icons and playlist covers."),
        ],
        fixes: [
          t("Player buttons no longer overlap at medium window widths."),
          t("Leftover update files and old music engines are cleaned up automatically."),
          t("The library fits narrow windows without scrolling sideways."),
        ],
      },
      {
        version: "2.10.0",
        changes: [
          t("Watch a song's music video on its own stage, in step with the music."),
          t("Choose video quality up to 1080p and open music videos in full screen."),
          t("New Noir, Vinyl and Paper themes. Ambient stays the default."),
          t("Mini-player and phone remote shortcuts on the player bar, and a refreshed library sidebar."),
        ],
        fixes: [
          t("The window can be dragged from anywhere on the top bar."),
          t("Light themes keep a light Now Playing panel."),
          t("Player colours follow the theme."),
        ],
      },
      {
        version: "2.9.0",
        changes: [
          t("Crossfade between songs, play albums without gaps and set a sleep timer."),
          t("Show a translation or Latin letters under each line of the lyrics."),
          t("Jump anywhere in a playing song almost instantly."),
          t("A new look for Devil Music and Deviload, with keyboard shortcuts and right-click menus."),
        ],
        fixes: [
          t("For you keeps its picks when you come back, and hiding a song leaves the rest in place."),
          t("Shuffle spreads out artists and avoids repeating the end of the last round."),
          t("The music engine and download tools close together with Deviload."),
        ],
      },
      {
        version: "2.8.0",
        changes: [
          t("Keep browsing the same For you picks until your next visit or refresh."),
          t("Choose another recording from the player if a source fails."),
          t("Open lyrics from the artwork or the full player."),
          t("Transfer music from a public Spotify playlist or album link, or import a JSON or CSV export."),
        ],
        fixes: [
          t("Large liked-song lists render only visible rows, keeping scrolling and navigation responsive."),
          t("Large covers use higher resolution when available; small list thumbnails stay lightweight."),
          t("Artist pages can show previously loaded results or songs from search."),
        ],
      },
      {
        version: "2.7.9",
        changes: [
          t("Import Spotify JSON and CSV exports in batches, resume later and save unresolved songs."),
          t("Search suggestions now include songs, artists and albums as you type."),
          t("Open an artist’s full song list and load more pages when the source provides them."),
          t(
            "Try a listening room with a friend on another Windows PC. Share the room link; the host controls playback.",
          ),
        ],
        fixes: [
          t("Large liked-song lists render only visible rows, keeping scrolling and navigation responsive."),
          t("Large covers use higher resolution when available; small list thumbnails stay lightweight."),
          t("Import progress is separate from your music profile. Imported listening history is optional."),
        ],
      },
    ];
    const current =
      releases.find(entry => compareVersions(entry.version, version) === 0) ||
      (version && compareVersions(version, releases.at(-1).version) < 0 ? releases.at(-1) : releases[0]);
    const list = (node, items) =>
      node.replaceChildren(
        ...items.map(text => {
          const item = make("li");
          item.textContent = text;
          return item;
        }),
      );
    list(changes, current.changes);
    list(fixes, current.fixes);
    earlierTitle.textContent = t("Earlier updates");
    for (const node of earlierList.querySelectorAll("details"))
      if (node.open) opened.add(node.dataset.version);
      else opened.delete(node.dataset.version);
    const older = releases.filter(entry => compareVersions(entry.version, current.version) < 0);
    earlier.hidden = !older.length;
    earlierList.replaceChildren(
      ...older.map(entry => {
        const details = make("details", "app-release-earlier-item"),
          summary = make("summary"),
          body = make("div", "app-release-earlier-body");
        details.dataset.version = entry.version;
        details.open = opened.has(entry.version) || (!!seen && compareVersions(entry.version, seen) > 0);
        summary.textContent = t("Deviload {version}", { version: entry.version });
        const changedHeading = make("h4"),
          fixedHeading = make("h4"),
          changedList = make("ul"),
          fixedList = make("ul");
        changedHeading.textContent = t("What changed");
        fixedHeading.textContent = t("What was fixed");
        list(changedList, entry.changes);
        list(fixedList, entry.fixes);
        body.append(changedHeading, changedList, fixedHeading, fixedList);
        details.append(summary, body);
        return details;
      }),
    );
  };
  const open = () => {
    if (card.open) return;
    returnFocus = document.activeElement;
    card.showModal();
    button.setAttribute("aria-expanded", "true");
    markReleaseNotesSeen(storage, version);
    autoPending = false;
    done.focus();
  };
  const tryAutomatic = () => {
    if (!autoPending || document.hidden || document.querySelector("dialog[open]")) return;
    open();
  };
  button.addEventListener("click", open);
  close.addEventListener("click", () => card.close());
  done.addEventListener("click", () => card.close());
  card.addEventListener("close", () => {
    button.setAttribute("aria-expanded", "false");
    returnFocus?.focus();
  });
  document.addEventListener("close", () => queueMicrotask(tryAutomatic), true);
  document.addEventListener("visibilitychange", tryAutomatic);
  translate();
  onLanguageChange(translate);
  button.setAttribute("aria-expanded", "false");
  // Read the installed version, not a feature label that can outlive a release.
  Promise.resolve()
    .then(() => window.__TAURI__?.app?.getVersion?.())
    .then(value => {
      if (typeof value !== "string" || !value.trim()) return;
      version = value;
      translate();
      autoPending = shouldShowReleaseNotes(storage, version);
      requestAnimationFrame(tryAutomatic);
    })
    .catch(() => {
      /* Manual opening still works when version lookup fails. */
    });
  const result = { open };
  instances.set(workspace, result);
  return result;
}
