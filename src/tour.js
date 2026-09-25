import {setPose} from "./mascot-spot.js";
import {t, onLanguageChange} from "./i18n.js";

const STORAGE_KEY = "deviload-tour-v1";
const steps = [
  {page:"downloads", target:".quick-link", title:"Download from a link", text:"Paste a link to a video, music, a playlist or a channel and press “Download”. You can also drop a link from the browser anywhere on the window."},
  {page:"downloads", target:".download-options", title:"Choose a format", text:"Before downloading, set the quality, video or audio, subtitles and other options. For a GIF or a clip open the extra options."},
  {page:"downloads", target:"#options-toggle", title:"Where to save", text:"“Download settings” hold the save folder, parallel downloads, clips, playlists and a delayed start."},
  {page:"downloads", target:"#queue-title", title:"Manage tasks", text:"The queue shows progress and errors. A finished file can be opened, shown in its folder, sent to a phone with a QR code or opened in Devil Cut."},
  {page:"library", target:"#cinema-open", title:"Library and Devil Cinema", text:"All finished files live here. Watch them in the player, resume from the saved position, send them to a phone and organize collections."},
  {page:"search", target:"#media-search-form", title:"Media search", text:"Find a video or a track on YouTube and YouTube Music, then send its link to the downloads."},
  {page:"editor", target:"#editor-home", title:"Devil Cut", text:"Pick a video or a saved project. Devil Cut opens in its own window with a timeline, clip settings and export to MP4, GIF or MP3."},
  {page:"downloads", target:"#open-youtube-view", title:"YouTube sign-in", text:"Needed for age-restricted, private and members-only videos. Sign in to Google once and Deviload keeps the session."},
  {page:"downloads", target:"#settings-open", title:"Settings", text:"Clipboard suggestions, notifications, tray behavior, the cookie source, yt-dlp updates and this tour live here. The bell next to it shows app events."}
];

export function wireTour(navigate) {
  const overlay = document.getElementById("tour-overlay");
  const ring = document.getElementById("tour-ring");
  const card = document.getElementById("tour-card");
  const arrow = document.getElementById("tour-arrow");
  const path = document.getElementById("tour-arrow-path");
  let current = -1, focused = null, placementTimer = 0;

  function place() {
    if (overlay.hidden || !focused) return;
    const target = focused.getBoundingClientRect();
    ring.style.left = `${Math.max(0, target.left - 5)}px`;
    ring.style.top = `${Math.max(0, target.top - 5)}px`;
    ring.style.width = `${Math.max(8, target.width + 10)}px`;
    ring.style.height = `${Math.max(8, target.height + 10)}px`;
    const margin = 15, width = Math.min(330, innerWidth - margin * 2);
    card.style.width = `${width}px`;
    const height = card.getBoundingClientRect().height;
    let left, top;
    if (innerWidth - target.right >= width + 28) {
      left = target.right + 34;
      top = target.top + target.height / 2 - height / 2;
    } else if (target.left >= width + 28) {
      left = target.left - width - 34;
      top = target.top + target.height / 2 - height / 2;
    } else {
      left = Math.max(margin, Math.min(target.left, innerWidth - width - margin));
      top = target.bottom + 30;
      if (top + height > innerHeight - margin) top = target.top - height - 30;
    }
    left = Math.max(margin, Math.min(left, innerWidth - width - margin));
    // The mascot sits on the top edge of the card and needs room above it.
    top = Math.max(margin + 44, Math.min(top, innerHeight - height - margin));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    const box = card.getBoundingClientRect();
    const targetX = Math.max(12, Math.min(innerWidth - 12, box.left > target.right ? target.right - 5 : box.right < target.left ? target.left + 5 : target.left + target.width / 2));
    const targetY = Math.max(12, Math.min(innerHeight - 12, box.top > target.bottom ? target.bottom - 5 : box.bottom < target.top ? target.top + 5 : target.top + Math.min(target.height, 100) / 2));
    const sourceX = targetX > box.right ? box.right : targetX < box.left ? box.left : Math.max(box.left + 25, Math.min(targetX, box.right - 25));
    const sourceY = targetY > box.bottom ? box.bottom : targetY < box.top ? box.top : Math.max(box.top + 18, Math.min(targetY, box.bottom - 18));
    const bend = (targetX - sourceX) * .55;
    arrow.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`);
    path.setAttribute("d", `M${sourceX} ${sourceY} C${sourceX + bend} ${sourceY}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}`);
  }

  function show(index) {
    current = index;
    const step = steps[index];
    if (focused) focused.classList.remove("tour-focus");
    navigate(step.page);
    document.getElementById("tour-step").textContent = `${index + 1} / ${steps.length}`;
    setPose(document.getElementById("tour-mascot"), index === steps.length - 1 ? "victory" : index === 0 ? "front" : "look");
    document.getElementById("tour-title").textContent = t(step.title);
    document.getElementById("tour-description").textContent = t(step.text);
    document.getElementById("tour-back").disabled = index === 0;
    document.getElementById("tour-next").textContent = t(index === steps.length - 1 ? "Finish" : "Next");
    focused = document.querySelector(step.target);
    if (!focused) return finish();
    focused.classList.add("tour-focus");
    focused.scrollIntoView({block:"center", behavior:"instant"});
    clearTimeout(placementTimer);
    placementTimer = setTimeout(() => { place(); card.focus({preventScroll:true}); }, 130);
  }

  function finish() {
    clearTimeout(placementTimer);
    if (focused) focused.classList.remove("tour-focus");
    focused = null; current = -1;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    localStorage.setItem(STORAGE_KEY, "seen");
  }

  function start() {
    if (!overlay.hidden) return;
    document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    show(0);
  }

  document.getElementById("tour-replay").addEventListener("click", start);
  document.getElementById("tour-skip").addEventListener("click", finish);
  document.getElementById("tour-back").addEventListener("click", () => { if (current > 0) show(current - 1); });
  document.getElementById("tour-next").addEventListener("click", () => current === steps.length - 1 ? finish() : show(current + 1));
  document.addEventListener("keydown", event => {
    if (overlay.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); finish(); }
    if (event.key === "ArrowRight") { event.preventDefault(); document.getElementById("tour-next").click(); }
    if (event.key === "ArrowLeft" && current > 0) { event.preventDefault(); document.getElementById("tour-back").click(); }
  });
  onLanguageChange(() => { if (!overlay.hidden && current >= 0) show(current); });
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, {passive:true});
  function firstRun() {
    if (localStorage.getItem(STORAGE_KEY)) return;
    if (document.querySelector("dialog[open]")) return setTimeout(firstRun, 1000);
    start();
  }
  setTimeout(firstRun, 1400);
}