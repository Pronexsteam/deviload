import { t } from "./i18n.js";
import { runTour, forgetTour } from "./music-tour.js";

// The general Deviload tour: one glass card at a time, moving to each section as it goes.
// Its record is kept under the original key, so people who saw the old tour are not asked again.
const KEY = "v1";
const steps = [
  {
    page: "downloads",
    target: ".quick-link",
    title: "Download from a link",
    text: "Paste a link to a video, music, a playlist or a channel and press “Download”. You can also drop a link from the browser anywhere on the window.",
  },
  {
    page: "downloads",
    target: ".download-options",
    title: "Choose a format",
    text: "Before downloading, set the quality, video or audio, subtitles and other options. For a GIF or a clip open the extra options.",
  },
  {
    page: "downloads",
    target: "#options-toggle",
    title: "Where to save",
    text: "“Download settings” hold the save folder, parallel downloads, clips, playlists and a delayed start.",
  },
  {
    page: "downloads",
    target: "#queue-title",
    title: "Manage tasks",
    text: "The queue shows progress and errors. A finished file can be opened, shown in its folder, sent to a phone with a QR code or opened in Devil Cut.",
  },
  {
    page: "library",
    target: "#cinema-open",
    title: "Library and Devil Cinema",
    text: "All finished files live here. Watch them in the player, resume from the saved position, send them to a phone and organize collections.",
  },
  {
    page: "cinema",
    target: "#cinema-home-form",
    title: "Devil Cinema",
    text: "Paste a YouTube video or playlist. Watch online, or play your downloaded files.",
  },
  {
    page: "editor",
    target: "#editor-home",
    title: "Devil Cut",
    text: "Pick a video or a saved project. Devil Cut opens in its own window with a timeline, clip settings and export to MP4, GIF or MP3.",
  },
  {
    page: "downloads",
    target: "#open-youtube-view",
    title: "YouTube sign-in",
    text: "Needed for age-restricted, private and members-only videos. Sign in to Google once and Deviload keeps the session.",
  },
  {
    page: "downloads",
    target: "#settings-open",
    title: "Settings",
    text: "Clipboard suggestions, notifications, tray behavior, the cookie source, yt-dlp updates and this tour live here. The bell next to it shows app events.",
  },
];

export function wireTour(navigate) {
  const run = force =>
    runTour({
      key: KEY,
      force,
      steps: steps.map(step => ({
        before: async () => {
          navigate(step.page);
          await new Promise(resolve => setTimeout(resolve, 380));
        },
        target: () => document.querySelector(step.target),
        title: t(step.title),
        text: t(step.text),
      })),
    });
  document.getElementById("tour-replay")?.addEventListener("click", () => {
    document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
    forgetTour(KEY);
    setTimeout(() => run(true), 300);
  });
  function firstRun() {
    if (localStorage.getItem("deviload-tour-" + KEY)) return;
    if (document.querySelector("dialog[open]")) return setTimeout(firstRun, 1000);
    run(false);
  }
  setTimeout(firstRun, 1400);
}
