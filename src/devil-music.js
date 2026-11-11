import { mountPictureDisc, setPictureDiscArtwork } from "./music-picture-disc.js";
import { isLocalMusicId } from "./music-track-id.js";
import { createLocalLibrary } from "./music-local-library.js";
import {
  localPlaybackSource,
  getExactLocalCopy,
  setExactLocalCopy,
  exactLocalPlaybackSource,
} from "./music-local-model.js";
import { findLocalRecording } from "./music-auto-local.js";
import { mountMusicList } from "./music-virtual-list.js";
import { wireQueueHandle } from "./music-queue-drag.js";
import { openArtistPage } from "./music-artist-page.js";
import { loadArtwork, applyBrowseArtwork, safeArtworkUrl } from "./music-artwork.js";
import { playbackCandidates as eligiblePlaybackCandidates } from "./music-playback-candidates.js";
import {
  wireMusicPanels,
  wireMusicSuggestions,
  createMusicHero,
  wireMusicConnectionShortcuts,
} from "./music-workspace-tools.js";
import { wireMusicDockMenu } from "./music-dock-menu.js";
import { wireMusicLayout } from "./music-layout.js";
import { wireMusicTopbar } from "./music-topbar.js";
import { wireLyricsLines } from "./music-lyrics-desktop.js";
import { createStatsWindow } from "./music-stats-window.js";
import { runTour, tourSeen, forgetTour } from "./music-tour.js";
import { wireMusicYield } from "./music-yield.js";
import { wireMusicAccount } from "./music-account.js";
import { createLikesSync, likesSyncControls } from "./music-likes-sync.js";
import { createRecordingAlign } from "./music-recording-align.js";
import { groupMusicSettings } from "./music-settings-groups.js";
import { createNewReleases } from "./music-new-releases.js";
import { wireMusicControlApi } from "./music-control-api.js";
import { wireMusicRecognize } from "./music-recognize.js";
import { createMusicCast, isCasting } from "./music-cast.js";
import { wireScrobbling } from "./music-scrobble.js";
import { wireGlassOrb, wireGlassButtons } from "./music-glass.js";
import { wireResultKeys } from "./music-results-keys.js";
import { createMusicHomeTiles } from "./music-home-tiles.js";
import { revealView, cascadeIn, flyFrom } from "./music-transitions.js";
import { transitionPlan } from "./music-transition-model.js";
import { createSleepTimer, sleepLabel, SLEEP_MINUTES } from "./music-sleep.js";
import { musicShortcut } from "./music-shortcuts.js";
import { wireMusicSpeed } from "./music-speed.js";
import { createShortcutHelp } from "./music-shortcut-help.js";
import {
  collectionFacts,
  creditAlbumArtist,
  creditAlbumTracks,
  creditArtistCards,
  bestResult,
} from "./music-ui-model.js";
import { createMusicMiniPlayer } from "./music-mini-controller.js";
import { createMusicRoom } from "./music-room-controller.js";
import { createMusicRemote } from "./music-remote-controller.js";
import { registerPlaybackRange, isRangeDragging } from "./player-controls.js";
import { bufferedSeconds, canPrepareAudio, keyboardSeek } from "./music-playback-health.js";
import { createMusicNavigation } from "./music-navigation.js";
import { wireMusicSearch } from "./music-search.js";
import { createMusicPresence } from "./music-presence.js";
import { t, language, onLanguageChange, errorText } from "./i18n.js";
import { tracks, remember, reorderTrack, insertNext, restoreRemoved, playbackQueue } from "./music-state.js";
import {
  recordListening,
  tasteSeeds,
  listeningClock,
  hideRecommendation,
  canonicalArtistKey,
  recommendationAllowed,
} from "./music-taste.js";
import { recommendationLabel } from "./music-recommendation-view.js";
import { createRecommendationSession } from "./music-recommendation-session.js";
import {
  rankMusicRecommendations,
  recommendationFamiliarity,
  distinctSongs,
} from "./music-recommendation-engine.js";
import { createRecordingView } from "./music-recording-view.js";
import { createMusicDiscovery } from "./music-discovery.js";
import {
  createRecordingSourceResolver,
  setRecordingSource,
  removeRecordingSource,
  recordingFamilyIds,
  recordingMatch,
  singleCatalogMatch,
} from "./music-recordings.js";
import { openRecordingPicker } from "./music-recording-ui.js";
import {
  interestSources,
  interestSeeds,
  interestProfile,
  rememberInterestTrack,
  sanitizeInterestMixes,
} from "./music-interest-mixes.js";
import { createInterestMixesUI } from "./music-interest-ui.js";
import { createNowPlaying } from "./music-presentation.js";
import { createLyricCard } from "./music-lyric-card.js";
import { wireTimeline } from "./music-timeline.js";
import { wireHoverLight } from "./music-hover.js";
import { wireVolumeBubble } from "./music-volume-bubble.js";
import { isMotionCover } from "./music-motion.js";
import {
  readMusicProfile,
  saveMusicProfile,
  sanitizeMusicCollection,
  sanitizeMusicTrack,
} from "./music-profile.js";
import { wireMusicProfile } from "./music-profile-ui.js";
import { wirePlaybackSettings } from "./music-playback-settings.js";
import { createMusicIntent } from "./music-intent.js";
import { readMusicSession, saveMusicSession, createPlaybackOrder } from "./music-session.js";
import { createMusicLibrary } from "./music-library.js";
import { createMusicDecks } from "./music-decks.js";
import { musicGain, gainFromVolumePosition, volumePositionFromGain, volumePercent } from "./music-volume.js";
import { createMusicDiagnostics, playbackFailure } from "./music-diagnostics.js";
import { createArtistCatalog } from "./music-artist-catalog.js";
import { createMusicSound } from "./music-sound.js";
import { createMusicAmbient } from "./music-ambient.js";
import { createMusicLyrics } from "./music-lyrics.js";

import { selectTrackRange, smartPlaylists, folderName, playlistFolders } from "./music-library-model.js";
import { createWeeklyStats } from "./music-weekly.js";
import { openArtistPicker } from "./music-artist-picker.js";
import { wireMusicImport } from "./music-import-ui.js";
import { mergeMusicImport, createLibraryIndex } from "./music-import-model.js";
import { enhanceMusicShelves } from "./music-shelf-navigation.js";
import { createMusicLibrarySidebar } from "./music-library-sidebar.js";

const $ = id => document.getElementById(id);
const moods = {
  chill: "chill relaxing music",
  focus: "instrumental focus music",
  jazz: "jazz",
  electronic: "electronic night music",
  rock: "rock",
  fresh: "new music this week",
  hits: "top hits",
  workout: "workout music",
  road: "road trip songs",
};
// Mood shelves come back at once: kept for a few hours, and read ahead quietly while the home is open.
const MOOD_KEY = "deviload-music-moods-v1",
  MOOD_MS = 6 * 3600000;
function moodCache(storage) {
  let table = {};
  try {
    const value = JSON.parse(storage?.getItem(MOOD_KEY) || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) table = value;
  } catch {}
  return {
    get(key) {
      const row = table[key];
      return row && Date.now() - row.at < MOOD_MS && Array.isArray(row.result?.sections) ? row.result : null;
    },
    set(key, result) {
      table[key] = { at: Date.now(), result: { sections: result.sections || [] } };
      for (const old of Object.keys(table)) if (Date.now() - table[old].at >= MOOD_MS) delete table[old];
      try {
        storage?.setItem(MOOD_KEY, JSON.stringify(table));
      } catch {}
    },
  };
}
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const icon = name => {
  const node = el("span", "icon");
  node.dataset.icon = name;
  node.setAttribute("aria-hidden", "true");
  return node;
};
function button(label, glyph, action, cls = "music-icon-button") {
  const node = el("button", cls);
  node.type = "button";
  node.title = label;
  node.setAttribute("aria-label", label);
  if (glyph) node.append(icon(glyph));
  else node.textContent = label;
  node.addEventListener("click", action);
  return node;
}
function cover(item, cls = "", size = 320) {
  const frame = el("span", `music-art ${cls}`);
  frame.append(icon("music-notes"));
  if (safeArtworkUrl(item?.image)) {
    const img = el("img", "");
    if (loadArtwork(img, item.image, size)) frame.append(img);
    // A video track's picture is a wide frame; it fills square covers instead of sitting between black bars.
    img.addEventListener?.("load", () =>
      img.classList.toggle("is-wide", img.naturalHeight > 0 && img.naturalWidth / img.naturalHeight > 1.2),
    );
  }
  return frame;
}
function displaySubtitle(item) {
  if (item?.kind === "artist") return t("Artist");
  const names = (item?.artists || []).filter(name => typeof name === "string" && name.trim()).join(", ");
  return (
    names ||
    (item?.kind === "album" ? t("Album") : item?.kind === "playlist" ? t("Playlist") : t("Unknown artist"))
  );
}
const time = seconds =>
  Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
    : "0:00";
function playableCover(item, glyph = "play", size = 320) {
  const art = cover(item, "", size),
    overlay = el("span", "music-cover-overlay"),
    circle = el("span", "music-cover-action");
  overlay.setAttribute("aria-hidden", "true");
  circle.append(icon(glyph));
  overlay.append(circle);
  art.append(overlay);
  return art;
}

export function createMusic({ invoke, onDownload, storage }) {
  const diagnostics = createMusicDiagnostics();
  const loadArtistCatalog = createArtistCatalog(invoke);
  const newReleases = createNewReleases({ loadArtist: loadArtistCatalog, storage });
  const moodShelves = moodCache(storage);
  let moodsAhead = false;
  const decks = createMusicDecks();
  let audio = decks.current;
  document.body.append(...decks.nodes);
  if (!storage)
    try {
      storage = localStorage;
    } catch {
      /* storage unavailable */
    }
  // Preferences stay on this device; no account or remote profile is needed.
  const { saved, taste } = readMusicProfile(storage);
  saved.collections ??= [];
  saved.interestMixes ??= [];
  saved.sourceBindings ??= [];
  const resolveRecordingSource = createRecordingSourceResolver();
  const weekly = createWeeklyStats(storage);
  let privateSession = false,
    statsSession = null,
    statsSeconds = 0,
    statsCounted = false;
  const restored = readMusicSession(storage),
    order = createPlaybackOrder(
      Math.random,
      item => resolveRecordingSource(item, saved.sourceBindings)?.id || item.id,
    );
  decks.setVolume(saved.volume);
  const clock = listeningClock(),
    radioCache = new Map();
  let session = 0,
    checkpoint = 0,
    historyAdded = false,
    recoveryUsed = false,
    alternateTried = false,
    pendingSeek = 0,
    radioPending = false;
  let recoveryLocal = null,
    recoveryCatalog = null,
    pendingLocalCancel = null;
  let view = "home",
    request = 0,
    playRequest = 0,
    current = null,
    queue = restored.queue,
    index = -1,
    sections = [],
    loaded = false,
    loading = false,
    repeat = restored.repeat,
    shuffle = restored.shuffle;
  let lastQuery = { kind: "home", value: "" },
    homeCache = null,
    activeMood = "",
    queueOpen = false,
    streamLoading = false;
  let resolvedTrack = null,
    resolvedOffline = false,
    autoplay = restored.autoplay;
  const virtualLists = [];
  const clearVirtualLists = () => {
    virtualLists.splice(0).forEach(list => list.destroy());
  };
  const contextActions = new WeakMap();
  let contextMenu = null;
  let librarySidebar = null,
    homeHero = null,
    homeTiles = null,
    miniPlayer = null,
    musicRoom = null,
    roomReturn = null,
    desktopItem = null,
    phoneRemote = null;
  let selectedTracks = new Set(),
    selectionAnchor = null,
    visibleTrackIds = [],
    discoveryCandidates = [];
  let personalization = 0,
    recommendationRevision = 0,
    listeningRevision = 0,
    homeListeningRevision = 0,
    homeBuiltAt = 0,
    playbackContext = [],
    playbackOrigin = "manual",
    contextRevision = 0,
    followedCursor = 0,
    playbackSourceContext = { kind: "restored" };
  const recommendationSession = createRecommendationSession(),
    automaticQueueIds = new Set();
  const publicDiscovery = createMusicDiscovery({ invoke });
  let publicGeneration = 0;
  const recommendationNodes = new Map(),
    recommendationIntersections = new Map(),
    impressionTimers = new Map();
  let recommendationObserver = null;
  const recommendationReasons = new Map();
  let playlistId = null,
    listFilter = "",
    listSort = "original",
    sessionSavedAt = 0,
    sessionTransition = false;
  let knownDuration = restored.duration,
    resumeSnapshot = null;
  let endSource = null;
  let nativeState = "";
  const discordPresence = createMusicPresence({
    invoke,
    storage,
    getPlayback: () => ({
      privateSession,
      playing: Boolean(current && !audio.paused && !streamLoading && audio.readyState >= 3),
      title: current?.title || "",
      artist: (current?.artists || []).join(", "),
      image: current?.image || "",
      position: audio.currentTime || 0,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    }),
  });
  let removed = null,
    dragged = null,
    queueList = null;
  let bufferingTimer = null,
    retryPosition = 0;
  let nextPlan = null,
    preloadPending = false,
    preloadAttempts = new Map(),
    preloadWindow = [];
  let radioAhead = null;
  let sourceRevision = 0,
    interestViewId = null,
    interestPool = null;
  let recordingRoutingRevision = -1,
    recordingBoundIds = new Set();
  const recordingFamilies = new Map();
  const interestRotations = new Map();
  let homeSeedRotation = 0,
    homeRefreshRevision = -1;
  let nextHomeCandidates = [];
  let needsRefresh = false,
    enginePrepared = false;
  let searchFilter = "all",
    continuation = null,
    morePending = false,
    browseItem = null,
    offlineItems = [],
    musicSearch = null;
  const downloadsPending = new Set();
  const navigation = createMusicNavigation({
    type: "catalog",
    kind: "home",
    value: "",
    heading: "",
    filter: "songs",
    mood: "",
    item: null,
  });
  let restoringNavigation = false;
  const backButton = button(
    t("Back"),
    null,
    () => {
      const target = navigation.back();
      if (!target) return;
      restoringNavigation = true;
      if (target.type === "local") showLocal(target.view);
      else if (target.type === "playlist") showPlaylist(target.id);
      else if (target.type === "interest") showInterestMix(target.id);
      else if (target.type === "offline") showOffline();
      else {
        searchFilter = target.filter;
        activeMood = target.mood;
        browseItem = target.item;
        load(target.kind, target.value, target.heading, false, target.params || "");
      }
    },
    "music-navigation-back",
  );
  const homeButton = button(
    t("Music home"),
    null,
    () => {
      activeMood = "";
      browseItem = null;
      searchFilter = "songs";
      load("home");
    },
    "music-navigation-home",
  );
  const musicNavigation = el("nav", "music-navigation");
  musicNavigation.setAttribute("aria-label", t("Music navigation"));
  musicNavigation.append(backButton, homeButton);
  document.querySelector(".workspace-breadcrumb").after(musicNavigation);
  backButton.disabled = true;
  function rememberNavigation(target) {
    if (restoringNavigation) restoringNavigation = false;
    else navigation.visit(target);
    backButton.disabled = !navigation.canGoBack();
  }
  onLanguageChange(() => {
    backButton.textContent = backButton.title = backButton.ariaLabel = t("Back");
    homeButton.textContent = homeButton.title = homeButton.ariaLabel = t("Music home");
    musicNavigation.setAttribute("aria-label", t("Music navigation"));
  });
  const intent = createMusicIntent({
    prepare: async id => {
      const token = playRequest,
        result = await playbackSource(id, false, true);
      if (token === playRequest && !streamLoading && audio.paused)
        sound.setSource(decks.warm(id, result.url), result.offline === true);
    },
    allowed: () =>
      !streamLoading &&
      !radioPending &&
      !preloadPending &&
      !audio.seeking &&
      audio.paused &&
      navigator.onLine !== false &&
      !navigator.connection?.saveData,
  });
  const dock = el("section", "music-dock");
  dock.hidden = true;
  dock.setAttribute("aria-label", t("Music player"));
  const identity = el("div", "music-now");
  const artwork = el("div", "music-now-art"),
    dockDisc = mountPictureDisc(el("span", "music-dock-disc"));
  // A new song flows into the player bar: the disc settles in with a turn and the names rise into place.
  let dockShown = null;
  const flowIn = item => {
    const id = item?.id || null;
    if (id === dockShown) return;
    const first = dockShown === null;
    dockShown = id;
    if (
      first ||
      !id ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      artwork.closest(".music-stage")
    )
      return;
    artwork.animate(
      [
        { opacity: 0, transform: "scale(.78) rotate(-24deg)", filter: "blur(4px)" },
        { opacity: 1, transform: "none", filter: "none" },
      ],
      { duration: 560, easing: "cubic-bezier(.2,1.1,.3,1)" },
    );
    title.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 420, delay: 60, easing: "cubic-bezier(.2,.85,.15,1)", fill: "backwards" },
    );
    artist.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 420, delay: 120, easing: "cubic-bezier(.2,.85,.15,1)", fill: "backwards" },
    );
  };
  const updateDockArt = item => {
    setPictureDiscArtwork(dockDisc, item?.image, 192);
    artwork.replaceChildren(artwork.closest(".music-stage") ? cover(item, "", 1024) : dockDisc);
    flowIn(item);
  };
  updateDockArt(null);
  const info = el("div", "music-now-info"),
    title = el("strong", "", t("Pick your first track")),
    artist = el("button", "music-artist-link", t("Your soundtrack starts here"));
  artist.type = "button";
  artist.addEventListener("click", () => showArtist(current));
  const artistLine = el("span", "music-dock-artist-line");
  // A file on this device stored without loss (FLAC, ALAC, WAV) says so beside the artist.
  const losslessBadge = el("span", "music-lossless", t("Lossless"));
  losslessBadge.hidden = true;
  artistLine.append(artist, losslessBadge);
  const changeSource = button(
    t("Choose track version"),
    "music-notes",
    () => chooseRecording(current),
    "music-change-source",
  );
  changeSource.textContent = t("Choose track version");
  changeSource.hidden = true;
  onLanguageChange(() => {
    changeSource.textContent = changeSource.title = changeSource.ariaLabel = t("Choose track version");
    losslessBadge.textContent = t("Lossless");
    losslessBadge.title = t("Lossless audio: FLAC, ALAC or WAV on this device");
  });
  info.append(title, artistLine, changeSource);
  const like = button(t("Like this song"), null, toggleLike, "music-icon-button music-like");
  like.textContent = "♡";
  identity.append(artwork, info, like);
  const transport = el("div", "music-transport"),
    controls = el("div", "music-transport-buttons");
  const shuffleButton = button(t("Shuffle"), "shuffle", toggleShuffle);
  const previous = button(t("Previous track"), "skip-back", () => {
    if (roomControlsPlayback()) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      persistSession();
    } else {
      const id = order.previous(queue),
        position = id ? queue.findIndex(item => item.id === id) : index - 1;
      if (position >= 0) playAt(position);
    }
  });
  const play = button(t("Play"), "play", togglePlay, "music-play-button");
  const next = button(t("Next track"), "skip-forward", () => advance(true));
  const repeatButton = button(t("Repeat queue"), "repeat", () => {
    repeat = { off: "all", all: "one", one: "off" }[repeat];
    nextPlan = null;
    syncDock();
    persistSession();
  });
  controls.append(shuffleButton, previous, play, next, repeatButton);
  const progress = el("div", "music-progress"),
    elapsed = el("span", "", "0:00"),
    duration = el("span", "", "0:00"),
    seek = el("input", "");
  seek.type = "range";
  seek.min = "0";
  seek.max = "1000";
  seek.value = "0";
  seek.disabled = true;
  seek.setAttribute("aria-label", t("Playback position"));
  seek.step = "any";
  registerPlaybackRange(seek, () =>
    !seek.disabled && Number.isFinite(audio.duration) && audio.duration > 0
      ? (audio.currentTime / audio.duration) * 1000
      : NaN,
  );
  seek.addEventListener("input", () => {
    if (!roomControlsPlayback() && Number.isFinite(audio.duration))
      audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
  });
  seek.addEventListener("keydown", event => {
    const position = keyboardSeek(event.key, audio.currentTime, audio.duration);
    if (position === null || seek.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (!roomControlsPlayback()) {
      audio.currentTime = position;
      seek.value = String((position / audio.duration) * 1000);
      seek.setAttribute("aria-valuetext", `${time(position)} / ${time(audio.duration)}`);
    }
  });
  progress.append(elapsed, seek, duration);
  transport.append(controls, progress);
  const extras = el("div", "music-dock-extras");
  const queueButton = button(t("Play queue"), "queue", () => {
    queueOpen = !queueOpen;
    renderQueue();
    if (queueOpen) queuePanel.querySelector("button")?.focus({ preventScroll: true });
  });
  queueButton.setAttribute("aria-expanded", "false");
  queueButton.setAttribute("aria-controls", "music-play-queue");
  queueButton.classList.add("music-queue-toggle", "music-labeled-control");
  const queueLabel = el("span", "music-control-label", t("Queue"));
  queueButton.append(queueLabel);
  onLanguageChange(() => {
    queueLabel.textContent = t("Queue");
  });
  const downloadButton = button(t("Download MP3"), "download-simple", () => downloadTrack(current));
  downloadButton.classList.add("music-dock-download");
  const volume = el("input", "");
  volume.type = "range";
  volume.min = "0";
  volume.max = "1";
  volume.step = ".01";
  volume.value = String(volumePositionFromGain(audio.volume));
  volume.setAttribute("aria-label", t("Volume"));
  let previousVolume = musicGain(saved.volumeBeforeMute, audio.volume || 0.7),
    volumeSave = null;
  function syncVolume() {
    const percent = volumePercent(audio.volume);
    volume.value = String(volumePositionFromGain(audio.volume));
    volume.title = t("Volume: {percent}%", { percent });
    volume.setAttribute("aria-valuetext", `${percent}%`);
    const label = audio.volume === 0 ? t("Unmute") : t("Mute");
    volumeMark.title = label;
    volumeMark.setAttribute("aria-label", label);
    volumeMark.setAttribute("aria-pressed", String(audio.volume === 0));
    volumeMark.style?.setProperty("--vol-level", String(Math.round(percent) / 100));
  }
  function setVolume(value) {
    value = musicGain(value);
    decks.setVolume(value);
    saved.volume = value;
    if (value > 0) saved.volumeBeforeMute = previousVolume = value;
    syncVolume();
    clearTimeout(volumeSave);
    volumeSave = setTimeout(persist, 200);
  }
  volume.addEventListener("input", () => setVolume(gainFromVolumePosition(Number(volume.value))));
  volume.addEventListener("change", () => {
    clearTimeout(volumeSave);
    persist();
  });
  const volumeMark = button(
    t("Mute"),
    "speaker-high",
    () => setVolume(audio.volume === 0 ? previousVolume : 0),
    "music-icon-button music-volume-mark",
  );
  syncVolume();
  onLanguageChange(() => {
    volume.setAttribute("aria-label", t("Volume"));
    syncVolume();
  });
  extras.append(queueButton, downloadButton, volumeMark, volume);
  dock.append(identity, transport, extras);
  document.body.append(dock);
  const queuePanel = el("section", "music-queue-panel");
  queuePanel.id = "music-play-queue";
  queuePanel.hidden = true;
  queuePanel.setAttribute("aria-label", t("Play queue"));
  document.body.append(queuePanel);
  function closeQueue() {
    queueOpen = false;
    renderQueue();
    queueButton.focus({ preventScroll: true });
  }
  queuePanel.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeQueue();
    }
  });
  const align = createRecordingAlign({ invoke, storage });
  let heardSource = null;
  const presentation = createNowPlaying({
    invoke,
    language,
    getAudio: () => audio,
    getLatency: () => sound.latency(),
    // The music video in step with the song even when its intro is longer: both are measured against the studio
    // recording, and the picture follows the difference.
    clipOffset: clipId => {
      const song = align.value(heardSource),
        picture = align.value(clipId);
      return song == null || picture == null ? 0 : song - picture;
    },
    onClip: clipId => {
      if (!clipId || clipId === heardSource || align.known(clipId) || privateSession || !current) return;
      const song = current;
      invoke("music_stream", { id: clipId, preload: true })
        .then(result =>
          result?.url
            ? align.measure(clipId, { address: result.url, title: song.title, artists: song.artists })
            : 0,
        )
        .catch(() => {});
    },
    audios: decks.nodes,
    convertFileSrc: path => window.__TAURI__.core.convertFileSrc(path),
    dock,
    identity,
    artwork,
    info,
    like,
    transport,
    extras,
    queuePanel,
    button,
    cover,
    renderDockArtwork: updateDockArt,
    onArtist: showArtist,
    onDownload: () => downloadTrack(current),
    onHideSong: () => feedback(false),
    onHideArtist: () => feedback(true),
    onDismissQueue: () => {
      queueOpen = false;
      renderQueue();
    },
  });
  function showArtist(item) {
    openArtistPage({
      item,
      invoke,
      button,
      cover,
      onOpen: artist => {
        document.getElementById("music-now-playing")?.close();
        browseItem = artist;
        load("browse", artist.id, artist.title);
      },
    });
  }
  const library = createMusicLibrary({
    saved,
    button,
    cover,
    onOpen: showPlaylist,
    notify: status,
    commit: playlists => {
      try {
        const interestMixes = sanitizeInterestMixes(saved.interestMixes, playlists);
        saveMusicProfile(storage, { ...saved, playlists, interestMixes }, taste);
        saved.playlists = playlists;
        saved.interestMixes = interestMixes;
        interestPool = null;
        invalidateRecommendations();
        librarySidebar?.refresh();
        return true;
      } catch (error) {
        status(errorText(error), true);
        return false;
      }
    },
  });
  const interestUI = createInterestMixesUI({
    saved,
    button,
    cover,
    notify: status,
    onOpen: id => (id ? showInterestMix(id) : showPlaylist(null)),
    commit: interestMixes => {
      try {
        const normalized = sanitizeInterestMixes(interestMixes, saved.playlists, { strict: true });
        saveMusicProfile(storage, { ...saved, interestMixes: normalized }, taste);
        saved.interestMixes = normalized;
        interestPool = null;
        invalidateRecommendations();
        return true;
      } catch (error) {
        status(errorText(error), true);
        return false;
      }
    },
  });
  const saveToPlaylist = button(t("Add to playlist"), "playlist", () => {
    if (current) library.picker(current);
  });
  extras.insertBefore(saveToPlaylist, queueButton);
  const sound = createMusicSound({
    nodes: decks.nodes,
    storage,
    button,
    notify: status,
    getAudio: () => audio,
    onRateChange: () => {
      miniPlayer?.sync();
      dispatchEvent(new Event("music-rate-change"));
    },
    invoke,
    canSkip: () => !musicRoom?.isGuest(),
  });
  const orb = wireGlassOrb(dock.querySelector(".music-play-button"));
  wireGlassButtons();
  const ambient = createMusicAmbient({
    dock,
    sound,
    getAudio: () => audio,
    getTrack: () => current,
    nodes: decks.nodes,
    hasMini: () => !!miniPlayer?.isOpen,
    onLevels: levels => {
      miniPlayer?.ambient(levels);
      orb.energy(levels?.[0]);
    },
  });
  // Which upload of the song is heard, and how far it is shifted from the studio recording the lyrics are timed
  // on. Measured once per upload a few seconds into playback; another version of the song brings its own.
  const measureHeard = event => {
    const node = event.target;
    if (
      node !== audio ||
      !heardSource ||
      privateSession ||
      align.known(heardSource) ||
      node.paused ||
      node.currentTime < 4 ||
      !(node.duration - node.currentTime > 15) ||
      !current
    )
      return;
    const key = heardSource;
    align.measure(key, { audio: node, title: current.title, artists: current.artists }).catch(() => {});
  };
  document.addEventListener("timeupdate", measureHeard, true);
  const lyrics = createMusicLyrics({
    invoke,
    button,
    getTrack: () => current,
    getAudio: () => audio,
    getLatency: () => sound.latency(),
    isPrivate: () => privateSession,
    getShift: () => align.shift(heardSource),
  });
  // One Lyrics button: it shows the words wherever the player is, in the full player, the Now Playing
  // panel, or by opening the full player.
  const lyricsButton = button(t("Lyrics"), "music-notes", () => {
    if (presentation.toggleLyrics() || presentation.togglePreviewLyrics()) return;
    presentation.open();
  });
  lyricsButton.dataset.i18nTitle = "Lyrics";
  lyricsButton.dataset.i18nAriaLabel = "Lyrics";
  extras.insertBefore(lyricsButton, queueButton);
  lyricsButton.classList.add("music-stage-lyrics-trigger", "music-labeled-control");
  const lyricsLabel = el("span", "music-control-label", t("Lyrics"));
  lyricsButton.append(lyricsLabel);
  onLanguageChange(() => {
    lyricsLabel.textContent = t("Lyrics");
  });
  presentation.attachLyrics(lyrics, lyricsButton);
  // The mini-player gets lines only while its lyrics are switched on; it keeps that choice in shared storage.
  const miniLyricsOn = () => {
    try {
      return localStorage.getItem("deviload-mini-lyrics") === "1";
    } catch {
      return false;
    }
  };
  const lyricLines = wireLyricsLines({
    invoke,
    lyrics,
    audios: decks.nodes,
    isMiniOpen: () => !!miniPlayer?.isOpen && miniLyricsOn(),
    isRemoteOn: () => !!phoneRemote?.active,
  });
  window.addEventListener?.("storage", event => {
    if (event.key === "deviload-mini-lyrics") lyricLines.refresh();
  });
  // Lyrics on the desktop: from the lyrics toolbar, and from the player's More menu.
  const desktopTool = button(
    t("Lyrics on the desktop"),
    "monitor",
    () => lyricLines.toggle().catch(error => status(errorText(error))),
    "music-lyrics-desktop",
  );
  lyrics.addTool(desktopTool);
  // A picture of a sung line to share: from the lyrics tools, or a right click on a line.
  const lyricCard = createLyricCard({ invoke, button, lyrics, getSong: () => current });
  lyrics.addTool(lyricCard.button);
  wireTimeline({ seek, elapsed, duration, getAudio: () => audio, lyrics, time });
  wireHoverLight($("devil-music"));
  const syncDesktop = ({ open }) => {
    desktopTool.setAttribute("aria-pressed", String(open));
    desktopItem?.setAttribute("aria-pressed", String(open));
  };
  lyricLines.onChange(syncDesktop);
  // "Even out song volume": once per song and player, ask how loud the recording is and trim it.
  {
    const levelled = new WeakMap();
    const level = node => {
      if (
        !sound.levelling ||
        node !== audio ||
        !current ||
        isLocalMusicId(current.id) ||
        levelled.get(node) === current.id
      )
        return;
      const id = current.id;
      levelled.set(node, id);
      invoke("music_loudness", { id })
        .then(db => {
          if (levelled.get(node) === id) sound.setLevel(node, db);
        })
        .catch(() => {
          levelled.delete(node);
        });
    };
    for (const node of decks.nodes)
      for (const name of ["playing", "timeupdate"]) node.addEventListener(name, () => level(node));
  }
  // Optional pause while another app plays sound; a top-level choice in music settings, after Discord.
  wireMusicYield({
    invoke,
    host: $("music-preferences"),
    before: $("music-private-session").closest(".music-catalog-context"),
    audios: decks.nodes,
    isPlaying: () => !!current && !audio.paused,
    pause: () => {
      if (!audio.paused) audio.pause();
    },
    play: () => {
      if (audio.paused && !streamLoading) togglePlay();
    },
    notify: message => status(message),
  });
  // The person's own YouTube sign-in, used only when YouTube limits or refuses guest playback.
  // New likes in YouTube Music come over to Liked songs once a day when the person asks for it.
  const likesSync = createLikesSync({
    invoke,
    storage,
    notify: (message, error) => status(message, error),
    add: async entries => addFavorites(entries),
  });
  wireMusicAccount({
    invoke,
    host: $("music-preferences"),
    before: $("music-private-session").closest(".music-catalog-context"),
    addons: { youtube: likesSyncControls(likesSync) },
  });
  likesSync.maybe();
  setInterval(() => likesSync.maybe(), 3600000);
  // "What's playing?" from the microphone, beside the search it fills in.
  // Liking a song found by recognition: its best catalog match goes to Liked songs.
  const recognizer = wireMusicRecognize({
    invoke,
    form: $("music-search"),
    input: $("music-query"),
    notify: (message, error) => status(message, error),
    like: async song => {
      const result = await invoke("music_catalog", {
        kind: "search",
        value: `${song.title} ${song.artist}`.slice(0, 120),
        filter: "songs",
        language: language(),
      });
      const found = (result?.sections || [])
        .flatMap(section => section.items || [])
        .find(item => item?.kind === "song");
      if (!found) return false;
      const track = sanitizeMusicTrack(found);
      if (saved.favorites.some(value => value.id === track.id)) return true;
      if (!changeFavorite(track)) return false;
      syncDock();
      return true;
    },
  });
  // An opt-in API on this computer for overlays, Stream Deck and scripts.
  wireMusicControlApi({
    invoke,
    host: $("music-preferences"),
    before: $("music-private-session").closest(".music-catalog-context"),
    notify: (message, error) => status(message, error),
  });
  // Optional scrobbling to the person's own ListenBrainz or Last.fm profile.
  wireScrobbling({
    invoke,
    host: $("music-preferences"),
    before: $("music-profile"),
    nodes: decks.nodes,
    getAudio: () => audio,
    getTrack: () => current,
    isPrivate: () => privateSession,
    notify: message => status(message),
  });
  const sleep = createSleepTimer({
    onDim: value => decks.setDim(value),
    onExpire: () => {
      if (!audio.paused) audio.pause();
      status(t("Sleep timer paused playback."));
    },
    onChange: () => syncSleep(),
  });
  const sleepButton = button(t("Sleep timer"), "moon", () => {
    const box = sleepButton.getBoundingClientRect(),
      entries = [
        [t("After this track"), "moon", () => sleep.set("track")],
        ...SLEEP_MINUTES.map(minutes => [
          t("{minutes} minutes", { minutes }),
          "moon",
          () => sleep.set(minutes),
        ]),
      ];
    if (sleep.mode !== "off")
      entries.push(null, [t("Turn off sleep timer"), "x-circle", () => sleep.clear()]);
    showContextMenu(entries, box.left, box.top);
  });
  sleepButton.id = "music-sleep";
  function syncSleep() {
    const label = sleepLabel(sleep, t);
    if (sleepButton.ariaLabel !== label) sleepButton.title = sleepButton.ariaLabel = label;
    sleepButton.setAttribute("aria-pressed", String(sleep.mode !== "off"));
  }
  syncSleep();
  onLanguageChange(syncSleep);
  const soundButton = button(t("Sound and transitions"), "equalizer", () => sound.open());
  soundButton.dataset.i18nTitle = "Sound and transitions";
  soundButton.dataset.i18nAriaLabel = "Sound and transitions";
  soundButton.id = "music-sound-open";
  soundButton.append(el("span", "", t("Sound")));
  extras.insertBefore(soundButton, queueButton);
  const filters = el("div", "music-search-filters");
  filters.hidden = true;
  for (const [value, label] of [
    ["all", t("All results")],
    ["songs", t("Songs")],
    ["albums", t("Albums")],
    ["artists", t("Artists")],
  ]) {
    const node = button(
      label,
      null,
      () => {
        searchFilter = value;
        load("search", lastQuery.value);
      },
      "music-filter-chip",
    );
    node.dataset.filter = value;
    filters.append(node);
  }
  $("music-library-tools").before(filters);
  const offlineTab = button(t("Downloaded music"), null, showOffline, "music-filter-chip");
  document.querySelector(".music-tabs").append(offlineTab);
  let localItems = [],
    downloadedItems = [];
  const updateOffline = () => {
    offlineItems = tracks([...localItems, ...downloadedItems]);
    if (view === "offline") {
      sections = [
        { title: t("Downloaded music"), items: tracks(downloadedItems) },
        { title: t("Music on this device"), items: tracks(localItems) },
      ].filter(section => section.items.length);
      render();
    }
  };
  const localLibrary = createLocalLibrary({
    invoke,
    button,
    onChange: items => {
      localItems = items;
      updateOffline();
    },
  });
  const localOpen = button(
    t("Add local music"),
    "folder-open",
    () => localLibrary.open(),
    "outline small music-settings-open",
  );
  // A short name fits the narrow library column; the full one stays for the tooltip and screen readers.
  localOpen.append(el("span", "", t("Add files")));
  document.querySelector(".music-heading-actions").prepend(localOpen);
  $("music-discovery").value = taste.mode;
  $("music-public-discovery").checked = saved.publicDiscovery !== false;
  $("music-public-discovery").addEventListener("change", () => {
    const enabled = $("music-public-discovery").checked;
    try {
      saveMusicProfile(storage, { ...saved, publicDiscovery: enabled }, taste);
      saved.publicDiscovery = enabled;
      resetPublicDiscovery();
      invalidateRecommendations();
      radioAhead = null;
      if (view === "home" && homeCache) personalize(request, homeCache.sections);
      else if (view === "interest") showInterestMix(interestViewId);
    } catch (error) {
      $("music-public-discovery").checked = saved.publicDiscovery !== false;
      status(errorText(error), true);
    }
  });
  $("music-discovery").addEventListener("change", () => {
    taste.mode = $("music-discovery").value;
    persist();
    invalidateRecommendations();
    if (view === "home" && homeCache) personalize(request, homeCache.sections);
    else if (view === "interest") renderInterestPool();
  });
  $("music-restore-hidden").addEventListener("click", () => {
    taste.hiddenSongs = [];
    taste.blockedArtists = [];
    persist();
    invalidateRecommendations();
    if (view === "home" && homeCache) personalize(request, homeCache.sections);
    else if (view === "interest") renderInterestPool();
    status(t("Hidden recommendations restored."));
  });
  wirePlaybackSettings(invoke, { diagnostics });
  wireMusicImport({
    invoke,
    button,
    storage,
    // Songs already saved are matched from the library instead of searched again.
    library: () =>
      createLibraryIndex([...saved.favorites, ...(saved.playlists || []).flatMap(list => list.items || [])]),
    commit: async (batch, options) => {
      captureListening();
      const result = mergeMusicImport(saved, taste, batch, options);
      const committed = saveMusicProfile(storage, result.saved, result.taste);
      Object.assign(saved, result.saved);
      Object.assign(taste, result.taste);
      sourceRevision++;
      decks.clear();
      clearRecommendationContext();
      library.invalidateUndo();
      clock.reset();
      session++;
      checkpoint = 0;
      historyAdded = false;
      homeCache = null;
      radioCache.clear();
      radioAhead = null;
      showPlaylist(null);
      await committed;
      return result;
    },
  });
  wireMusicProfile({
    invoke,
    read: () => {
      captureListening();
      return { saved, taste };
    },
    restore: async profile => {
      const previousSource = current ? resolveRecordingSource(current, saved.sourceBindings).id : null,
        wasActive = !!current && (!audio.paused || streamLoading);
      const committed = saveMusicProfile(storage, profile.saved, profile.taste);
      Object.assign(saved, profile.saved);
      Object.assign(taste, profile.taste);
      library.invalidateUndo();
      sourceRevision++;
      decks.clear();
      interestPool = null;
      clearRecommendationContext();
      clock.reset();
      session++;
      checkpoint = 0;
      historyAdded = false;
      if (profile.saved.volumeBeforeMute === undefined) delete saved.volumeBeforeMute;
      decks.setVolume(saved.volume);
      previousVolume = musicGain(saved.volumeBeforeMute, saved.volume || 0.7);
      syncVolume();
      $("music-discovery").value = taste.mode;
      $("music-public-discovery").checked = saved.publicDiscovery !== false;
      homeCache = null;
      radioCache.clear();
      radioAhead = null;
      refreshCurrentRecording(previousSource, wasActive);
      syncDock();
      if (view === "library" || view === "playlist")
        showPlaylist(library.find(playlistId) ? playlistId : null);
      else if (["favorites", "recent"].includes(view)) showLocal(view);
      else if (view === "interest") showInterestMix(interestViewId);
      else if (view === "home") load("home");
      await committed;
    },
  });

  function chooseArtists() {
    openArtistPicker({
      invoke,
      button,
      cover,
      collections: () => saved.collections,
      save: items => {
        const collections = [
          ...saved.collections,
          ...items.filter(item => !saved.collections.some(x => x.id === item.id)),
        ];
        saveMusicProfile(storage, { ...saved, collections }, taste);
        saved.collections = collections;
        homeCache = null;
        load("home");
      },
    });
  }
  $("music-choose-artists").addEventListener("click", chooseArtists);
  $("music-private-session").addEventListener("change", () => {
    captureListening();
    if (statsSession !== session) statsCounted = false;
    privateSession = $("music-private-session").checked;
    clearRecommendationContext();
    discordPresence.sync(true);
    clock.reset();
    session++;
    statsSession = session;
    statsSeconds = 0;
    checkpoint = 0;
    historyAdded = false;
    if (view === "home" && homeCache) {
      sections = homeSections(homeCache.sections);
      render();
      personalize(request, homeCache.sections);
    } else if (view === "interest") showInterestMix(interestViewId);
  });
  function renderWeekly(root) {
    const value = weekly.summary();
    if (!value.totalMinutes) return;
    const card = el("section", "music-weekly-card");
    card.append(
      el("span", "music-eyebrow", t("YOUR LAST 7 DAYS")),
      el(
        "h4",
        "",
        t("{minutes} minutes · {plays} listens", {
          minutes: value.totalMinutes,
          plays: value.totalQualifiedPlays,
        }),
      ),
      el(
        "p",
        "",
        value.totalSeconds
          ? t("{tracks} tracks · Top artist: {artist}", {
              tracks: String(value.uniqueTracks) + (value.uniqueTracksCapped ? "+" : ""),
              artist: value.topArtist || t("Unknown artist"),
            })
          : t("Your listening summary will appear here. Only this device is counted."),
      ),
    );
    root.append(card);
  }
  function persist() {
    try {
      saveMusicProfile(storage, saved, taste);
    } catch {
      status(t("Could not save your music preferences."), true);
    }
  }
  function invalidateRecommendations() {
    ++personalization;
    ++recommendationRevision;
    // Prepared candidates stay raw: the next consume uses current preferences.
    // A newly preferred candidate may need its own speculative audio preparation.
    preloadAttempts = new Map();
  }
  function clearRecommendationContext() {
    resetPublicDiscovery();
    recommendationSession.reset();
    playbackContext = [];
    playbackOrigin = "manual";
    playbackSourceContext = { kind: "manual" };
    ++contextRevision;
    if (resumeSnapshot) {
      delete resumeSnapshot.sourceContext;
      delete resumeSnapshot.contextItems;
    }
    discoveryCandidates = [];
    interestPool = null;
    recommendationReasons.clear();
    clearRecommendationObservations();
    radioAhead = null;
    invalidateRecommendations();
    if (radioPending) {
      radioPending = false;
      status("");
      syncDock();
    }
    for (const timer of impressionTimers.values()) clearTimeout(timer);
    impressionTimers.clear();
    if (!privateSession) refreshRecommendationImpressions();
  }
  function selectionContext() {
    if (view === "interest")
      return {
        kind: "interest",
        id: interestViewId || "",
        label: saved.interestMixes.find(mix => mix.id === interestViewId)?.name || "",
      };
    if (view === "playlist")
      return { kind: "playlist", id: playlistId || "", label: getPlaylist(playlistId)?.name || "" };
    if (view === "search")
      return {
        kind: activeMood ? "mood" : "search",
        id: activeMood || lastQuery.value || "",
        label: lastQuery.heading || lastQuery.value || "",
      };
    if (view === "browse")
      return {
        kind: browseItem?.kind || "collection",
        id: browseItem?.id || lastQuery.value || "",
        label: browseItem?.title || lastQuery.heading || "",
      };
    if (lastQuery.kind === "radio" && view === "home")
      return { kind: "radio", id: lastQuery.value || "", label: lastQuery.heading || "" };
    return { kind: view || "manual", id: "", label: "" };
  }
  function setPlaybackContext(items, source = {}) {
    recommendationSession.setContext(items);
    playbackSourceContext = {
      kind: String(source.kind || "manual").slice(0, 40),
      id: String(source.id || "").slice(0, 160),
      label: String(source.label || "").slice(0, 240),
    };
    ++contextRevision;
    radioAhead = null;
    invalidateRecommendations();
  }
  function resetPublicDiscovery() {
    ++publicGeneration;
    nextHomeCandidates = [];
    publicDiscovery.clear();
  }
  function discoveryAllowed() {
    return (
      saved.publicDiscovery !== false &&
      !privateSession &&
      navigator.onLine !== false &&
      !navigator.connection?.saveData
    );
  }
  function publicCandidates({ seeds = [], artists = [], tags = [], isCurrent = () => true } = {}) {
    const generation = publicGeneration,
      sourceToken = sourceRevision;
    const live = () =>
      generation === publicGeneration && sourceToken === sourceRevision && discoveryAllowed() && isCurrent();
    if (!live()) return Promise.resolve([]);
    const sources = seeds.map(item => resolveRecordingSource(item, saved.sourceBindings));
    const hints = artists.length
      ? { artists: [...sources.map(item => item.artists?.[0]).filter(Boolean), ...artists] }
      : {};
    return publicDiscovery
      .candidates({ seeds: sources, ...hints, tags, language: language(), isCurrent: live })
      .catch(() => []);
  }
  function mergePublicPool(pool, items) {
    const combined = recommendationSession.mergePools([{ items: pool.items || [] }, { items }]),
      scores = new Map(pool.scores || []);
    items.forEach((item, index) =>
      scores.set(item.id, Math.max(scores.get(item.id) || 0, 0.75 / (1 + index / 10))),
    );
    return { ...pool, items: combined.items, scores };
  }
  function recommendationOptions(seed, limit = 15) {
    return {
      exclude: queue.map(item => item.id),
      limit,
      contextItems: tracks([seed, ...playbackContext, ...(!privateSession ? saved.recent : [])]).slice(0, 12),
      sessionItems: recommendationSession.preferenceItems(),
      followedArtists: (saved.collections || [])
        .filter(item => item.kind === "artist")
        .map(item => item.title),
      ...recommendationSession.options(),
    };
  }
  function rankRadioPool(pool, seed) {
    if (!pool) return [];
    return distinctSongs(
      rankMusicRecommendations(pool.items || [], saved, taste, {
        ...recommendationOptions(seed),
        queue,
        interestId: playbackSourceContext.kind === "interest" ? playbackSourceContext.id : null,
        candidateScores: pool.scores,
        random: () => 0.5,
        eligible: items => recommendationSession.allowed(items),
      }).map(row => row.item),
      [...(seed ? [seed] : []), ...playbackContext],
    );
  }
  function visibleRecommendation(node) {
    if (
      privateSession ||
      document.hidden ||
      document.hasFocus?.() === false ||
      recommendationIntersections.get(node) !== true ||
      !node.isConnected ||
      document.querySelector("main")?.dataset.page !== "music"
    )
      return false;
    const rect = node.getBoundingClientRect(),
      width = Math.min(innerWidth, rect.right) - Math.max(0, rect.left),
      bottom = innerHeight - (dock.hidden ? 0 : dock.offsetHeight),
      height = Math.min(bottom, rect.bottom) - Math.max(0, rect.top);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      Math.max(0, width) * Math.max(0, height) >= rect.width * rect.height * 0.5
    );
  }
  function scheduleRecommendationImpression(node, item) {
    clearTimeout(impressionTimers.get(node));
    impressionTimers.delete(node);
    if (!visibleRecommendation(node)) return;
    const revision = contextRevision;
    impressionTimers.set(
      node,
      setTimeout(() => {
        impressionTimers.delete(node);
        if (revision === contextRevision && visibleRecommendation(node))
          recommendationSession.markShown([item]);
      }, 500),
    );
  }
  function refreshRecommendationImpressions() {
    for (const [node, item] of recommendationNodes) scheduleRecommendationImpression(node, item);
  }
  function observeRecommendation(node, item) {
    if (typeof IntersectionObserver !== "function") return;
    if (!recommendationObserver)
      recommendationObserver = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            recommendationIntersections.set(
              entry.target,
              entry.isIntersecting === true && entry.intersectionRatio >= 0.5,
            );
            const item = recommendationNodes.get(entry.target);
            if (item) scheduleRecommendationImpression(entry.target, item);
          }
        },
        { threshold: [0, 0.5, 1] },
      );
    recommendationNodes.set(node, item);
    recommendationObserver.observe(node);
  }
  function clearRecommendationObservations() {
    recommendationObserver?.disconnect();
    recommendationNodes.clear();
    recommendationIntersections.clear();
    for (const timer of impressionTimers.values()) clearTimeout(timer);
    impressionTimers.clear();
  }
  function persistSession() {
    if (sessionTransition || privateSession || musicRoom?.isGuest()) return;
    try {
      saveMusicSession(storage, {
        queue,
        id: current?.id || null,
        position: resolvedTrack === current?.id ? audio.currentTime : retryPosition,
        duration: knownDuration,
        repeat,
        shuffle,
        autoplay,
        order: order.snapshot(queue),
      });
      sessionSavedAt = Date.now();
    } catch {
      status(t("Could not save your music preferences."), true);
    }
  }
  async function playbackSource(
    id,
    refresh = false,
    preload = false,
    decodeRecovery = false,
    exact = false,
    alternateId = null,
    automatic = false,
    canDispatch = null,
    recoverFromCache = false,
    retryAlternate = false,
  ) {
    if (isLocalMusicId(id))
      return localPlaybackSource(id, invoke, path => window.__TAURI__.core.convertFileSrc(path));
    const originalId = exact
      ? id
      : (saved.sourceBindings || []).find(binding => binding.trackId === id)?.source.id || id;
    const sourceId = alternateId || originalId;
    // Refresh after a failed local decoder must not reopen the same damaged
    // file. Without a connection, retain the normal local-only path instead.
    if (
      !retryAlternate &&
      window.__TAURI__?.core?.convertFileSrc &&
      !(decodeRecovery && navigator.onLine !== false)
    ) {
      const copy = exact ? null : getExactLocalCopy(storage, id, sourceId);
      if (copy) {
        try {
          const local = await exactLocalPlaybackSource(copy, invoke, path =>
            window.__TAURI__.core.convertFileSrc(path),
          );
          diagnostics.record(preload ? "preload" : "source", "offline");
          return local;
        } catch (error) {
          diagnostics.record(preload ? "preload" : "source", "failed");
          // The chosen file can disappear. An independent downloaded copy may still exist.
          if (navigator.onLine === false) {
            const path = await invoke("music_offline_source", { id: sourceId }).catch(() => null);
            if (!path) throw error;
            return { url: window.__TAURI__.core.convertFileSrc(path), offline: true };
          }
        }
      }
      try {
        const path = await invoke("music_offline_source", { id: sourceId });
        if (path) {
          diagnostics.record(preload ? "preload" : "source", "offline");
          return { url: window.__TAURI__.core.convertFileSrc(path), offline: true };
        }
      } catch (error) {
        diagnostics.record(preload ? "preload" : "source", "failed");
        if (navigator.onLine === false) throw error;
      }
    }
    if (navigator.onLine === false)
      throw Error("Music could not connect. Check your connection and proxy settings, then retry.");
    // Native cancellation is global. A newer selection must not dispatch ahead of an old cancellation.
    if (pendingLocalCancel) await pendingLocalCancel;
    if (canDispatch && !canDispatch()) throw new DOMException("Superseded", "AbortError");
    diagnostics.record(preload ? "preload" : "resolve", "requested");
    if (!preload && streamLoading) artist.textContent = t("Finding a playable source…");
    const useCache =
      automatic &&
      refresh &&
      recoverFromCache &&
      !preload &&
      !exact &&
      !decodeRecovery &&
      (!alternateId || retryAlternate);
    const result = await invoke("music_stream", {
      id: sourceId,
      refresh,
      preload,
      ...(automatic ? { automatic: true, originalId } : {}),
      ...(useCache ? { recoverFromCache: true } : {}),
      ...(retryAlternate ? { retryAlternate: true } : {}),
    });
    diagnostics.record(preload ? "preload" : "resolve", "ready");
    // The recording actually played, which is what community marks for skipping parts refer to.
    if (result && typeof result === "object") result.sourceId = sourceId;
    return result;
  }
  async function showOffline() {
    rememberNavigation({ type: "offline" });
    const token = ++request;
    listFilter = "";
    $("music-library-filter").value = "";
    selectView("offline");
    loading = false;
    $("music-refresh").disabled = false;
    status("");
    $("music-heading").textContent = t("Downloaded music");
    $("music-kicker").textContent = t("ON THIS DEVICE");
    skeleton();
    try {
      if (!window.__TAURI__?.core?.convertFileSrc)
        throw Error(t("Open the installed Deviload app to download."));
      const [items] = await Promise.all([invoke("music_downloaded", {}), localLibrary.load()]);
      if (token !== request) return;
      const known = [
        ...saved.favorites,
        ...saved.recent,
        ...(saved.playlists || []).flatMap(list => list.items),
      ];
      downloadedItems = items.map(item => {
        const binding = saved.sourceBindings.find(value => value.source.id === item.id);
        return known.find(value => value.id === (binding?.trackId || item.id)) || binding?.track || item;
      });
      updateOffline();
    } catch (error) {
      if (token === request) {
        sections = [];
        render();
        status(errorText(error), true);
      }
    }
  }
  function toggleCollection(item) {
    const exists = saved.collections.some(value => value.id === item.id);
    if (!exists && saved.collections.length >= 200) {
      status(t("Your library can hold up to 200 albums and artists."), true);
      return;
    }
    const collections = exists
      ? saved.collections.filter(value => value.id !== item.id)
      : [sanitizeMusicCollection(item), ...saved.collections];
    try {
      saveMusicProfile(storage, { ...saved, collections }, taste);
      saved.collections = collections;
      invalidateRecommendations();
      render();
    } catch (error) {
      status(errorText(error), true);
    }
  }
  function feedback(artist, item = current) {
    if (!item) return;
    const hiddenSongs = [...taste.hiddenSongs],
      blockedArtists = [...taste.blockedArtists];
    hideRecommendation(taste, item, artist);
    persist();
    invalidateRecommendations();
    const text = artist
      ? t("This artist will not appear in recommendations.")
      : t("This song will not appear in recommendations.");
    const shown = sections,
      allowed = recommendationAllowed(taste);
    presentation.notify(text, () => {
      taste.hiddenSongs = hiddenSongs;
      taste.blockedArtists = blockedArtists;
      persist();
      invalidateRecommendations();
      if (view === "home" && sections !== shown) {
        sections = shown;
        homeRefreshRevision = recommendationRevision;
        render();
      }
    });
    if (view === "home") {
      sections = shown.map(section => ({
        ...section,
        items: section.items.filter(entry => entry.kind !== "song" || allowed(entry)),
      }));
      homeRefreshRevision = recommendationRevision;
      render();
    }
  }
  let statusTimer = null;
  const statusMessages = new Set([t("Added to play next"), t("Added to play queue"), t("Song link copied")]);
  const toast = el("div", "music-feedback-toast");
  toast.setAttribute("role", "status");
  toast.hidden = true;
  document.body.append(toast);
  function status(text, isError = false) {
    if (!isError && statusMessages.has(text)) {
      toast.textContent = text;
      toast.hidden = false;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => (toast.hidden = true), 3200);
      return;
    }
    $("music-status").textContent = text;
    $("music-status").hidden = !text;
    $("music-status").classList.toggle("error", isError);
  }
  function refreshCurrentRecording(previousSource, wasActive) {
    if (!current || resolveRecordingSource(current, saved.sourceBindings).id === previousSource) return;
    ++playRequest;
    cancelResolution();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    knownDuration = 0;
    resolvedTrack = null;
    needsRefresh = true;
    streamLoading = false;
    retryPosition = 0;
    pendingSeek = 0;
    seek.value = "0";
    seek.disabled = true;
    elapsed.textContent = time(0);
    duration.textContent = time(0);
    if (wasActive) playAt(index, { refresh: true, transitionIntent: "navigation", origin: playbackOrigin });
  }
  function chooseRecording(item) {
    if (isLocalMusicId(item?.id)) return;
    const source = resolveRecordingSource(item, saved.sourceBindings);
    // A truncated download can report the duration of its first fragment as the entire song.
    const original = item;
    function currentPosition() {
      if (current?.id !== item.id) return 0;
      const position =
        resolvedTrack === item.id ? audio.currentTime : Math.max(retryPosition || 0, audio.currentTime || 0);
      return Number.isFinite(position) ? Math.max(0, position) : 0;
    }
    function restartChoice(sameTimeline) {
      if (current?.id !== item.id || musicRoom?.isGuest()) return;
      const resume = sameTimeline ? currentPosition() : 0;
      const shouldPlay = streamLoading || needsRefresh || !audio.paused;
      endSource = null;
      knownDuration = 0;
      recoveryUsed = false;
      alternateTried = false;
      cancelResolution();
      playAt(index, { resume, recovery: true, origin: playbackOrigin, autoplay: shouldPlay });
    }
    const local = {
      items: () => (localItems.length ? localItems : localLibrary.load()),
      choice: () => getExactLocalCopy(storage, item.id, source.id),
      save: async localItem => {
        await setExactLocalCopy(storage, item.id, source.id, localItem, invoke);
        ++sourceRevision;
        decks.clear();
        preloadAttempts.clear();
        nextPlan = null;
        if (resolveRecordingSource(item, saved.sourceBindings).id === source.id) restartChoice(true);
        return true;
      },
    };
    const resumeLabel = next => {
      const previous = resolveRecordingSource(original, saved.sourceBindings);
      const position = currentPosition();
      return position >= 1 && recordingMatch(previous, next).confidence === "high" ? time(position) : "";
    };
    openRecordingPicker({
      item: original,
      invoke,
      button,
      cover,
      bindings: () => saved.sourceBindings,
      local,
      resumeLabel,
      save: selected => {
        try {
          const previous = resolveRecordingSource(original, saved.sourceBindings);
          const track = sanitizeMusicTrack(original),
            choice = selected ? sanitizeMusicTrack(selected) : null;
          const bindings = choice
            ? setRecordingSource(saved.sourceBindings, track.id, choice)
            : removeRecordingSource(saved.sourceBindings, track.id);
          const sourceBindings = bindings.map(binding =>
            binding.trackId === track.id ? { ...binding, track } : binding,
          );
          saveMusicProfile(storage, { ...saved, sourceBindings }, taste);
          saved.sourceBindings = sourceBindings;
          ++sourceRevision;
          decks.clear();
          radioCache.clear();
          radioAhead = null;
          recommendationSession.forgetTrack(track.id);
          invalidateRecommendations();
          interestPool = null;
          if (current?.id === track.id) {
            const next = choice || track;
            const sameTimeline =
              previous.id === next.id || recordingMatch(previous, next).confidence === "high";
            restartChoice(sameTimeline);
          } else if (view === "home" && homeCache) personalize(request, homeCache.sections);
          if (view === "interest") showInterestMix(interestViewId);
          status(t("Source choice saved."));
          return true;
        } catch (error) {
          status(errorText(error), true);
          return false;
        }
      },
    });
  }
  // Every song of a playlist into downloads in one go, so the playlist plays without a connection.
  async function downloadPlaylist(list) {
    const items = tracks(list.items || [])
      .filter(item => !isLocalMusicId(item.id))
      .map(item => resolveRecordingSource(item, saved.sourceBindings));
    if (!items.length) return;
    try {
      if (!onDownload) throw new Error(t("Open the installed Deviload app to download."));
      const count = await onDownload(items);
      status(
        count
          ? t("Added to downloads: {count} songs. They will play offline once downloaded.", { count })
          : t("These links are already in the queue."),
      );
    } catch (error) {
      status(errorText(error), true);
    }
  }
  async function downloadTrack(item) {
    if (!item || isLocalMusicId(item.id) || downloadsPending.has(item.id)) return;
    downloadsPending.add(item.id);
    syncDock();
    const notify = text => {
      status(text);
      presentation.notify(text);
    };
    notify(t("Adding MP3 to downloads…"));
    try {
      if (!onDownload) throw new Error(t("Open the installed Deviload app to download."));
      const count = await onDownload(resolveRecordingSource(item, saved.sourceBindings));
      notify(
        count
          ? t("MP3 added to downloads: {title}", { title: item.title })
          : t("These links are already in the queue."),
      );
    } catch (error) {
      const text = errorText(error);
      status(text, true);
      presentation.notify(text);
    } finally {
      downloadsPending.delete(item.id);
      syncDock();
    }
  }
  function equalizer(item) {
    const disc = mountPictureDisc(el("span", "music-equalizer music-vinyl"));
    if (item?.id === current?.id) setPictureDiscArtwork(disc, item?.image, 96);
    return disc;
  }
  function markPlayback(node, id) {
    const active = Boolean(current && id === current.id);
    node.classList.toggle("active", active);
    node.classList.toggle("is-playing", active && !audio.paused && !streamLoading && audio.readyState >= 3);
    node.setAttribute("aria-current", String(active));
    const disc = node.querySelector(".music-vinyl");
    if (disc) setPictureDiscArtwork(disc, active ? current?.image : "", 96);
  }
  function syncDock() {
    dock.hidden = !current && document.querySelector("main").dataset.page !== "music";
    losslessBadge.hidden = !current?.lossless;
    ambient.update();
    if (dock.hidden && queueOpen) {
      queueOpen = false;
      renderQueue();
    }
    document.body.classList.toggle("has-music-player", !dock.hidden);
    play.replaceChildren(icon(streamLoading ? "spinner-gap" : audio.paused ? "play" : "pause"));
    play.classList.toggle("loading", streamLoading);
    play.title = play.ariaLabel = streamLoading ? t("Cancel loading") : audio.paused ? t("Play") : t("Pause");
    const liked = current && saved.favorites.some(item => item.id === current.id);
    like.textContent = liked ? "♥" : "♡";
    like.setAttribute("aria-pressed", String(Boolean(liked)));
    like.disabled = !current;
    downloadButton.disabled = !current || isLocalMusicId(current.id) || downloadsPending.has(current.id);
    shuffleButton.setAttribute("aria-pressed", String(shuffle));
    repeatButton.setAttribute("aria-pressed", String(repeat !== "off"));
    repeatButton.title = repeatButton.ariaLabel =
      repeat === "one" ? t("Repeat one song") : repeat === "all" ? t("Repeat queue") : t("Repeat off");
    repeatButton.dataset.repeat = repeat;
    saveToPlaylist.disabled = !current;
    play.disabled = !current && !queue.length;
    previous.disabled = index < 0;
    next.disabled = !current || radioPending || (!autoplay && plannedNext() < 0);
    document
      .querySelectorAll(".music-track-row,.music-card-song")
      .forEach(row => markPlayback(row, row.dataset.trackId));
    markPlayback(dock, current?.id);
    markPlayback(info, current?.id);
    presentation.update(current, Boolean(current && downloadsPending.has(current.id)), {
      playing: !audio.paused && !streamLoading,
      reason: recommendationReasons.has(current?.id)
        ? recommendationLabel(recommendationReasons.get(current.id), t)
        : "",
      duration: knownDuration || current?.duration || 0,
      offline: resolvedOffline,
    });
    if (view === "home")
      homeHero?.update(
        current ||
          saved.recent[0] ||
          saved.favorites[0] ||
          sections.flatMap(s => s.items).find(x => x.kind === "song"),
        !!current,
        !!current && !audio.paused,
      );
    miniPlayer?.sync();
    syncNativeControls();
    discordPresence.sync();
  }
  function syncNativeControls() {
    if (!window.__TAURI__?.core?.invoke) return;
    const playback = {
      active: Boolean(current),
      playing: !audio.paused,
      previousEnabled: !previous.disabled,
      playEnabled: !play.disabled,
      nextEnabled: !next.disabled,
      previousLabel: t("Previous track"),
      playLabel: audio.paused ? t("Play") : t("Pause"),
      nextLabel: t("Next track"),
    };
    const signature = JSON.stringify(playback);
    if (signature === nativeState) return;
    nativeState = signature;
    invoke("set_music_controls", { playback }).catch(() => {
      if (nativeState === signature) nativeState = "";
    });
  }
  function toggleLike() {
    if (!current) return;
    if (!changeFavorite(current)) return;
    syncDock();
    if (view === "favorites") showLocal("favorites");
  }
  // Several songs at once into Liked songs, newest first, leaving the page where it is. Returns how many were new.
  function addFavorites(entries) {
    const known = new Set(saved.favorites.map(value => value.id));
    const fresh = tracks(
      entries.flatMap(entry => {
        try {
          return [
            sanitizeMusicTrack({
              kind: "song",
              id: entry.videoId,
              title: entry.title,
              artists: entry.artists,
              subtitle: (Array.isArray(entry.artists) ? entry.artists : []).join(", "),
              image: entry.image,
            }),
          ];
        } catch {
          return [];
        }
      }),
    ).filter(item => !known.has(item.id));
    if (!fresh.length) return 0;
    const favorites = [...fresh, ...saved.favorites];
    saveMusicProfile(storage, { ...saved, favorites }, taste);
    saved.favorites = favorites;
    invalidateRecommendations();
    syncDock();
    if (view === "favorites") showLocal("favorites");
    return fresh.length;
  }
  function changeFavorite(item) {
    const favorites = saved.favorites.some(value => value.id === item.id)
      ? saved.favorites.filter(value => value.id !== item.id)
      : tracks([item, ...saved.favorites]);
    try {
      saveMusicProfile(storage, { ...saved, favorites }, taste);
      saved.favorites = favorites;
      invalidateRecommendations();
      return true;
    } catch (error) {
      status(errorText(error), true);
      return false;
    }
  }
  // A like changes the song's hearts and its menu entry, not the page. Re-rendering the whole list reset its
  // scroll, so the liked song seemed to jump away.
  function showLike(item) {
    const liked = saved.favorites.some(value => value.id === item.id),
      label = liked ? t("Remove from liked songs") : t("Like this song"),
      before = liked ? t("Like this song") : t("Remove from liked songs");
    for (const row of document.querySelectorAll(".music-track-row")) {
      if (row.dataset.trackId !== item.id) continue;
      for (const heart of row.querySelectorAll(".music-like")) {
        heart.textContent = liked ? "♥" : "♡";
        heart.setAttribute("aria-pressed", String(liked));
      }
      for (const option of row.querySelectorAll(".music-track-options button"))
        if (option.getAttribute("aria-label") === before) {
          option.setAttribute("aria-label", label);
          if (option.title) option.title = label;
          const text = option.querySelector(".music-menu-label");
          if (text) text.textContent = label;
        }
    }
  }
  function toggleShuffle() {
    if (shuffle && current) {
      const upcoming = order
          .preview(queue, index, repeat === "all", true, queue.length)
          .filter(item => item.id !== current.id),
        ids = new Set(upcoming.map(item => item.id));
      // Materialize the visible plan before switching to sequential playback.
      // Explicit next choices survive, and both windows keep the same sequence.
      queue = [...queue.filter(item => item.id !== current.id && !ids.has(item.id)), current, ...upcoming];
      index = queue.findIndex(item => item.id === current.id);
      order.reset(current.id);
    } else order.reset(current?.id, true);
    shuffle = !shuffle;
    nextPlan = null;
    renderQueue();
    syncDock();
    persistSession();
  }
  function displayedQueue() {
    if (!shuffle || !current) return queue;
    const available = playbackCandidates();
    return [
      current,
      ...order
        .preview(
          available,
          available.findIndex(item => item.id === current.id),
          repeat === "all",
          true,
          available.length,
        )
        .filter(item => item.id !== current.id),
    ];
  }
  function renderQueue() {
    queueList?.destroy();
    queueList = null;
    queuePanel.hidden = !queueOpen;
    queueButton.setAttribute("aria-expanded", String(queueOpen));
    presentation.syncQueueVisibility();
    queuePanel.replaceChildren();
    if (!queueOpen) return;
    const head = el("div", "music-queue-head");
    head.append(
      el("h3", "", t("Play queue")),
      el("span", "music-queue-count", t("{count} tracks", { count: queue.length })),
      button(t("Close"), "x-circle", closeQueue),
    );
    queuePanel.append(head);
    const option = el("label", "music-autoplay"),
      toggle = el("input", "");
    toggle.type = "checkbox";
    toggle.checked = autoplay;
    toggle.addEventListener("change", () => {
      autoplay = toggle.checked;
      if (!autoplay && radioPending) {
        ++playRequest;
        radioPending = false;
        status("");
      }
      syncDock();
      persistSession();
    });
    option.append(toggle, el("span", "", t("Keep playing similar music")));
    queuePanel.append(option);
    if (removed) {
      const undo = button(
        t("Undo removal"),
        "arrow-clockwise",
        () => {
          queue = restoreRemoved(queue, removed.item, removed.position);
          removed = null;
          syncQueue();
        },
        "music-queue-undo",
      );
      queuePanel.append(undo);
    }
    if (!queue.length) queuePanel.append(el("p", "music-empty-copy", t("Pick a song to start your queue.")));
    const upcoming = queue[plannedNext()]?.id,
      shown = displayedQueue();
    const list = el("div", "music-queue-list");
    queuePanel.append(list);
    const renderRow = (item, position) => {
      const row = el("div", "music-queue-track");
      row.dataset.trackId = item.id;
      row.draggable = true;
      row.classList.toggle("active", item.id === current?.id);
      row.classList.toggle("up-next", item.id === upcoming);
      const select = button(
        item.title,
        null,
        () => playAt(queue.findIndex(track => track.id === item.id)),
        "music-queue-select",
      );
      const copy = el("span", "music-queue-copy");
      copy.append(el("strong", "", item.title), el("small", "", displaySubtitle(item)));
      select.replaceChildren(cover(item, "", 96), copy);
      if (item.id === current?.id) row.setAttribute("aria-current", "true");
      if (item.id === upcoming) row.dataset.next = t("Playing next");
      const category =
        item.id === current?.id
          ? t("Now playing")
          : automaticQueueIds.has(item.id)
            ? t("Recommendations")
            : t("Added by you");
      row.dataset.category = category;
      row.setAttribute("aria-label", category + ": " + item.title);
      const note =
        item.id === upcoming
          ? t("Playing next")
          : item.id === current?.id || automaticQueueIds.has(item.id)
            ? category
            : "";
      if (note) {
        const provenance = el("small", "music-queue-provenance", note);
        provenance.title = category;
        copy.append(provenance);
      }
      const actions = el("div", "music-queue-actions");
      const handle = button(t("Drag to reorder. Alt + ↑/↓ to move."), null, () => {}, "music-queue-handle"),
        remove = button(t("Remove from queue"), "x-circle", () => removeTrack(item.id));
      handle.textContent = "⠿";
      handle.draggable = true;
      handle.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
      wireQueueHandle(handle, row, queuePanel, item.id, move);
      handle.addEventListener("keydown", event => {
        if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          move(
            item.id,
            Math.max(0, Math.min(shown.length - 1, position + (event.key === "ArrowUp" ? -1 : 1))),
          );
          queuePanel
            .querySelector(`[data-track-id="${item.id}"] .music-queue-handle`)
            ?.focus({ preventScroll: true });
        }
      });
      const download = button(t("Download MP3"), "download-simple", () => downloadTrack(item));
      if (isLocalMusicId(item.id)) download.hidden = true;
      actions.append(download, remove, handle);
      row.append(select, actions);
      row.addEventListener("dragstart", event => {
        dragged = item.id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-devil-music-queue", item.id);
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => {
        dragged = null;
        row.classList.remove("dragging");
        queuePanel.querySelectorAll(".drop-target").forEach(node => node.classList.remove("drop-target"));
      });
      row.addEventListener("dragover", event => {
        if (dragged && dragged !== item.id) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          queuePanel.querySelectorAll(".drop-target").forEach(node => {
            if (node !== row) node.classList.remove("drop-target");
          });
          row.classList.add("drop-target");
        }
      });
      row.addEventListener("dragleave", event => {
        if (!row.contains(event.relatedTarget)) row.classList.remove("drop-target");
      });
      row.addEventListener("drop", event => {
        event.preventDefault();
        const id = dragged;
        dragged = null;
        if (id) move(id, position);
      });
      return row;
    };
    queueList = mountMusicList(list, shown, renderRow);
  }
  function syncQueue() {
    const retained = new Set(queue.map(item => item.id));
    for (const id of automaticQueueIds) if (!retained.has(id)) automaticQueueIds.delete(id);
    index = current ? queue.findIndex(item => item.id === current.id) : -1;
    nextPlan = null;
    renderQueue();
    syncDock();
    persistSession();
  }
  function playNext(item) {
    if (item.id === current?.id) return;
    automaticQueueIds.delete(item.id);
    queue = insertNext(queue, current?.id, item);
    order.enqueue(item.id);
    syncQueue();
    status(t("Added to play next"));
  }
  function move(id, position) {
    if (shuffle) {
      if (id === current?.id) return;
      const shown = reorderTrack(displayedQueue(), id, Math.max(1, position));
      order.plan(shown.filter(item => item.id !== current?.id).map(item => item.id));
    } else {
      queue = reorderTrack(queue, id, position);
      order.sequential();
    }
    automaticQueueIds.delete(id);
    syncQueue();
    queuePanel.querySelector(`[data-track-id="${id}"] .music-queue-select`)?.focus();
  }
  function removeTrack(id) {
    const position = queue.findIndex(item => item.id === id);
    if (position < 0) return;
    const following = current?.id === id ? queue[plannedNext()]?.id : null;
    removed = { item: queue[position], position };
    queue = queue.filter(item => item.id !== id);
    if (current?.id === id) {
      if (queue.length)
        playAt(
          following && following !== id && queue.some(item => item.id === following)
            ? queue.findIndex(item => item.id === following)
            : Math.min(position, queue.length - 1),
        );
      else {
        captureListening(false, "navigation");
        ++playRequest;
        cancelResolution();
        clearTimeout(bufferingTimer);
        bufferingTimer = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        current = null;
        resolvedTrack = null;
        streamLoading = false;
        radioPending = false;
        clock.reset();
        seek.disabled = true;
        seek.value = "0";
        elapsed.textContent = duration.textContent = "0:00";
        title.textContent = t("Pick your first track");
        artist.textContent = t("Your soundtrack starts here");
        updateDockArt(null);
      }
    }
    syncQueue();
  }
  function captureListening(skipped = false, transitionIntent = "checkpoint") {
    if (!current || privateSession || musicRoom?.isGuest()) return;
    if (clock.seconds > 0 && !historyAdded) {
      saved.recent = remember(saved.recent, current);
      historyAdded = true;
    }
    if (statsSession !== session) {
      statsSession = session;
      statsSeconds = 0;
      statsCounted = false;
    }
    const delta = Math.max(0, clock.seconds - statsSeconds),
      qualified =
        !statsCounted &&
        (clock.seconds >= 30 || (audio.duration > 0 && clock.seconds / audio.duration >= 0.8));
    const familiar =
      qualified || transitionIntent === "next" ? recommendationFamiliarity(current, saved, taste) : undefined;
    if (delta > 0 || qualified) {
      weekly.record({ item: current, seconds: delta, qualified });
      librarySidebar?.refreshStats();
    }
    statsSeconds = clock.seconds;
    statsCounted ||= qualified;
    if (delta > 0 || qualified)
      recommendationSession.recordListen(current, {
        seconds: clock.seconds,
        duration: audio.duration,
        session,
        familiar,
      });
    if (transitionIntent === "next")
      recommendationSession.recordSkip(current, {
        seconds: clock.seconds,
        duration: audio.duration,
        session,
        intent: "next",
        familiar,
      });
    if (
      current &&
      recordListening(taste, current, {
        seconds: clock.seconds,
        duration: audio.duration,
        skipped,
        session,
        intent: transitionIntent,
      })
    ) {
      ++listeningRevision;
      const interestId = playbackSourceContext.kind === "interest" ? playbackSourceContext.id : null;
      const heard = clock.seconds >= 30 || (audio.duration > 0 && clock.seconds / audio.duration >= 0.8);
      const contextual =
        playbackOrigin === "recommendation" ||
        recommendationSession.contextItems().some(item => item.id === current.id);
      if (interestId && heard && contextual) {
        const interestMixes = rememberInterestTrack(saved.interestMixes, interestId, current.id);
        if (interestMixes !== saved.interestMixes) {
          try {
            saveMusicProfile(storage, { ...saved, interestMixes }, taste);
            saved.interestMixes = interestMixes;
            return;
          } catch {
            /* Optional mix learning must not prevent the normal profile from saving. */
          }
        }
      }
      persist();
    }
  }
  function recordingFamily(id) {
    if (recordingRoutingRevision !== sourceRevision) {
      recordingRoutingRevision = sourceRevision;
      recordingFamilies.clear();
      recordingBoundIds = new Set(
        saved.sourceBindings.flatMap(binding => [binding.trackId, binding.source.id]),
      );
    }
    if (!recordingBoundIds.has(id)) return [id];
    if (!recordingFamilies.has(id)) {
      const family = recordingFamilyIds(id, saved.sourceBindings);
      for (const value of family) recordingFamilies.set(value, family);
    }
    return recordingFamilies.get(id);
  }
  function playbackCandidates() {
    return eligiblePlaybackCandidates(queue, {
      automatic: automaticQueueIds,
      currentId: current?.id,
      hidden: taste.hiddenSongs,
      blocked: taste.blockedArtists,
      family: recordingFamily,
      source: item => resolveRecordingSource(item, saved.sourceBindings),
      artistKey: canonicalArtistKey,
      allowed: items => recommendationSession.allowed(items),
    });
  }
  function plannedNext() {
    // The queue is replaced on edits; playback ticks do not need to serialize
    // thousands of unchanged manual entries just to reuse the same next song.
    if (
      !automaticQueueIds.size &&
      nextPlan?.manual &&
      nextPlan.queue === queue &&
      nextPlan.currentId === current?.id &&
      nextPlan.repeat === repeat &&
      nextPlan.shuffle === shuffle &&
      nextPlan.sourceRevision === sourceRevision
    )
      return nextPlan.position;
    const available = playbackCandidates();
    const signature = JSON.stringify([
      current?.id,
      available.map(item => item.id),
      repeat,
      shuffle,
      sourceRevision,
    ]);
    if (nextPlan?.signature !== signature) {
      const position = order.next(
        available,
        available.findIndex(item => item.id === current?.id),
        repeat === "all",
        shuffle,
      );
      const id = available[position]?.id;
      nextPlan = {
        signature,
        id,
        queue,
        manual: !automaticQueueIds.size,
        currentId: current?.id,
        repeat,
        shuffle,
        sourceRevision,
        position: id ? queue.findIndex(item => item.id === id) : -1,
      };
    }
    return nextPlan.id ? queue.findIndex(item => item.id === nextPlan.id) : -1;
  }
  function miniQueue() {
    if (!current || musicRoom?.isGuest()) return [];
    const available = playbackCandidates();
    return order
      .preview(
        available,
        available.findIndex(item => item.id === current.id),
        repeat === "all",
        shuffle,
        32,
      )
      .map(item => ({ id: item.id, title: item.title, artist: displaySubtitle(item) }));
  }
  function cancelResolution(preserve = false) {
    intent.leave();
    return invoke("music_cancel_stream", { preserve }).catch(() => {});
  }
  function preloadNext() {
    if (musicRoom?.isGuest()) return;
    // Resolve one upcoming song and cache its first audio chunk in the relay.
    // Prepare early enough for the Next button, within the five-minute cache life.
    const remaining = audio.duration - audio.currentTime;
    if (
      !current ||
      streamLoading ||
      radioPending ||
      audio.paused ||
      audio.seeking ||
      !canPrepareAudio(audio) ||
      navigator.onLine === false ||
      navigator.connection?.saveData ||
      !Number.isFinite(remaining) ||
      remaining <= 0 ||
      remaining > 240 ||
      audio.currentTime < 2
    )
      return;
    if (repeat === "one") return;
    const position = plannedNext();
    if (position < 0 && autoplay && !radioAhead) {
      const token = playRequest,
        revision = contextRevision,
        plan = { token, revision, pool: null, promise: null };
      radioAhead = plan;
      plan.promise = radioCandidates(current).then(pool => {
        plan.pool = pool;
        if (token === playRequest && revision === contextRevision) preloadNext();
        return pool;
      });
      plan.promise.catch(() => {
        /* Keep the current song playing if discovery fails. */
      });
      return;
    }
    const revision = recommendationRevision;
    if (
      position < 0 &&
      autoplay &&
      radioAhead?.revision === contextRevision &&
      radioAhead.prefetchRevision !== revision
    ) {
      radioAhead.prefetchCandidate = rankRadioPool(radioAhead.pool, current)[0] || null;
      radioAhead.prefetchRevision = revision;
    }
    const automatic =
      position < 0 && autoplay && radioAhead?.revision === contextRevision
        ? radioAhead.prefetchCandidate
        : null;
    const candidate = () =>
      queue[plannedNext()] ||
      (autoplay && revision === recommendationRevision && radioAhead?.revision === contextRevision
        ? automatic
        : null);
    const id = candidate()?.id;
    if (!id || id === current.id) return;
    const attempted = preloadAttempts.get(id);
    if (attempted && Date.now() < attempted.retryAt) return;
    const token = playRequest,
      sourceToken = sourceRevision;
    // Queue edits may replace the speculative song, but rapid editing must not
    // produce an unbounded burst. A later timeupdate retries when budget returns.
    const now = Date.now();
    preloadWindow = preloadWindow.filter(at => now - at < 30000);
    if (preloadWindow.length >= 3) return;
    const attempt = { count: (attempted?.count || 0) + 1, retryAt: Infinity };
    preloadWindow.push(now);
    preloadAttempts.set(id, attempt);
    const preparation = { token, id, sourceToken };
    preloadPending = preparation;
    const job = Promise.resolve().then(() => {
      if (token !== playRequest || sourceToken !== sourceRevision || audio.paused || candidate()?.id !== id)
        return;
      return playbackSource(id, false, true);
    });
    // Foreground selections can cancel extraction in the backend. They reopen
    // through the cache so expired or failed sources are rechecked.
    job
      .then(result => {
        if (token !== playRequest || sourceToken !== sourceRevision) return;
        if (preloadPending !== preparation || candidate()?.id !== id) {
          if (preloadAttempts.get(id) === attempt) preloadAttempts.delete(id);
          return;
        }
        if (result && canPrepareAudio(audio) && !audio.paused)
          sound.setSource(decks.warm(id, result.url), result.offline === true);
        // Pausing or losing the current buffer must not permanently consume the
        // preparation. A later tick can reuse the cached source within the budget.
        else if (preloadAttempts.get(id) === attempt) preloadAttempts.delete(id);
      })
      .catch(error => {
        // One delayed retry for transport failures only. Limits, verification and
        // unavailable tracks must not produce background retry storms.
        if (
          token === playRequest &&
          sourceToken === sourceRevision &&
          preloadAttempts.get(id) === attempt &&
          attempt.count < 2 &&
          ["network", "timeout"].includes(playbackFailure(error).code)
        )
          attempt.retryAt = Date.now() + 5000;
      })
      .finally(() => {
        if (preloadPending === preparation) preloadPending = false;
      });
  }
  async function startAudio() {
    diagnostics.record("start", "requested");
    sound.resume();
    let timer;
    try {
      await Promise.race([
        audio.play(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Audio did not start in time. Press play to retry.")),
            20000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function canTryEquivalent(original) {
    return (
      !alternateTried &&
      original &&
      !isLocalMusicId(original.id) &&
      Number.isFinite(original.duration) &&
      original.duration > 0 &&
      original.artists?.length &&
      playbackOrigin !== "room" &&
      !musicRoom?.isGuest() &&
      resolveRecordingSource(original, saved.sourceBindings)?.id === original.id &&
      !getExactLocalCopy(storage, original.id, original.id)
    );
  }
  function recoveryLocalSource(original, prepareOnly = false) {
    function verify() {
      let timer;
      const deadline = new Promise(resolve => {
        timer = setTimeout(() => resolve(null), 1500);
      });
      return Promise.race([findLocalRecording(original, invoke), deadline])
        .catch(() => null)
        .finally(() => clearTimeout(timer));
    }
    if (
      recoveryLocal?.track === original &&
      recoveryLocal.session === session &&
      recoveryLocal.revision === sourceRevision
    ) {
      // A resumed remote source may have played for minutes before its next fault.
      // Recheck a previously found file before use, but never repeat a negative lookup.
      return recoveryLocal.remoteAccepted
        ? recoveryLocal.result.then(file => (file ? verify() : null))
        : recoveryLocal.result;
    }
    const result = verify();
    const entry = { track: original, session, revision: sourceRevision, result };
    recoveryLocal = entry;
    // A warmed path can change before failure. Reuse work still in flight, or reverify a completed positive.
    if (prepareOnly)
      result.then(file => {
        if (file) entry.remoteAccepted = true;
      });
    return result;
  }
  function watchCurrentBuffer() {
    if (
      !current ||
      !currentEndSource() ||
      endSource.hinted ||
      resolvedOffline ||
      streamLoading ||
      audio.paused ||
      audio.seeking ||
      audio.ended ||
      recoveryUsed ||
      playbackOrigin === "room" ||
      musicRoom?.isGuest() ||
      navigator.connection?.saveData ||
      !Number.isFinite(audio.duration) ||
      audio.currentTime < 4 ||
      audio.duration - audio.currentTime < 8
    )
      return;
    const pos = audio.currentTime,
      ahead = bufferedSeconds(audio);
    if (ahead >= 5) {
      endSource.runway = { pos, end: pos + ahead, at: performance.now() };
      return;
    }
    const prior = endSource.runway;
    if (
      !prior ||
      ahead > 2.5 ||
      pos - prior.pos < 2 ||
      performance.now() - prior.at < 2000 ||
      pos + ahead > prior.end + 0.35 ||
      !canTryEquivalent(current)
    )
      return;
    const token = playRequest,
      original = current,
      revision = sourceRevision;
    const atRisk = () =>
      token === playRequest &&
      revision === sourceRevision &&
      current === original &&
      currentEndSource() &&
      endSource.runway === prior &&
      !audio.paused &&
      !audio.seeking &&
      !audio.ended &&
      !streamLoading &&
      audio.duration - audio.currentTime >= 8 &&
      bufferedSeconds(audio) <= 2.5 &&
      audio.currentTime + bufferedSeconds(audio) <= prior.end + 0.35 &&
      canTryEquivalent(original);
    endSource.hinted = true;
    recoveryLocalSource(original, true).then(file => {
      if (!file && !navigator.connection?.saveData && atRisk()) recoveryCatalogMatch(original, atRisk);
    });
  }
  function recoveryCatalogMatch(original, mayStart = null) {
    const token = playRequest,
      revision = sourceRevision;
    if (recoveryCatalog?.token === token && recoveryCatalog.revision === revision) {
      if (!mayStart) recoveryCatalog.required = true;
      else recoveryCatalog.mayStart = mayStart;
      return recoveryCatalog.result;
    }
    const hint = {
      token,
      revision,
      original,
      session,
      mayStart,
      required: !mayStart,
      prepared: !!mayStart,
      expired: false,
    };
    recoveryCatalog = hint;
    const active = () =>
      !hint.expired &&
      hint === recoveryCatalog &&
      hint.token === playRequest &&
      hint.session === session &&
      revision === sourceRevision &&
      current === original &&
      !musicRoom?.isGuest() &&
      navigator.onLine !== false;
    const permitted = () =>
      active() && (hint.required || (!navigator.connection?.saveData && hint.mayStart()));
    async function lookup() {
      if (!permitted() || (await invoke("music_recovery_allowed", { id: original.id })) !== true) return null;
      if (!permitted()) {
        if (hint === recoveryCatalog && !hint.required) recoveryCatalog = null;
        return null;
      }
      const value = [...(original.artists.join(" ") + " " + original.title)].slice(0, 120).join("");
      const packet = await invoke("music_catalog", {
        kind: "search",
        value,
        filter: "songs",
        language: language(),
        originalId: original.id,
      });
      return active()
        ? singleCatalogMatch(
            original,
            (packet.sections || []).flatMap(section => section.items || []),
          )
        : null;
    }
    let timer;
    const deadline = new Promise(resolve => {
      timer = setTimeout(() => {
        hint.expired = true;
        resolve(null);
      }, 8000);
    });
    hint.result = Promise.race([lookup(), deadline])
      .catch(() => null)
      .finally(() => clearTimeout(timer));
    return hint.result;
  }
  function attemptEquivalent(code, resume) {
    const original = current,
      token = playRequest,
      revision = sourceRevision;
    if (code === "cancelled" || !canTryEquivalent(original)) return null;
    const online = ["network", "timeout", "decode", "unsupported"].includes(code);
    if (!online) recoveryCatalog = null;
    if (
      !online &&
      ![
        "restricted",
        "limited",
        "pending",
        "verification_required",
        "verification_rejected",
        "protection_unknown",
        "invalid_response",
      ].includes(code)
    )
      return null;
    let expired = false,
      timer;
    const active = () =>
      !expired &&
      token === playRequest &&
      revision === sourceRevision &&
      current === original &&
      !musicRoom?.isGuest();
    alternateTried = true;
    streamLoading = true;
    retryPosition = resume;
    audio.pause();
    syncDock();
    async function lookup() {
      const localResult = await recoveryLocalSource(original);
      if (!active()) return null;
      if (localResult) return { localResult };
      if (!online || navigator.onLine === false) return null;
      const match = await recoveryCatalogMatch(original);
      if (!active()) return null;
      // An authoritative denial may arrive while the original retry is playing or the catalog query is in flight.
      if (
        match &&
        recoveryCatalog?.prepared &&
        ((await invoke("music_recovery_allowed", { id: original.id })) !== true || !active())
      )
        return null;
      return match && (match.duration ?? match.durationSeconds) > resume ? { alternateId: match.id } : null;
    }
    return (async () => {
      try {
        const deadline = new Promise(resolve => {
          timer = setTimeout(() => {
            expired = true;
            resolve(null);
          }, 8000);
        });
        const source = await Promise.race([lookup(), deadline]);
        clearTimeout(timer);
        if (!active() || !source) return token !== playRequest;
        // playAt retains the logical queue entry. The physical ID / file applies only to this attempt.
        recoveryUsed = true;
        await playAt(index, { recovery: true, automatic: true, ...source, resume, origin: playbackOrigin });
        return true;
      } catch {
        return token !== playRequest;
      } finally {
        clearTimeout(timer);
        if (token === playRequest) {
          streamLoading = false;
          syncDock();
        }
      }
    })();
  }
  async function playAt(
    position,
    {
      refresh = false,
      resume = 0,
      recovery = false,
      decodeRecovery = false,
      overlap = 0,
      skipped = false,
      transitionIntent = "navigation",
      origin = "manual",
      autoplay = true,
      automatic = false,
      raceLocal = false,
      transportFault = false,
      alternateId = null,
      localResult = null,
      retryAlternate = false,
    } = {},
  ) {
    if (origin !== "room" && roomControlsPlayback()) return;
    if (!queue[position]) return;
    changeSource.hidden = true;
    if (resumeSnapshot && current && resumeSnapshot.item.id === current.id)
      resumeSnapshot.position = resolvedTrack === current.id ? audio.currentTime : retryPosition;
    intent.leave();
    if (!recovery) {
      captureListening(skipped, transitionIntent);
      clock.reset();
      session++;
      checkpoint = 0;
      historyAdded = false;
      recoveryUsed = false;
      alternateTried = false;
      playbackOrigin = origin;
      if (origin === "manual") {
        automaticQueueIds.delete(queue[position].id);
        recommendationSession.recover(queue[position].id);
        if (
          transitionIntent === "navigation" &&
          !recommendationSession.contextItems().some(item => item.id === queue[position].id)
        ) {
          setPlaybackContext([queue[position]], { kind: "manual" });
        }
      }
    }
    diagnostics.record(recovery ? "recovery" : "source", "requested");
    sessionTransition = true;
    const prepared =
      !alternateId && !localResult && !refresh && origin !== "room"
        ? decks.take(queue[position].id, saved.volume, overlap)
        : null;
    if (prepared) audio = prepared;
    else decks.clear();
    if (current?.id !== queue[position].id) knownDuration = 0;
    const token = ++playRequest;
    index = position;
    current = queue[index];
    order.visit(current.id, queue);
    resolvedTrack = null;
    resolvedOffline = false;
    radioPending = false;
    retryPosition = resume;
    if (recoveryCatalog) {
      const hint = recoveryCatalog;
      if (
        automatic &&
        transportFault &&
        !alternateId &&
        !localResult &&
        hint.original === current &&
        hint.session === session &&
        hint.token === token - 1 &&
        hint.revision === sourceRevision &&
        !navigator.connection?.saveData
      )
        hint.token = token;
      else recoveryCatalog = null;
    }
    nextPlan = null;
    preloadAttempts = new Map();
    preloadWindow = [];
    preloadPending = false;
    radioAhead = null;
    clearTimeout(bufferingTimer);
    bufferingTimer = null;
    if (!prepared) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    seek.disabled = true;
    seek.value = knownDuration ? String((resume / knownDuration) * 1000) : "0";
    elapsed.textContent = time(resume);
    duration.textContent = time(knownDuration);
    title.textContent = current.title;
    artist.title = "";
    artist.textContent = t("Opening track…");
    updateDockArt(current);
    status("");
    pendingSeek = resume;
    streamLoading = true;
    syncDock();
    renderQueue();
    sessionTransition = false;
    persistSession();
    let playbackStage = "resolve",
      offlineSource = false;
    try {
      const id = current.id,
        revision = sourceRevision;
      let localWon = false;
      const canDispatch = () => token === playRequest && !localWon;
      // Coalesce clicks in the same turn, but never await a superseded track.
      const job = Promise.resolve().then(() => {
        if (token !== playRequest) throw new DOMException("Superseded", "AbortError");
        // Activate a prepared source in the engine as well as the decoder.
        // This adopts its initial buffer and starts the full continuation.
        return (
          localResult ||
          playbackSource(
            id,
            refresh,
            false,
            decodeRecovery,
            origin === "room",
            alternateId,
            automatic,
            canDispatch,
            transportFault && autoplay,
            retryAlternate,
          )
        );
      });
      let result;
      if (raceLocal && autoplay && canTryEquivalent(current)) {
        let primarySettled = false;
        job.then(
          () => {
            primarySettled = true;
          },
          () => {
            primarySettled = true;
          },
        );
        const pending = () =>
          !primarySettled && canDispatch() && revision === sourceRevision && canTryEquivalent(current);
        const probe = recoveryLocalSource(current).then(file => {
          // Metadata only. Until the current route fails, no alternate audio request is dispatched.
          if (!file && transportFault && !navigator.connection?.saveData && pending())
            recoveryCatalogMatch(current, pending);
          return file ? { verifiedLocal: file } : job;
        });
        const cache = recoveryLocal;
        const first = await Promise.race([job, probe]);
        if (token !== playRequest) return;
        if (first.verifiedLocal && revision === sourceRevision && canTryEquivalent(current)) {
          localWon = true;
          alternateTried = true;
          localResult = first.verifiedLocal;
          const cancelled = cancelResolution();
          pendingLocalCancel = cancelled;
          cancelled.then(() => {
            if (pendingLocalCancel === cancelled) pendingLocalCancel = null;
          });
          result = localResult;
        } else {
          result = first.verifiedLocal ? await job : first;
          cache.remoteAccepted = true;
        }
      } else result = await job;
      if (token !== playRequest) return;
      offlineSource = result.offline === true;
      resolvedOffline = offlineSource;
      if (!prepared || audio.src !== result.url) audio.src = result.url;
      else {
        knownDuration = audio.duration;
        if (resume > 0 && Number.isFinite(audio.duration)) {
          audio.currentTime = Math.min(resume, Math.max(0, audio.duration - 1));
          pendingSeek = 0;
        }
      }
      // Only decoder metadata for this recording is evidence of its end. A
      // refreshed transport can contain a shorter prefix of the same recording.
      endSource = {
        token,
        url: audio.src,
        since: performance.now(),
        duration: recovery && endSource?.track === id ? endSource.duration : 0,
        track: id,
        minimumResume: alternateId || localResult ? resume : 0,
        alternateRetry:
          alternateId && !retryAlternate && !offlineSource
            ? { id: alternateId, revision: sourceRevision, initialSeek: false }
            : null,
      };
      if (prepared && audio.currentSrc === audio.src) rememberMediaDuration();
      sound.setSource(audio, offlineSource, result.sourceId);
      heardSource = offlineSource || localResult ? null : result.sourceId || null;
      resolvedTrack = current.id;
      playbackStage = "start";
      diagnostics.record("start", "ready");
      artist.textContent = t("Starting audio…");
      if (autoplay) await startAudio();
      if (token !== playRequest || resolvedTrack !== id) return;
      needsRefresh = false;
      artist.textContent = displaySubtitle(current) || "YouTube Music";
      status("");
      if (!musicRoom?.isGuest()) recommendationSession.recover(current.id);
    } catch (error) {
      if (token !== playRequest) return;
      const failure = playbackFailure(error);
      diagnostics.record(playbackStage, failure.code);
      if (
        !isLocalMusicId(current.id) &&
        !offlineSource &&
        !recoveryUsed &&
        navigator.onLine !== false &&
        ["timeout", "network", "decode", "unsupported"].includes(failure.code)
      ) {
        recoveryUsed = true;
        // If no source opened, let the music worker resolve again. Forced refresh selects
        // the independent relay and is appropriate only for a failed audio URL.
        return await playAt(index, {
          refresh:
            playbackStage === "start" || resume > 0 || ["decode", "unsupported"].includes(failure.code),
          resume: Math.max(resume, audio.currentTime || 0),
          recovery: true,
          origin: playbackOrigin,
          autoplay,
          automatic: true,
          raceLocal: true,
          transportFault: ["network", "timeout"].includes(failure.code),
        });
      }
      if (
        offlineSource &&
        !isLocalMusicId(current.id) &&
        !recoveryUsed &&
        navigator.onLine !== false &&
        ["decode", "unsupported"].includes(failure.code)
      ) {
        recoveryUsed = true;
        return await playAt(index, {
          refresh: true,
          resume: Math.max(resume, audio.currentTime || 0),
          recovery: true,
          decodeRecovery: true,
          origin: playbackOrigin,
          autoplay,
          automatic: true,
        });
      }
      if (autoplay && (await attemptEquivalent(failure.code, Math.max(resume, audio.currentTime || 0))))
        return;
      if (token !== playRequest) return;
      if (!musicRoom?.isGuest() && failure.code !== "cancelled" && error?.name !== "AbortError")
        recommendationSession.fail(current.id);
      const protectionFailure = [
        "pending",
        "verification_required",
        "verification_rejected",
        "protection_unknown",
      ].includes(failure.code);
      needsRefresh = true;
      retryPosition = Math.max(retryPosition, audio.currentTime || 0);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      resolvedTrack = null;
      artist.textContent = t(
        protectionFailure || ["restricted", "limited"].includes(failure.code)
          ? failure.message
          : "Could not play. Press play to retry.",
      );
      artist.title = t(failure.message);
      status(t(failure.message), true);
      changeSource.hidden = isLocalMusicId(current.id) || origin === "room" || failure.code === "cancelled";
    } finally {
      if (token === playRequest) {
        streamLoading = false;
        syncDock();
      }
    }
  }
  function playItems(items, startId, source = selectionContext(), contextItems = items) {
    if (roomControlsPlayback()) return;
    queue = playbackQueue(items, startId);
    automaticQueueIds.clear();
    order.reset();
    const position = queue.findIndex(item => item.id === startId);
    if (queue.length) {
      const selected = queue[Math.max(0, position)];
      setPlaybackContext(tracks([selected, ...tracks(contextItems)]), source);
      const recommended = ["personal", "radio", "interest"].includes(source.kind);
      if (recommended) for (const item of queue) automaticQueueIds.add(item.id);
      playAt(Math.max(0, position), {
        transitionIntent: "navigation",
        origin: recommended ? "recommendation" : "manual",
      });
    }
  }
  function resumeListening(snapshot) {
    if (current?.id === snapshot.item.id) {
      if (streamLoading || !audio.paused) return;
      return togglePlay();
    }
    queue = tracks(snapshot.queue);
    if (!queue.some(item => item.id === snapshot.item.id)) queue = [snapshot.item, ...queue];
    automaticQueueIds.clear();
    order.reset();
    const source = snapshot.sourceContext,
      validSource = source?.kind !== "interest" || saved.interestMixes.some(mix => mix.id === source.id);
    setPlaybackContext(
      tracks([snapshot.item, ...(snapshot.contextItems || queue)]),
      validSource && source ? source : { kind: "resume" },
    );
    return playAt(
      queue.findIndex(item => item.id === snapshot.item.id),
      { resume: snapshot.position },
    );
  }
  async function togglePlay() {
    if (roomControlsPlayback()) return;
    if (!current) {
      if (queue.length) playAt(0);
      return;
    }
    if (radioPending) {
      ++playRequest;
      radioPending = false;
      audio.pause();
      status("");
      syncDock();
      return;
    }
    if (streamLoading) {
      diagnostics.record("cancelled", "cancelled");
      ++playRequest;
      recoveryLocal = null;
      recoveryCatalog = null;
      cancelResolution();
      streamLoading = false;
      retryPosition = Math.max(retryPosition, audio.currentTime || 0);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      resolvedTrack = null;
      artist.textContent = displaySubtitle(current);
      syncDock();
      return;
    }
    if (!audio.paused) {
      cancelResolution(true);
      audio.pause();
      return;
    }
    if (resolvedTrack !== current.id) {
      recoveryUsed = false;
      alternateTried = false;
      recoveryLocal = null;
      return playAt(index, {
        refresh: needsRefresh,
        resume: retryPosition,
        recovery: retryPosition > 0,
        origin: playbackOrigin,
      });
    }
    if (audio.ended)
      return playAt(index, { skipped: false, transitionIntent: "ended", origin: playbackOrigin });
    const token = playRequest;
    streamLoading = true;
    syncDock();
    try {
      await startAudio();
      if (token === playRequest) status("");
    } catch (error) {
      if (token === playRequest) {
        const failure = playbackFailure(error);
        diagnostics.record("start", failure.code);
        needsRefresh = true;
        retryPosition = audio.currentTime || 0;
        audio.pause();
        resolvedTrack = null;
        artist.textContent = t(failure.message);
        status(t(failure.message), true);
        changeSource.hidden = isLocalMusicId(current.id) || playbackOrigin === "room";
      }
    } finally {
      if (token === playRequest) {
        streamLoading = false;
        syncDock();
      }
    }
  }
  async function radio(seed) {
    if (isLocalMusicId(seed?.id)) return [];
    const source = resolveRecordingSource(seed, saved.sourceBindings),
      key = `${language()}:${source.id}`,
      cached = radioCache.get(key);
    if (cached && Date.now() - cached.at < 10 * 60000) return cached.items;
    const result = await invoke("music_catalog", { kind: "radio", value: source.id, language: language() });
    const items = tracks(result.sections.flatMap(section => section.items));
    if (radioCache.size >= 8) radioCache.delete(radioCache.keys().next().value);
    radioCache.set(key, { at: Date.now(), items });
    return items;
  }
  async function radioCandidates(seed) {
    if (isLocalMusicId(seed?.id)) return [];
    const recording = createRecordingView(saved, taste, { queue });
    const seeds = recording.items(
      recommendationSession.seeds(seed, tasteSeeds(recording.taste, recording.saved.favorites), { limit: 2 }),
    );
    const token = playRequest,
      revision = contextRevision,
      source = { ...playbackSourceContext };
    const live = () => token === playRequest && revision === contextRevision;
    const publicSeeds =
      source.kind === "interest"
        ? interestSeeds(recording.saved, recording.taste, source.id, { limit: 2 })
        : seeds;
    const moodTags = {
      chill: "ambient",
      focus: "instrumental",
      jazz: "jazz",
      electronic: "electronic",
      rock: "rock",
    };
    const tags = source.kind === "mood" && moodTags[source.id] ? [moodTags[source.id]] : [];
    let publicItems = [];
    const extra = publicCandidates({ seeds: publicSeeds, tags, isCurrent: live }).then(items => {
      publicItems = items;
      return items;
    });
    const contextualIds = new Set(
      [...recommendationSession.contextItems(), ...recommendationSession.preferenceItems()].map(
        item => item.id,
      ),
    );
    const results = await Promise.allSettled(seeds.map(item => radio(item)));
    const pools = results.flatMap((result, index) =>
      result.status === "fulfilled"
        ? [
            {
              seed: seeds[index],
              items: result.value,
              contextual: contextualIds.has(seeds[index].id),
              source: contextualIds.has(seeds[index].id)
                ? source
                : { kind: seeds[index].id === seed?.id ? "playing" : "taste", id: seeds[index].id },
            },
          ]
        : [],
    );
    const pool = { ...recommendationSession.mergePools(pools), pools };
    if (publicItems.length && live() && discoveryAllowed())
      Object.assign(pool, mergePublicPool(pool, publicItems));
    // Enrich a prepared raw pool when ready, without delaying the current Next.
    // The consume path still applies the latest mode, exclusions and source IDs.
    extra
      .then(items => {
        if (items.length && live() && discoveryAllowed()) Object.assign(pool, mergePublicPool(pool, items));
      })
      .catch(() => {});
    if (!pool.items.length && results.length && results.every(result => result.status === "rejected"))
      throw results[0].reason;
    return pool;
  }
  function roomControlsPlayback() {
    if (!musicRoom?.isGuest()) return false;
    status(t("The room host controls the track. Leave the room to play your own music."));
    return true;
  }
  async function advance(skipped = false) {
    if (roomControlsPlayback()) return;
    if (!current || radioPending) return;
    const transitionIntent = skipped
      ? playbackOrigin === "recommendation"
        ? "next"
        : "navigation"
      : "ended";
    captureListening(skipped, transitionIntent);
    if (!skipped && sleep.consumeTrackEnd()) {
      syncDock();
      status(t("Sleep timer paused playback."));
      return;
    }
    if (!skipped && repeat === "one") {
      playAt(index, { skipped: false, transitionIntent, origin: playbackOrigin });
      return;
    }
    const next = plannedNext();
    if (next >= 0) {
      playAt(next, {
        skipped,
        transitionIntent,
        origin: automaticQueueIds.has(queue[next].id) ? "recommendation" : "manual",
      });
      return;
    }
    if (!autoplay) {
      syncDock();
      return;
    }
    const token = playRequest,
      revision = contextRevision,
      seed = current;
    radioPending = true;
    syncDock();
    status(t("Finding the next songs for you…"));
    try {
      const pool = await (radioAhead?.token === token && radioAhead.revision === revision
        ? radioAhead.promise
        : radioCandidates(seed));
      if (token !== playRequest || revision !== contextRevision) return;
      const items = rankRadioPool(pool, seed);
      if (items.length) {
        for (const item of items) automaticQueueIds.add(item.id);
        // Bound exhausted radio history, never the user's manually selected library.
        const oldAutomatic = queue.slice(0, index + 1).filter(item => automaticQueueIds.has(item.id));
        const discard = new Set(
          oldAutomatic.slice(0, Math.max(0, automaticQueueIds.size - 200)).map(item => item.id),
        );
        queue = [...queue.filter(item => !discard.has(item.id)), ...items];
        const retained = new Set(queue.map(item => item.id));
        for (const id of automaticQueueIds) if (!retained.has(id)) automaticQueueIds.delete(id);
        playAt(
          queue.findIndex(item => item.id === items[0].id),
          { skipped, transitionIntent, origin: "recommendation" },
        );
      } else status(t("No more songs found. Pick another track."));
    } catch (error) {
      if (token === playRequest && revision === contextRevision) {
        radioAhead = null;
        status(errorText(error), true);
      }
    } finally {
      if (token === playRequest && revision === contextRevision) {
        radioPending = false;
        syncDock();
      }
    }
  }
  function currentEndSource() {
    return (
      endSource?.token === playRequest && resolvedTrack === current?.id && audio.currentSrc === endSource.url
    );
  }
  function rememberMediaDuration() {
    if (Number.isFinite(audio.duration) && audio.duration > 0)
      endSource.duration = Math.max(endSource.duration, audio.duration);
  }
  decks.listen("ended", event => {
    if (
      !currentEndSource() ||
      !audio.ended ||
      audio.seeking ||
      event?.timeStamp < endSource.since ||
      musicRoom?.isGuest()
    )
      return;
    // Seeking directly to the genuine end is valid. A complete listen is a
    // separate statistic; it cannot be inferred from the final playhead alone.
    const expected = Math.max(endSource.duration, Number.isFinite(audio.duration) ? audio.duration : 0);
    if (audio.error || expected - audio.currentTime > 1.5) {
      const code = audio.error ? mediaFailureCode() : "network";
      failPlayback(code, true);
    } else advance(false);
  });
  decks.listen("play", () => {
    document.querySelectorAll("audio, video").forEach(other => {
      if (!decks.owns(other) && !isMotionCover(other)) other.pause();
    });
    if ("mediaSession" in navigator && current) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: displaySubtitle(current),
        artwork: current.image ? [{ src: current.image }] : [],
      });
    }
    syncDock();
  });
  function yieldToOtherMedia() {
    captureListening();
    ++playRequest;
    cancelResolution();
    clearTimeout(bufferingTimer);
    bufferingTimer = null;
    radioPending = false;
    streamLoading = false;
    if (current && resolvedTrack === current.id) retryPosition = audio.currentTime || 0;
    resolvedTrack = null;
    nextPlan = null;
    preloadPending = false;
    decks.clear();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    persistSession();
    syncDock();
  }
  document.addEventListener("deviload:cinema-intent", yieldToOtherMedia);
  document.addEventListener(
    "play",
    event => {
      if (isMotionCover(event.target)) return;
      if (!decks.owns(event.target)) yieldToOtherMedia();
      else document.dispatchEvent(new CustomEvent("deviload:music-play"));
    },
    true,
  );
  function listeningBoundary() {
    const at = performance.now();
    clock.sample(audio.currentTime, at, false);
    clock.sample(
      audio.currentTime,
      at,
      !audio.paused &&
        !audio.seeking &&
        audio.readyState >= 3 &&
        (isCasting() || (audio.volume > 0 && !audio.muted)),
    );
  }
  decks.listen("playing", () => {
    diagnostics.record("playing", "success");
    clearTimeout(bufferingTimer);
    bufferingTimer = null;
    if (current) playbackContext = remember(playbackContext, current, 12);
    if (current && !historyAdded && !privateSession) {
      saved.recent = remember(saved.recent, current);
      historyAdded = true;
      persist();
    }
    listeningBoundary();
    artist.textContent = displaySubtitle(current) || "YouTube Music";
    syncDock();
  });
  // Reset the clock boundary when muting/unmuting so a later timeupdate cannot
  // count the preceding muted interval as audible listening.
  decks.listen("volumechange", listeningBoundary);
  decks.listen("pause", () => {
    if (!streamLoading && !sessionTransition) {
      recoveryLocal = null;
      recoveryCatalog = null;
      if (endSource) endSource.runway = null;
    }
    diagnostics.record("pause", "success");
    decks.stopTail();
    clearTimeout(bufferingTimer);
    bufferingTimer = null;
    clock.sample(audio.currentTime, performance.now(), false);
    captureListening();
    syncDock();
    persistSession();
  });
  function waitForAudio() {
    clock.sample(audio.currentTime, performance.now(), false);
    syncDock();
    if (!current || audio.paused || streamLoading) return;
    // Repeated waiting/stalled notifications must not postpone the deadline.
    if (bufferingTimer !== null) return;
    diagnostics.record("buffering", "requested");
    artist.textContent = t("Buffering audio…");
    const token = playRequest,
      stalledAt = audio.currentTime;
    const depleted =
      !resolvedOffline &&
      currentEndSource() &&
      !audio.seeking &&
      audio.readyState < 3 &&
      stalledAt >= 1 &&
      audio.duration - stalledAt > 1 &&
      bufferedSeconds(audio) <= 0.25;
    const timer = setTimeout(
      async () => {
        if (bufferingTimer !== timer) return;
        const currentWait = () =>
          bufferingTimer === timer &&
          token === playRequest &&
          !audio.paused &&
          !audio.seeking &&
          !audio.ended;
        const finish = () => {
          if (bufferingTimer === timer) bufferingTimer = null;
        };
        if (!currentWait()) {
          finish();
          return;
        }
        // A browser can resume decoding without another playing event. Never
        // reopen a healthy stream merely because an old waiting timer expired.
        if (audio.readyState >= 3 && audio.currentTime > stalledAt + 0.1) {
          finish();
          artist.textContent = displaySubtitle(current) || "YouTube Music";
          return;
        }
        // Data or playback resumed while the short watchdog was armed. Let that
        // source continue and reassess only if the decoder is still waiting.
        if (audio.currentTime > stalledAt + 0.1 || (depleted && bufferedSeconds(audio) > 0.25)) {
          finish();
          if (audio.readyState < 3) waitForAudio();
          return;
        }
        // waiting/stalled can clear on the same connection. Never unload the
        // decoder for an online recovery the active worker cannot perform.
        if (navigator.onLine === false) {
          finish();
          return;
        }
        // Stalled again after the automatic reopen: try an equivalent recording or say so, never freeze in silence.
        if (recoveryUsed) {
          finish();
          failPlayback("timeout");
          return;
        }
        if (!resolvedOffline) {
          const allowed = await invoke("music_recovery_allowed", { id: current.id }).catch(() => false);
          if (
            !currentWait() ||
            allowed !== true ||
            audio.currentTime > stalledAt + 0.1 ||
            audio.readyState >= 3
          ) {
            finish();
            return;
          }
        }
        finish();
        recoveryUsed = true;
        playAt(index, {
          refresh: true,
          resume: audio.currentTime,
          recovery: true,
          origin: playbackOrigin,
          automatic: true,
          raceLocal: !resolvedOffline,
          transportFault: !resolvedOffline,
        });
      },
      depleted && !recoveryUsed ? 2500 : 20000,
    );
    bufferingTimer = timer;
  }
  decks.listen("waiting", waitForAudio);
  decks.listen("stalled", () => {
    if (audio.readyState < 3) waitForAudio();
  });
  decks.listen("durationchange", () => {
    if (currentEndSource()) rememberMediaDuration();
  });
  decks.listen("loadedmetadata", () => {
    const active = currentEndSource();
    if (active) rememberMediaDuration();
    if (!Number.isFinite(audio.duration)) return;
    knownDuration = audio.duration;
    if (pendingSeek <= 0) return;
    if (active && endSource.minimumResume > 0) {
      // An alternate can advertise a full song but deliver only a prefix. Never rewind to its end.
      if (audio.duration <= pendingSeek) {
        ++playRequest;
        cancelResolution();
        streamLoading = false;
        failPlayback("unsupported");
        return;
      }
      if (endSource.alternateRetry) endSource.alternateRetry.initialSeek = true;
      audio.currentTime = pendingSeek;
    } else audio.currentTime = Math.min(pendingSeek, Math.max(0, audio.duration - 1));
    pendingSeek = 0;
  });
  function mediaFailureCode() {
    const reason = playbackFailure(audio.error?.message).code;
    if (
      [
        "restricted",
        "limited",
        "cancelled",
        "pending",
        "verification_required",
        "verification_rejected",
        "protection_unknown",
        "invalid_response",
      ].includes(reason)
    )
      return reason;
    return { 1: "cancelled", 2: "network", 3: "decode", 4: "unsupported" }[audio.error?.code] || "failed";
  }
  function retryProgressedAlternate(code, earlyEnd, resume) {
    const source = endSource,
      attempt = source?.alternateRetry;
    if (
      !attempt ||
      earlyEnd ||
      !["network", "timeout"].includes(code) ||
      audio.ended ||
      audio.seeking ||
      !currentEndSource() ||
      resolvedOffline ||
      playbackOrigin === "room" ||
      musicRoom?.isGuest() ||
      navigator.onLine === false ||
      attempt.revision !== sourceRevision ||
      resolveRecordingSource(current, saved.sourceBindings)?.id !== current.id ||
      getExactLocalCopy(storage, current.id, current.id) ||
      (audio.error && mediaFailureCode() !== "network")
    )
      return null;
    const anchor = source.minimumResume;
    if (resume - anchor < 8) return null;
    const played = audio.played;
    let continuous = false;
    for (let i = 0; i < (played?.length ?? 0); i++) {
      if (
        Math.abs(played.start(i) - anchor) <= 0.1 &&
        played.end(i) - Math.max(played.start(i), anchor) >= 8 &&
        played.end(i) >= resume - 0.1
      ) {
        continuous = true;
        break;
      }
    }
    if (!continuous) return null;
    // Consume the one chance before IPC. The refreshed B deliberately receives no new chance.
    source.alternateRetry = null;
    const token = playRequest,
      id = current.id;
    streamLoading = true;
    retryPosition = resume;
    audio.pause();
    syncDock();
    return (async () => {
      try {
        const allowed = await invoke("music_recovery_allowed", { id: attempt.id, originalId: id });
        if (token !== playRequest) return true;
        if (
          allowed !== true ||
          attempt.revision !== sourceRevision ||
          !currentEndSource() ||
          musicRoom?.isGuest()
        )
          return false;
        await playAt(index, {
          resume,
          recovery: true,
          automatic: true,
          refresh: true,
          transportFault: true,
          alternateId: attempt.id,
          retryAlternate: true,
          origin: playbackOrigin,
        });
        return true;
      } catch {
        return token !== playRequest;
      } finally {
        if (token === playRequest) {
          streamLoading = false;
          syncDock();
        }
      }
    })();
  }
  function failPlayback(code, earlyEnd = false) {
    diagnostics.record("playing", code);
    const failedActiveSource =
      resolvedTrack === current.id && ["network", "decode", "unsupported"].includes(code);
    const canRetry =
      failedActiveSource || (!earlyEnd && code === "failed" && (audio.currentTime > 0 || clock.seconds > 0));
    if (
      canRetry &&
      !recoveryUsed &&
      navigator.onLine !== false &&
      !(earlyEnd && (resolvedOffline || isLocalMusicId(current.id)))
    ) {
      recoveryUsed = true;
      playAt(index, {
        refresh: true,
        resume: audio.currentTime,
        recovery: true,
        origin: playbackOrigin,
        decodeRecovery:
          resolvedOffline && resolvedTrack === current.id && ["decode", "unsupported"].includes(code),
        automatic: true,
        raceLocal: failedActiveSource && !resolvedOffline,
        transportFault: code === "network" && !earlyEnd && !resolvedOffline,
      });
      return;
    }
    const token = playRequest,
      resume =
        resolvedTrack === current.id && !pendingSeek && Number.isFinite(audio.currentTime)
          ? audio.currentTime
          : retryPosition || 0;
    const detail = playbackFailure(audio.error?.message);
    function finish() {
      if (token !== playRequest) return;
      if (code !== "cancelled" && !musicRoom?.isGuest()) recommendationSession.fail(current.id);
      needsRefresh = true;
      retryPosition = resume;
      audio.pause();
      resolvedTrack = null;
      artist.textContent = t("Could not play. Press play to retry.");
      status(t(detail.code === code ? detail.message : playbackFailure(code).message), true);
      changeSource.hidden = isLocalMusicId(current.id) || playbackOrigin === "room" || code === "cancelled";
      syncDock();
    }
    const pending = retryProgressedAlternate(code, earlyEnd, resume) || attemptEquivalent(code, resume);
    if (pending)
      pending.then(recovered => {
        if (!recovered) finish();
      });
    else finish();
  }
  decks.listen("error", () => {
    if (!streamLoading && current && resolvedTrack === current.id) failPlayback(mediaFailureCode());
  });
  decks.listen("seeking", () => {
    if (!endSource) return;
    endSource.runway = null;
    if (endSource.alternateRetry) {
      if (
        endSource.alternateRetry.initialSeek &&
        Math.abs(audio.currentTime - endSource.minimumResume) <= 0.1
      )
        endSource.alternateRetry.initialSeek = false;
      else endSource.alternateRetry = null;
    }
  });
  decks.listen("seeked", () => {
    if (endSource?.alternateRetry) endSource.alternateRetry.initialSeek = false;
    discordPresence.sync(true);
  });
  let joinTimer = 0;
  decks.listen("timeupdate", () => {
    discordPresence.sync();
    const seconds = clock.sample(
      audio.currentTime,
      performance.now(),
      !audio.paused &&
        !audio.seeking &&
        audio.readyState >= 3 &&
        (isCasting() || (audio.volume > 0 && !audio.muted)),
    );
    if (seconds >= 30 && seconds - checkpoint >= 15) {
      checkpoint = seconds;
      captureListening();
    }
    elapsed.textContent = time(audio.currentTime);
    duration.textContent = time(audio.duration);
    duration.paintTime?.();
    seek.disabled = !Number.isFinite(audio.duration) || audio.duration <= 0;
    if (Number.isFinite(audio.duration) && audio.duration > 0 && !isRangeDragging(seek)) {
      seek.setAttribute("aria-valuetext", `${time(audio.currentTime)} / ${time(audio.duration)}`);
    }
    watchCurrentBuffer();
    preloadNext();
    lyrics.update();
    const upcoming = plannedNext(),
      remaining =
        (Math.max(audio.duration, endSource?.duration || 0) - audio.currentTime) / audio.playbackRate;
    if (
      !musicRoom?.isGuest() &&
      !sleep.holdsTrackEnd() &&
      repeat !== "one" &&
      !streamLoading &&
      !audio.paused &&
      !audio.seeking &&
      upcoming >= 0 &&
      decks.ready(queue[upcoming].id)
    ) {
      const next = queue[upcoming],
        plan = transitionPlan({
          transition: sound.transition,
          seamless: sound.seamless,
          current,
          next,
          remaining,
        });
      const origin = automaticQueueIds.has(next.id) ? "recommendation" : "manual";
      if (plan?.kind === "fade") {
        captureListening();
        playAt(upcoming, { overlap: plan.overlap, skipped: false, transitionIntent: "ended", origin });
      } else if (plan?.kind === "join" && !joinTimer) {
        const from = current.id;
        joinTimer = setTimeout(() => {
          joinTimer = 0;
          const left = (audio.duration - audio.currentTime) / audio.playbackRate,
            target = queue.findIndex(item => item.id === next.id);
          if (
            current?.id !== from ||
            audio.paused ||
            audio.seeking ||
            left > 0.3 ||
            sleep.holdsTrackEnd() ||
            target < 0 ||
            !decks.ready(next.id)
          )
            return;
          captureListening();
          playAt(target, { overlap: 0.01, skipped: false, transitionIntent: "ended", origin });
        }, plan.at * 1000);
      }
    }
    if (Date.now() - sessionSavedAt >= 5000) persistSession();
  });
  if ("mediaSession" in navigator) {
    for (const [name, action] of Object.entries({
      play: () => {
        if (audio.paused && !streamLoading) togglePlay();
      },
      pause: () => {
        if (streamLoading) togglePlay();
        else audio.pause();
      },
      previoustrack: () => previous.click(),
      nexttrack: () => advance(true),
    }))
      try {
        navigator.mediaSession.setActionHandler(name, action);
      } catch {
        /* unsupported control */
      }
  }

  function selectView(next) {
    filters.hidden = next !== "search";
    offlineTab.setAttribute("aria-current", next === "offline" ? "page" : "false");
    filters
      .querySelectorAll("button")
      .forEach(node => node.setAttribute("aria-pressed", String(node.dataset.filter === searchFilter)));
    if (view !== next) revealView($("music-shelves"));
    view = next;
    musicSearch?.sync(next === "search" && !activeMood ? lastQuery.value : "");
    $("music-home-hero").hidden = next !== "home";
    // The home already greets and names each shelf; a page title above "For you" only repeated it.
    $("music-heading").hidden = next === "home";
    $("music-moods").hidden = next !== "home" && !(next === "search" && activeMood);
    document.querySelectorAll("[data-music-view]").forEach(b => {
      const selected = b.dataset.musicView === (["playlist", "interest"].includes(next) ? "library" : next);
      b.classList.toggle("selected", selected);
      b.setAttribute("aria-current", selected ? "page" : "false");
    });
    document.querySelectorAll("[data-music-mood]").forEach(b => {
      b.classList.toggle("selected", b.dataset.musicMood === activeMood);
      b.setAttribute("aria-pressed", String(b.dataset.musicMood === activeMood));
    });
    $("devil-music").dataset.view = next;
    document.body.classList.toggle("music-view-home", next === "home");
    $("music-library-tools").hidden =
      next === "home" ||
      next === "library" ||
      next === "search" ||
      (next === "browse" && browseItem?.kind === "album");
    $("music-library-filter").value = listFilter;
  }
  function card(item, items, personal = false, contextItems = items) {
    const card = el("article", `music-card music-card-${item.kind}`);
    if (item.kind === "song") {
      card.dataset.trackId = item.id;
      markPlayback(card, item.id);
    }
    contextActions.set(card, () =>
      item.kind === "song"
        ? songActions(item)
        : [
            [
              t("Open {title}", { title: item.title }),
              "arrow-right",
              () => {
                browseItem = creditAlbumArtist(item, browseItem);
                load("browse", item.id, item.title);
              },
            ],
            ...(["album", "artist", "playlist"].includes(item.kind)
              ? [
                  [
                    item.kind === "artist" ? t("Follow artist") : t("Save album"),
                    "plus",
                    () => toggleCollection(item),
                  ],
                ]
              : []),
          ],
    );
    const action = button(
      item.kind === "song"
        ? t("Play {title}", { title: item.title })
        : t("Open {title}", { title: item.title }),
      null,
      () => {
        if (item.kind === "song")
          playItems(items, item.id, personal ? { kind: "personal" } : selectionContext(), contextItems);
        else {
          coverFlight = card.querySelector(".music-art")?.getBoundingClientRect() || null;
          browseItem = creditAlbumArtist(item, browseItem);
          load("browse", item.id, item.title);
        }
      },
      "music-card-main",
    );
    const art = playableCover(item, item.kind === "song" ? "play" : "arrow-right");
    action.replaceChildren(
      art,
      el("strong", "music-card-title", item.title),
      el("span", "music-card-subtitle", displaySubtitle(item)),
    );
    card.append(action);
    if (item.kind === "song") {
      action.querySelector(".music-card-subtitle").remove();
      const artistLink = button(
        displaySubtitle(item),
        null,
        () => showArtist(item),
        "music-card-subtitle music-artist-link",
      );
      artistLink.prepend(equalizer(item));
      artistLink.disabled = !item.artists?.length;
      card.append(artistLink);
      if (personal) {
        const label = recommendationLabel(recommendationReasons.get(item.id), t),
          reason = el("span", "music-recommendation-reason", label);
        reason.title = label;
        card.append(reason);
        observeRecommendation(card, item);
      }
      const cardMenu = trackMenu(item);
      cardMenu.menu.classList.add("music-card-feedback");
      card.append(cardMenu.menu);
      action.addEventListener("mouseenter", () => intent.enter(item.id));
      action.addEventListener("mouseleave", () => intent.leave());
      action.addEventListener("focus", () => intent.enter(item.id));
      action.addEventListener("blur", () => intent.leave());
      const add = button(
        t("Add to play queue"),
        "plus",
        () => {
          automaticQueueIds.delete(item.id);
          queue = tracks([...queue, item]);
          syncQueue();
          status(t("Added to play queue"));
        },
        "music-card-add",
      );
      card.append(add);
      card.append(
        button(t("Add to playlist"), "playlist", () => library.picker(item), "music-card-save-playlist"),
      );
      const next = button(t("Play next"), "skip-forward", () => playNext(item), "music-card-next");
      card.append(next);
      if (!isLocalMusicId(item.id))
        card.append(
          button(t("Download MP3"), "download-simple", () => downloadTrack(item), "music-card-download"),
        );
    } else if (["album", "artist", "playlist"].includes(item.kind)) {
      const savedButton = button(
        item.kind === "artist" ? t("Follow artist") : t("Save album"),
        "plus",
        () => toggleCollection(item),
        "music-card-add",
      );
      savedButton.setAttribute("aria-pressed", String(saved.collections.some(value => value.id === item.id)));
      card.append(savedButton);
    }
    return card;
  }
  function render() {
    clearVirtualLists();
    librarySidebar?.refresh(
      view === "favorites"
        ? "favorites"
        : view === "offline"
          ? "offline"
          : view === "playlist"
            ? playlistId
            : ["home", "search"].includes(view)
              ? view
              : null,
    );
    intent.leave();
    clearRecommendationObservations();
    const root = $("music-shelves");
    root.replaceChildren();
    enhanceMusicShelves(root);
    if (view === "home")
      homeHero?.update(
        current ||
          saved.recent[0] ||
          saved.favorites[0] ||
          sections.flatMap(s => s.items).find(x => x.kind === "song"),
        !!current,
        !!current && !audio.paused,
      );
    root.classList.toggle("music-results", view !== "home");
    if (view === "library") {
      library.overview(root);
      renderSmartLibrary(root);
      interestUI.render(root);
      renderWeekly(root);
      if (library.canUndo())
        root.append(button(t("Undo library change"), null, () => library.undo(null), "music-filter-chip"));
      for (const [kind, label] of [
        ["artist", t("Followed artists")],
        ["album", t("Saved albums")],
        ["playlist", t("Saved playlists")],
      ]) {
        const items = saved.collections.filter(item => item.kind === kind);
        if (!items.length) continue;
        const shelf = el("section", "music-shelf"),
          grid = el("div", "music-card-grid");
        shelf.append(el("h4", "", label), grid);
        items.forEach(item => grid.append(card(item, items)));
        root.append(shelf);
      }
      return;
    }
    if (view === "home") {
      homeTiles?.render();
      interestUI.render(root, { compact: true });
    }
    if (view === "interest") {
      const mix = saved.interestMixes.find(value => value.id === interestViewId);
      if (!mix) {
        showPlaylist(null);
        return;
      }
      const banner = el("div", "music-interest-banner"),
        copy = el("div", "");
      const name = el("h2", "", mix.name);
      name.setAttribute("translate", "no");
      copy.append(
        el("span", "music-eyebrow", t("INTEREST MIX")),
        name,
        el("p", "", t("Based on {count} playlists", { count: mix.playlistIds.length })),
      );
      const actions = el("div", "music-library-actions"),
        start = button(
          t("Play mix"),
          "play",
          () => playItems(tracks(sections.flatMap(section => section.items))),
          "music-primary music-text-button",
        );
      start.disabled = !sections.some(section => section.items.length);
      actions.append(
        start,
        button(
          t("Edit interest mix"),
          "pencil-simple",
          () => interestUI.edit(mix.id),
          "outline small music-text-button",
        ),
      );
      copy.append(actions);
      banner.append(copy);
      root.append(banner);
    }
    if (view === "browse" && browseItem?.id === lastQuery.value) {
      const banner = el("div", "music-collection-banner"),
        copy = el("div", "music-collection-copy"),
        actions = el("div", "music-collection-actions");
      const kindLabel =
          browseItem.kind === "artist"
            ? t("Artist")
            : browseItem.kind === "playlist"
              ? t("Playlist")
              : t("Album"),
        byline = displaySubtitle(browseItem);
      copy.append(el("span", "music-eyebrow", kindLabel), el("h2", "", browseItem.title));
      if (byline !== kindLabel) copy.append(el("p", "", byline));
      const songs = tracks(sections.flatMap(section => section.items));
      const start = button(t("Play"), "play", () => playItems(songs), "music-primary music-text-button");
      start.disabled = !songs.length;
      const save = button(
        browseItem.kind === "artist" ? t("Follow artist") : t("Save album"),
        "plus",
        () => toggleCollection(browseItem),
        "music-filter-chip",
      );
      save.setAttribute("aria-pressed", String(saved.collections.some(value => value.id === browseItem.id)));
      actions.append(start, save);
      if (browseItem.kind === "artist")
        actions.append(
          button(
            t("Find all albums"),
            null,
            () => {
              searchFilter = "albums";
              load("search", browseItem.title);
            },
            "music-filter-chip",
          ),
        );
      const facts = collectionFacts(sections.flatMap(s => s.items)),
        meta = el("p", "music-collection-facts");
      meta.textContent = [
        browseItem.subtitle
          ?.split(" • ")
          .filter(part => part !== kindLabel && !browseItem.artists?.includes(part))
          .join(" • "),
        t("{count} tracks", { count: facts.count }),
        facts.complete && facts.seconds ? time(facts.seconds) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      copy.append(meta, actions);
      banner.dataset.kind = browseItem.kind;
      banner.append(cover(browseItem), copy);
      root.append(banner);
    }
    if (view === "home" && !sections.some(section => section.items.length)) {
      const empty = el("div", "music-empty");
      empty.append(
        el("h4", "", t("Start with music you love")),
        el(
          "p",
          "",
          t("Search for an artist and listen or like a song. Your personal recommendations will grow here."),
        ),
      );
      root.append(empty);
    }
    if (
      view === "home" &&
      !saved.favorites.length &&
      !saved.collections.some(x => x.kind === "artist") &&
      !Object.keys(taste.entries).length
    ) {
      const prompt = el("div", "music-resume-card");
      prompt.append(
        el("strong", "", t("Make your first mix personal")),
        button(t("Choose favorite artists"), null, chooseArtists, "music-primary"),
      );
      root.append(prompt);
    }
    if (view === "playlist") {
      const playlist = getPlaylist(playlistId);
      if (!playlist) {
        showPlaylist(null);
        return;
      }
      const banner = el("div", "music-playlist-banner music-playlist-feature"),
        copy = el("div", "music-playlist-feature-copy"),
        actions = el("div", "music-playlist-feature-actions");
      banner.append(library.artwork(playlist));
      copy.append(
        el("span", "music-eyebrow", playlist.smart ? t("MADE FOR YOU") : t("YOUR PLAYLIST")),
        el("h2", "", playlist.name),
      );
      if (playlist.description) copy.append(el("p", "", playlist.description));
      copy.append(el("span", "music-playlist-count", t("{count} tracks", { count: playlist.items.length })));
      const hasTracks = playlist.items.length > 0,
        start = hasTracks
          ? button(t("Play"), "play", () => playItems(playlist.items), "music-primary music-text-button")
          : button(
              t("Search music"),
              "magnifying-glass",
              () => $("music-query").focus(),
              "music-primary music-text-button",
            );
      actions.append(start);
      $("music-library-tools").hidden = playlist.items.length < 12;
      if (!playlist.smart)
        actions.append(
          ...pageMenu([
            [
              playlist.pinned ? t("Unpin playlist") : t("Pin playlist"),
              "push-pin",
              () => library.pin(playlist.id),
            ],
            [t("Edit playlist"), "pencil-simple", () => library.rename(playlist.id)],
            ...(hasTracks
              ? [
                  [t("Download for offline"), "download-simple", () => downloadPlaylist(playlist)],
                  [t("Create interest mix"), "music-notes", () => interestUI.edit(null, playlist.id)],
                  [t("Review similar tracks"), "copy", () => library.duplicates(playlist.id)],
                  [
                    t("Select visible tracks"),
                    "check",
                    () => {
                      visibleTrackIds.forEach(id => selectedTracks.add(id));
                      render();
                    },
                  ],
                ]
              : []),
            [t("Delete playlist"), "trash", () => library.remove(playlist.id)],
          ]),
        );
      copy.append(actions);
      banner.append(copy);
      root.append(banner);
      if (!playlist.smart && !selectedTracks.size && library.canUndo())
        root.append(
          button(
            t("Undo library change"),
            null,
            () => library.undo(playlistId),
            "music-filter-chip music-undo-chip",
          ),
        );
      if (!playlist.smart && selectedTracks.size) {
        const controls = el("div", "music-batch-actions");
        controls.append(
          el("strong", "", t("{count} selected", { count: selectedTracks.size })),
          button(
            t("Select visible tracks"),
            null,
            () => {
              const ids = visibleTrackIds;
              if (ids.every(id => selectedTracks.has(id))) ids.forEach(id => selectedTracks.delete(id));
              else ids.forEach(id => selectedTracks.add(id));
              render();
            },
            "quiet small",
          ),
        );
        for (const [label, action] of [
          [t("Copy to playlist"), () => library.transfer(playlist.id, [...selectedTracks], false)],
          [t("Move to playlist"), () => library.transfer(playlist.id, [...selectedTracks], true)],
          [t("Remove selected"), () => library.removeTracks(playlist.id, [...selectedTracks])],
        ]) {
          const control = button(label, null, action, "outline small");
          control.disabled = !selectedTracks.size;
          controls.append(control);
        }
        if (library.canUndo())
          controls.append(
            button(t("Undo library change"), null, () => library.undo(playlistId), "quiet small"),
          );
        root.append(controls);
      }
      if (!playlist.items.length) {
        const empty = el("div", "music-empty");
        empty.append(
          el("h4", "", playlist.smart ? t("Your mix is still growing") : t("Make room for your favorites")),
          el(
            "p",
            "",
            playlist.smart
              ? t("Keep listening and liking songs. This playlist updates from your history.")
              : t("Create a playlist, then add songs from search or your liked songs."),
          ),
        );
        root.append(empty);
        return;
      }
    }
    if (view === "search" && !listFilter) {
      const all = sections.flatMap(section => section.items),
        best = bestResult(all, lastQuery.value);
      if (best) {
        const feature = el("section", "music-best-result"),
          copy = el("div", ""),
          action = () =>
            best.kind === "song"
              ? playItems(all, best.id)
              : ((browseItem = best), load("browse", best.id, best.title));
        const art = button(t("Open {title}", { title: best.title }), null, action, "music-best-art");
        art.replaceChildren(playableCover(best));
        // Video results have wide YouTube frames; a square would cut their sides off.
        if (/^https:\/\/i\.ytimg\.com\//.test(best.image || "")) art.classList.add("is-wide");
        // The artist under a top song opens the artist page, as it does in every song row and card.
        const byline =
          best.kind !== "artist" && best.artists?.length
            ? button(
                displaySubtitle(best),
                null,
                () => showArtist(best),
                "music-artist-link music-best-artist",
              )
            : el("p", "", displaySubtitle(best));
        copy.append(
          el("span", "music-eyebrow", t("Top result")),
          el("h2", "", best.title),
          byline,
          button(
            best.kind === "song" ? t("Play") : t("Open {title}", { title: best.title }),
            best.kind === "song" ? "play" : "arrow-right",
            action,
            "music-primary music-text-button",
          ),
        );
        feature.append(art, copy);
        root.append(feature);
      }
    }
    if (!sections.some(section => section.items.length)) {
      if (["favorites", "recent", "offline"].includes(view) && !listFilter)
        $("music-library-tools").hidden = true;
      const empty = el("div", "music-empty");
      empty.append(
        icon("music-notes"),
        el(
          "h4",
          "",
          view === "favorites"
            ? t("Keep the songs you love")
            : view === "recent"
              ? t("Your listening story starts here")
              : view === "offline"
                ? t("No downloaded music yet")
                : t("No music found"),
        ),
        el(
          "p",
          "",
          view === "favorites"
            ? t("Tap the heart to save a song on this device.")
            : view === "recent"
              ? t("Songs you have played on this device appear here.")
              : view === "offline"
                ? t("Download a song from its menu to listen without internet.")
                : t("Try another artist, album or song."),
        ),
      );
      empty.append(
        button(
          t("Search music"),
          "magnifying-glass",
          () => $("music-query").focus(),
          "music-primary music-text-button",
        ),
      );
      root.append(empty);
      return;
    }
    if (["favorites", "recent", "offline"].includes(view) && !listFilter) {
      const items = tracks(sections.flatMap(section => section.items));
      if (items.length) {
        const bar = el("div", "music-list-actions"),
          facts = collectionFacts(items);
        bar.append(
          button(
            t("Play"),
            "play",
            () => {
              if (shuffle) toggleShuffle();
              playItems(items);
            },
            "music-primary music-text-button",
          ),
          button(
            t("Shuffle"),
            "shuffle",
            () => {
              if (!shuffle) toggleShuffle();
              playItems(items, items[Math.floor(Math.random() * items.length)].id);
            },
            "music-filter-chip music-text-button",
          ),
          el(
            "span",
            "music-collection-facts",
            [
              t("{count} tracks", { count: facts.count }),
              facts.complete && facts.seconds ? time(facts.seconds) : "",
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        );
        root.append(bar);
      }
    }
    const all = sections.flatMap(section => section.items);
    visibleTrackIds = [];
    for (const section of sections) {
      const shelf = el("section", "music-shelf");
      if (section.title || section.more) {
        const head = el("div", "music-shelf-heading");
        head.append(el("h4", "", section.title));
        if (section.more) {
          const label = section.items.every(item => item.kind === "song")
            ? t("Show all songs")
            : t("Load more");
          head.append(
            button(
              label,
              null,
              () => {
                browseItem = null;
                load("browse", section.more.id, section.title, false, section.more.params || "");
              },
              "music-filter-chip",
            ),
          );
        }
        shelf.append(head);
      }
      let items = section.items;
      if (view !== "home") {
        const query = listFilter.trim().toLocaleLowerCase();
        items = items.filter(item =>
          `${item.title} ${item.subtitle || ""}`.toLocaleLowerCase().includes(query),
        );
        if (listSort !== "original")
          items = [...items].sort((a, b) =>
            (listSort === "artist" ? a.artists?.[0] || a.subtitle || "" : a.title || "").localeCompare(
              listSort === "artist" ? b.artists?.[0] || b.subtitle || "" : b.title || "",
              language(),
            ),
          );
      }
      const songs = items.filter(item => item.kind === "song"),
        others = items.filter(item => item.kind !== "song");
      if (view !== "home" && songs.length) {
        const list = el("div", "music-track-list");
        shelf.append(list);
        root.append(shelf);
        // Selection uses the full filtered list, not only mounted viewport rows.
        visibleTrackIds.push(...songs.map(item => item.id));
        if (songs.length > 100)
          virtualLists.push(mountMusicList(list, songs, (item, position) => trackRow(item, songs, position)));
        else songs.forEach((item, position) => list.append(trackRow(item, songs, position)));
      }
      const grid = el("div", "music-card-grid");
      for (const item of view === "home" ? items : others)
        grid.append(card(item, all, view === "home" && section.title === t("For you"), items));
      if (grid.childElementCount) shelf.append(grid);
      if (!items.length) shelf.append(el("p", "music-empty-copy", t("No music found")));
      root.append(shelf);
    }
    enhanceMusicShelves(root);
    if (continuation && ["search", "browse"].includes(view)) {
      const more = button(t("Load more"), null, loadMore, "music-filter-chip");
      more.disabled = morePending;
      root.append(more);
    }
  }
  async function loadMore() {
    if (morePending || !continuation) return;
    morePending = true;
    const token = request,
      next = continuation;
    render();
    try {
      const result = await invoke("music_catalog", {
        ...lastQuery,
        language: language(),
        filter: searchFilter,
        continuation: next,
      });
      if (token !== request) return;
      const seen = new Set(sections.flatMap(section => section.items.map(item => item.id)));
      const items = result.sections
        .flatMap(section => section.items)
        .filter(item => !seen.has(item.id) && seen.add(item.id));
      if (items.length) sections.push({ title: "", items });
      continuation =
        items.length && seen.size < 5000 && result.continuation !== next ? result.continuation : null;
      status("");
    } catch (error) {
      if (token === request) status(errorText(error), true);
    } finally {
      if (token === request) {
        morePending = false;
        render();
      }
    }
  }
  function songActions(item) {
    const online = !isLocalMusicId(item.id),
      liked = saved.favorites.some(value => value.id === item.id);
    return [
      [t("Play next"), "skip-forward", () => playNext(item)],
      [
        t("Add to play queue"),
        "queue",
        () => {
          automaticQueueIds.delete(item.id);
          queue = tracks([...queue, item]);
          syncQueue();
          status(t("Added to play queue"));
        },
      ],
      null,
      [t("Add to playlist"), "plus", () => library.picker(item)],
      [
        liked ? t("Remove from liked songs") : t("Like this song"),
        "heart",
        () => {
          if (changeFavorite(item)) {
            syncDock();
            if (view === "favorites") showLocal(view);
            else showLike(item);
          }
        },
      ],
      ...(online
        ? [
            [t("Download MP3"), "download-simple", () => downloadTrack(item)],
            [
              t("Copy song link"),
              "copy",
              async () => {
                try {
                  await navigator.clipboard.writeText(
                    "https://music.youtube.com/watch?v=" +
                      encodeURIComponent(resolveRecordingSource(item, saved.sourceBindings).id),
                  );
                  status(t("Song link copied"));
                } catch {
                  status(t("Could not copy the song link."), true);
                }
              },
            ],
            null,
            [
              t("Song radio"),
              "music-notes",
              () => {
                browseItem = null;
                load("radio", resolveRecordingSource(item, saved.sourceBindings).id, t("Song radio"));
              },
            ],
            [t("Choose track version"), "music-notes", () => chooseRecording(item)],
          ]
        : []),
      null,
      [t("Less like this"), "eye-slash", () => feedback(false, item)],
      [t("Do not recommend this artist"), "user-minus", () => feedback(true, item)],
    ];
  }
  function playlistActions(list) {
    return [
      [t("Open {title}", { title: list.name }), "arrow-right", () => showPlaylist(list.id)],
      ...(list.items?.length ? [[t("Play"), "play", () => playItems(list.items)]] : []),
      ...(list.items?.some(item => !isLocalMusicId(item.id))
        ? [[t("Download for offline"), "download-simple", () => downloadPlaylist(list)]]
        : []),
      null,
      [list.pinned ? t("Unpin playlist") : t("Pin playlist"), "push-pin", () => library.pin(list.id)],
      [t("Edit playlist"), "pencil-simple", () => library.rename(list.id)],
      null,
      ...folderMoves(list),
      null,
      [t("Delete playlist"), "trash", () => library.remove(list.id)],
    ];
  }
  // Moving a playlist between folders from its menu; the folder list stays short.
  function folderMoves(list) {
    const current = folderName(list.folder).toLocaleLowerCase();
    const others = playlistFolders(saved.playlists)
      .folders.filter(folder => folder.key !== current)
      .slice(0, 6);
    return [
      ...others.map(folder => [
        t("Move to {folder}", { folder: folder.name }),
        "folders",
        () => library.setFolder(list.id, folder.name),
      ]),
      [t("New folder…"), "folder-open", () => library.newFolder(list.id)],
      ...(current ? [[t("Remove from folder"), "x-circle", () => library.setFolder(list.id, "")]] : []),
    ];
  }
  function folderActions(name) {
    const key = folderName(name).toLocaleLowerCase(),
      lists = saved.playlists.filter(list => folderName(list.folder).toLocaleLowerCase() === key),
      seen = new Set(),
      items = lists.flatMap(list => list.items || []).filter(item => !seen.has(item.id) && seen.add(item.id));
    return [
      ...(items.length ? [[t("Play folder"), "play", () => playItems(items)]] : []),
      [t("Rename folder"), "pencil-simple", () => library.renameFolder(name)],
      [t("Ungroup folder"), "folder-open", () => library.ungroup(name)],
    ];
  }
  function showContextMenu(entries, x, y) {
    if (!contextMenu) {
      contextMenu = el("div", "music-dock-menu music-page-menu music-context-menu");
      contextMenu.popover = "auto";
      document.body.append(contextMenu);
    }
    contextMenu.replaceChildren(
      ...entries.map(entry => {
        if (!entry) return el("hr", "");
        const [label, glyph, action] = entry,
          item = button(
            label,
            glyph,
            () => {
              contextMenu.hidePopover();
              action();
            },
            "music-page-menu-item",
          );
        item.append(el("span", "", label));
        return item;
      }),
    );
    contextMenu.showPopover();
    const box = contextMenu.getBoundingClientRect();
    contextMenu.style.left = Math.max(8, Math.min(x, innerWidth - box.width - 8)) + "px";
    contextMenu.style.top = Math.max(8, Math.min(y, innerHeight - box.height - 8)) + "px";
    contextMenu.querySelector("button")?.focus({ preventScroll: true });
  }
  function contextEntries(target) {
    const host = target.closest(".music-track-row,.music-card");
    if (host && contextActions.has(host)) return contextActions.get(host)();
    const track = target.closest(".music-queue-track")?.dataset.trackId,
      queued = track && queue.find(item => item.id === track);
    if (queued) return songActions(queued);
    if (target.closest(".music-dock .music-now") && current) return songActions(current);
    const folder = target.closest(".music-library-folder-head")?.dataset.folder;
    if (folder) return folderActions(folder);
    const listId =
        target.closest(".music-library-nav-item")?.dataset.collection ||
        target.closest(".music-playlist-tile")?.dataset.playlistId,
      list = listId && getPlaylist(listId);
    return list ? playlistActions(list) : null;
  }
  function trackMenu(item) {
    const menu = el("details", "music-track-menu"),
      summary = el("summary", "music-icon-button"),
      options = el("div", "music-track-options");
    menu.name = "music-track-actions";
    summary.title = t("More actions");
    summary.setAttribute("aria-label", t("More actions"));
    summary.append(icon("dots-three"));
    menu.append(summary, options);
    let prepared = false;
    const prepare = () => {
      if (prepared) return;
      prepared = true;
      options.prepend(
        ...songActions(item)
          .filter(Boolean)
          .map(([label, glyph, action]) => button(label, glyph, action)),
      );
      for (const action of options.querySelectorAll("button")) {
        action.classList.remove("music-icon-button");
        action.classList.add("music-menu-action");
        action.append(el("span", "music-menu-label", action.getAttribute("aria-label")));
      }
    };
    // The actions open in the window's top layer: a card that is moved or clipped (a shelf, a tilted cover) would
    // otherwise place them relative to itself, off the screen or cut away.
    options.popover = "auto";
    let dismissedAt = 0;
    options.addEventListener("toggle", event => {
      if (event.newState !== "closed" || !menu.open) return;
      dismissedAt = performance.now();
      menu.open = false;
    });
    // A click on the button that just closed the menu by clicking outside it must not open it again.
    summary.addEventListener("click", event => {
      if (performance.now() - dismissedAt < 300) event.preventDefault();
    });
    menu.addEventListener("toggle", () => {
      if (!menu.open) {
        if (options.matches?.(":popover-open")) options.hidePopover();
        return;
      }
      prepare();
      if (!options.matches?.(":popover-open")) options.showPopover?.();
      const rect = summary.getBoundingClientRect();
      // Keep every action between the sticky application header and the player.
      // A long menu scrolls inside this space instead of hiding its first rows.
      const top = Math.max(8, document.querySelector(".topbar").getBoundingClientRect().bottom + 8);
      const bottom = innerHeight - (dock.hidden ? 0 : dock.offsetHeight) - 8;
      options.style.maxHeight = Math.max(1, bottom - top) + "px";
      options.style.left =
        Math.max(8, Math.min(innerWidth - options.offsetWidth - 8, rect.right - options.offsetWidth)) + "px";
      const preferred =
        rect.bottom + 4 + options.offsetHeight <= bottom
          ? rect.bottom + 4
          : rect.top - options.offsetHeight - 4;
      options.style.top = Math.max(top, Math.min(bottom - options.offsetHeight, preferred)) + "px";
    });
    options.addEventListener("click", event => {
      if (event.target.closest("button")) menu.open = false;
    });
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        menu.open = false;
        summary.focus();
        event.stopPropagation();
      }
    });
    return { menu, options };
  }
  function pageMenu(entries) {
    const menu = el("div", "music-dock-menu music-page-menu"),
      toggle = button(t("More"), "dots-three", () => {}, "music-filter-chip music-page-more");
    menu.popover = "auto";
    toggle.popoverTargetElement = menu;
    menu.append(
      ...entries.map(([label, glyph, action]) => {
        const item = button(
          label,
          glyph,
          () => {
            menu.hidePopover();
            action();
          },
          "music-page-menu-item",
        );
        item.append(el("span", "", label));
        return item;
      }),
    );
    menu.addEventListener("beforetoggle", event => {
      if (event.newState !== "open") return;
      const anchor = toggle.getBoundingClientRect();
      menu.style.left = anchor.left + "px";
      menu.style.top = anchor.bottom + 8 + "px";
    });
    return [toggle, menu];
  }
  function trackRow(item, items, position) {
    const albumRow = view === "browse" && browseItem?.kind === "album",
      sameArtist = albumRow && (item.artists || []).join() === (browseItem.artists || []).join();
    const row = el("article", "music-track-row");
    row.classList.toggle("music-album-track", albumRow);
    row.dataset.trackId = item.id;
    markPlayback(row, item.id);
    const select = button(
      t("Play {title}", { title: item.title }),
      null,
      event => {
        if (
          view === "playlist" &&
          !getPlaylist(playlistId)?.smart &&
          (event.ctrlKey || event.metaKey || event.shiftKey)
        ) {
          chooseTrack(item.id, event.shiftKey);
          return;
        }
        playItems(items, item.id);
      },
      "music-track-select",
    );
    const text = el("span", "music-track-copy");
    text.append(el("strong", "", item.title));
    if (item.lossless) {
      const badge = el("span", "music-lossless", t("Lossless"));
      badge.title = t("Lossless audio: FLAC, ALAC or WAV on this device");
      text.append(badge);
    }
    select.replaceChildren(
      el("span", "music-track-number", String(position + 1).padStart(2, "0")),
      ...(albumRow ? [] : [playableCover(item, "play", 96)]),
      text,
    );
    const entry = el("div", "music-track-entry"),
      artistLink = button(displaySubtitle(item), null, () => showArtist(item), "music-artist-link");
    artistLink.prepend(equalizer(item));
    artistLink.disabled = !item.artists?.length;
    entry.append(select);
    if (!sameArtist) entry.append(artistLink);
    select.addEventListener("mouseenter", () => intent.enter(item.id));
    select.addEventListener("mouseleave", () => intent.leave());
    select.addEventListener("focus", () => intent.enter(item.id));
    select.addEventListener("blur", () => intent.leave());
    const actions = el("div", "music-track-actions");
    const heart = button(
      t("Like this song"),
      null,
      () => {
        if (!changeFavorite(item)) return;
        syncDock();
        if (view === "favorites") showLocal(view);
        else showLike(item);
      },
      "music-icon-button music-like",
    );
    const liked = saved.favorites.some(value => value.id === item.id);
    heart.textContent = liked ? "♥" : "♡";
    heart.setAttribute("aria-pressed", String(liked));
    const { menu, options } = trackMenu(item);
    const addToPlaylist = button(
      t("Add to playlist"),
      "plus",
      () => library.picker(item),
      "music-icon-button music-track-add-playlist",
    );
    actions.append(heart, addToPlaylist, menu);
    if (view === "playlist" && !getPlaylist(playlistId)?.smart) {
      row.classList.toggle("selected", selectedTracks.has(item.id));
      const checkbox = el("input", "music-track-checkbox");
      checkbox.type = "checkbox";
      checkbox.checked = selectedTracks.has(item.id);
      checkbox.setAttribute("aria-label", t("Select {title}", { title: item.title }));
      checkbox.addEventListener("click", event => chooseTrack(item.id, event.shiftKey));
      row.append(checkbox);
      if (!listFilter && listSort === "original") {
        row.draggable = true;
        row.addEventListener("dragstart", event => {
          const ids = selectedTracks.has(item.id) ? [...selectedTracks] : [item.id];
          event.dataTransfer.setData("application/x-devil-music-tracks", JSON.stringify({ playlistId, ids }));
          event.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragover", event => {
          if (event.dataTransfer.types.includes("application/x-devil-music-tracks")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            row.classList.add("drop-target");
          }
        });
        row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
        row.addEventListener("drop", event => {
          event.preventDefault();
          row.classList.remove("drop-target");
          try {
            const value = JSON.parse(event.dataTransfer.getData("application/x-devil-music-tracks"));
            if (value.playlistId === playlistId && Array.isArray(value.ids))
              library.reorder(playlistId, value.ids, item.id);
          } catch {}
        });
      }
      const original = library.find(playlistId).items,
        offset = original.findIndex(value => value.id === item.id);
      if (!listFilter && listSort === "original") {
        const up = button(t("Move up"), "arrow-up", () => library.move(playlistId, item.id, offset - 1)),
          down = button(t("Move down"), "arrow-down", () => library.move(playlistId, item.id, offset + 1));
        up.disabled = offset === 0;
        down.disabled = offset === original.length - 1;
        options.append(up, down);
      }
      options.append(
        button(t("Remove from playlist"), "x-circle", () => library.removeTrack(playlistId, item.id)),
      );
    }
    const ownPlaylist = view === "playlist" && !getPlaylist(playlistId)?.smart,
      listId = playlistId;
    contextActions.set(row, () => [
      ...songActions(item),
      ...(ownPlaylist
        ? [null, [t("Remove from playlist"), "x-circle", () => library.removeTrack(listId, item.id)]]
        : []),
    ]);
    const durationLabel = el("span", "music-track-duration", item.duration ? time(item.duration) : "");
    durationLabel.setAttribute("aria-label", t("Duration"));
    row.append(entry, durationLabel, actions);
    return row;
  }
  function skeleton() {
    clearVirtualLists();
    const grid = el("div", "music-card-grid");
    for (let i = 0; i < 6; i++) grid.append(el("div", "music-skeleton"));
    $("music-shelves").replaceChildren(grid);
  }
  let coverFlight = null;
  // Once a session, a few seconds after the home opens: the mood shelves not kept yet, one at a time.
  function readMoodsAhead() {
    if (moodsAhead || !invoke || navigator.connection?.saveData) return;
    moodsAhead = true;
    setTimeout(async () => {
      for (const [mood, query] of Object.entries(moods)) {
        const key = [mood, language()].join("|");
        if (moodShelves.get(key)) continue;
        try {
          const result = await invoke("music_catalog", {
            kind: "search",
            value: query,
            params: "",
            language: language(),
            filter: searchFilter,
          });
          if (result?.sections?.some(section => section.items?.length)) moodShelves.set(key, result);
        } catch {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 700));
      }
    }, 5000);
  }
  async function load(kind, value = "", heading = "", refresh = false, params = "") {
    const retainHome = kind === "home" && view === "home" && lastQuery.kind === "home" && sections.length > 0;
    const moodKey = kind === "search" && activeMood ? [activeMood, language()].join("|") : "",
      moodReady = moodKey && !refresh ? moodShelves.get(moodKey) : null;
    rememberNavigation({
      type: "catalog",
      kind,
      value,
      heading,
      params,
      filter: searchFilter,
      mood: activeMood,
      item: browseItem,
    });
    window.scrollTo({ top: 0 });
    $("devil-music").querySelector(".music-main-content")?.scrollTo({ top: 0 });
    listFilter = "";
    listSort = "original";
    $("music-library-sort").value = listSort;
    const token = ++request;
    lastQuery = { kind, value, heading, params };
    selectView(kind === "browse" ? "browse" : kind === "search" ? "search" : "home");
    continuation = null;
    morePending = false;
    $("music-heading").textContent =
      heading ||
      (kind === "search" ? t("Results for “{query}”", { query: value }) : t("Discover your next favorite"));
    $("music-kicker").textContent =
      kind === "home" ? t("PRESS PLAY") : kind === "search" ? t("SEARCH") : t("EXPLORE");
    loading = true;
    $("music-refresh").disabled = true;
    status(retainHome || moodReady ? "" : t("Finding your music…"));
    if (!retainHome && !moodReady) skeleton();
    try {
      if (!invoke) throw new Error(t("Open Deviload to browse and play music."));
      const artistPage =
        kind === "browse" && !params && browseItem?.kind === "artist" && browseItem.id === value;
      const result =
        kind === "home"
          ? { sections: [] }
          : moodReady
            ? moodReady
            : artistPage
              ? await loadArtistCatalog(browseItem, language(), refresh)
              : await invoke("music_catalog", {
                  kind,
                  value,
                  params,
                  language: language(),
                  filter: searchFilter,
                });
      if (token !== request) return;
      if (kind === "home") homeCache = result;
      if (moodKey && !moodReady && result.sections?.some(section => section.items?.length))
        moodShelves.set(moodKey, result);
      continuation = result.continuation || null;
      if (!retainHome)
        sections =
          kind === "home"
            ? homeSections(result.sections)
            : kind === "search"
              ? creditArtistCards(result.sections)
              : result.sections;
      if (kind === "browse") {
        ({ item: browseItem, sections } = applyBrowseArtwork(browseItem, sections, result.artwork, value));
        sections = creditAlbumTracks(browseItem, sections);
      }
      const notice =
        result.notice === "cached"
          ? t("Showing the last available artist page.")
          : result.notice === "songs"
            ? t("Showing songs while the full artist page is unavailable.")
            : "";
      status(notice);
      if (!retainHome) render();
      loaded = true;
      // A search arrives as a wave; an album or artist opened from a card takes its cover with it.
      // Motion is decoration: it must never stand between the listener and the page.
      try {
        if (!retainHome && kind === "search") cascadeIn($("music-shelves"));
        if (kind === "browse") {
          const art = $("music-shelves").querySelector(".music-collection-banner>.music-art");
          if (coverFlight && art) flyFrom(art, coverFlight, { duration: 560 });
          cascadeIn($("music-shelves"), {
            selector: ".music-collection-copy>*,.music-track-row,.music-card",
            limit: 14,
          });
        }
        coverFlight = null;
      } catch {
        /* The page is already shown. */
      }
      if ((kind === "browse" || (kind === "search" && searchFilter === "songs")) && audio.paused) {
        const first = tracks(sections.flatMap(section => section.items))[0];
        if (first) intent.enter(first.id);
      }
      if (kind === "home") {
        personalize(token, result.sections);
        readMoodsAhead();
      }
    } catch (error) {
      if (token !== request) return;
      if (kind === "search") musicSearch?.allowRetry();
      status(errorText(error), true);
      $("music-shelves").replaceChildren(
        button(t("Try again"), null, () => load(kind, value, heading, true, params), "music-primary"),
      );
    } finally {
      if (token === request) {
        loading = false;
        $("music-refresh").disabled = false;
      }
    }
  }
  function renderInterestPool() {
    if (view !== "interest" || !interestPool || interestPool.id !== interestViewId) return;
    const rows = rankMusicRecommendations(interestPool.items, saved, taste, {
      ...recommendationOptions(current, 40),
      queue,
      interestId: interestViewId,
      exclude: current ? [current.id] : [],
      candidateScores: interestPool.scores,
      sessionItems: recommendationSession.preferenceItems(),
      eligible: items => recommendationSession.allowed(items),
      random: () => 0.5,
    });
    sections = [{ title: "", items: rows.map(row => row.item) }];
    render();
    prepareHomeSelection();
  }
  async function showInterestMix(id) {
    const recording = createRecordingView(saved, taste, { queue }),
      context = interestProfile(recording.saved, recording.taste, id);
    if (!context.mix) {
      showPlaylist(null);
      status(t("That interest mix no longer exists."), true);
      return;
    }
    rememberNavigation({ type: "interest", id });
    const token = ++request;
    ++personalization;
    interestViewId = id;
    interestPool = null;
    activeMood = "";
    browseItem = null;
    continuation = null;
    morePending = false;
    listFilter = "";
    listSort = "original";
    loading = true;
    loaded = true;
    selectView("interest");
    $("music-refresh").disabled = true;
    $("music-kicker").textContent = t("INTEREST MIX");
    $("music-heading").textContent = context.mix.name;
    status(t("Finding songs for this interest…"));
    skeleton();
    const rotation = interestRotations.get(id) || 0;
    if (!interestRotations.has(id) && interestRotations.size >= 8)
      interestRotations.delete(interestRotations.keys().next().value);
    interestRotations.set(id, rotation + 1);
    const seeds = interestSeeds(recording.saved, recording.taste, id, { limit: 3, rotation });
    try {
      const results = await Promise.allSettled(seeds.map(seed => radio(seed)));
      if (token !== request || view !== "interest" || interestViewId !== id) return;
      const pools = [
        { items: context.members, contextual: true },
        ...results.flatMap((result, index) =>
          result.status === "fulfilled"
            ? [{ seed: seeds[index], items: result.value, contextual: true }]
            : [],
        ),
      ];
      interestPool = { id, ...recommendationSession.mergePools(pools) };
      loading = false;
      status("");
      renderInterestPool();
      if (!sections.some(section => section.items.length)) status(t("Keep listening to build this mix."));
      const pool = interestPool,
        live = () =>
          token === request && view === "interest" && interestViewId === id && interestPool === pool;
      publicCandidates({ seeds, isCurrent: live })
        .then(items => {
          if (items.length && live() && discoveryAllowed()) {
            interestPool = mergePublicPool(pool, items);
            status("");
            renderInterestPool();
          }
        })
        .catch(() => {});
    } catch (error) {
      if (token === request) {
        loading = false;
        sections = [];
        render();
        status(errorText(error), true);
      }
    } finally {
      if (token === request) {
        loading = false;
        $("music-refresh").disabled = false;
      }
    }
  }
  async function personalize(token, base) {
    const revision = ++personalization;
    captureListening();
    homeRefreshRevision = recommendationRevision;
    homeListeningRevision = listeningRevision;
    homeBuiltAt = Date.now();
    const recording = createRecordingView(saved, taste, { queue });
    const seeds = recording.items(
      recommendationSession.seeds(
        null,
        tasteSeeds(recording.taste, recording.saved.favorites, { rotation: homeSeedRotation++ }),
        { limit: 3, broaden: true },
      ),
    );
    const sessionItems = recommendationSession.preferenceItems(),
      contextualIds = new Set(
        [...recommendationSession.contextItems(), ...sessionItems].map(item => item.id),
      );
    const contextArtists = new Set(
      sessionItems.flatMap(item => (item.artists || []).map(canonicalArtistKey)),
    );
    const followed = (saved.collections || []).filter(
      item => item.kind === "artist" && !taste.blockedArtists?.includes(canonicalArtistKey(item.title)),
    );
    const offset = followed.length ? followedCursor % followed.length : 0,
      rotated = [...followed.slice(offset), ...followed.slice(0, offset)];
    followedCursor = (followedCursor + 1) % Math.max(1, followed.length);
    const selected = rotated
      .map((item, index) => ({ item, index, contextual: contextArtists.has(canonicalArtistKey(item.title)) }))
      .sort((a, b) => Number(b.contextual) - Number(a.contextual) || a.index - b.index)
      .slice(0, 2);
    // Known taste seeds are independent of followed-artist pages. Start both
    // requests together; artist-derived starter seeds still wait for those pages.
    const pendingRadios = seeds.length ? Promise.allSettled(seeds.map(seed => radio(seed))) : null;
    const artistResults = await Promise.allSettled(
      selected.map(({ item }) =>
        invoke("music_catalog", { kind: "browse", value: item.id, language: language() }),
      ),
    );
    if (token !== request || revision !== personalization) return;
    const artistItems = artistResults
      .filter(result => result.status === "fulfilled")
      .flatMap(result => result.value.sections.flatMap(section => section.items));
    if (!seeds.length) {
      for (const item of artistItems.filter(item => item.kind === "song").slice(0, 2)) seeds.push(item);
    }
    const albums = artistItems.filter(item => item.kind === "album"),
      personal = seeds.length > 0 || selected.length > 0;
    const live = () =>
      token === request && revision === personalization && view === "home" && lastQuery.kind === "home";
    const publish = async pool => {
      const prepared = discoveryAllowed() ? nextHomeCandidates : [];
      const pending = publicCandidates({
        seeds,
        artists: selected.map(({ item }) => item.title),
        tags: personal ? [] : ["pop"],
        isCurrent: live,
      });
      if (pool.items.length || prepared.length) {
        renderHomePool(base, mergePublicPool(pool, prepared), albums, personal);
        // Late enrichment is input for the next visit. Keep visible cards and focus intact.
        void pending
          .then(items => {
            if (items.length && live() && discoveryAllowed()) nextHomeCandidates = items;
          })
          .catch(() => {});
      } else {
        const items = await pending.catch(() => []);
        if (!live()) return;
        if (discoveryAllowed()) nextHomeCandidates = items;
        renderHomePool(base, mergePublicPool(pool, items), albums, personal);
      }
    };
    if (!seeds.length) {
      await publish({ items: [], scores: new Map() });
      return;
    }
    const results = await (pendingRadios || Promise.allSettled(seeds.map(seed => radio(seed))));
    if (token !== request || revision !== personalization) return;
    const pools = [
      ...artistResults.flatMap((result, index) =>
        result.status === "fulfilled"
          ? [
              {
                seed: selected[index].item,
                items: result.value.sections
                  .flatMap(section => section.items)
                  .filter(item => item.kind === "song"),
                contextual: selected[index].contextual,
                source: { kind: "followed_artist", id: selected[index].item.id },
              },
            ]
          : [],
      ),
      ...results.flatMap((result, index) =>
        result.status === "fulfilled"
          ? [
              {
                seed: seeds[index],
                items: result.value,
                contextual: contextualIds.has(seeds[index].id),
                source: contextualIds.has(seeds[index].id)
                  ? { ...playbackSourceContext }
                  : { kind: "taste", id: seeds[index].id },
              },
            ]
          : [],
      ),
    ];
    const pool = recommendationSession.mergePools(pools);
    await publish(pool);
  }
  function renderHomePool(base, pool, albums = [], personal = true) {
    const rows = rankMusicRecommendations(pool.items, saved, taste, {
      ...recommendationOptions(current, 18),
      queue,
      exclude: current ? [current.id] : [],
      candidateScores: pool.scores,
      eligible: items => recommendationSession.allowed(items),
    });
    recommendationReasons.clear();
    for (const { item, reason } of rows) recommendationReasons.set(item.id, reason);
    const items = distinctSongs(
      rows.map(row => row.item),
      current ? [current] : [],
    );
    discoveryCandidates = items;
    sections = homeSections(base, items);
    if (!personal && items.length) sections[0].title = t("Explore with ListenBrainz");
    // Albums already on the new releases shelf are not repeated on the one after it.
    const fresh = new Set(newReleases.cached(followedArtists(), language()).map(item => item.id)),
      older = albums.filter(item => !fresh.has(item.id));
    if (older.length) {
      const releases = sections.findIndex(section => section.title === t("New from artists you follow"));
      sections.splice(releases >= 0 ? releases + 1 : items.length ? 1 : 0, 0, {
        title: t("Albums from artists you follow"),
        items: older.slice(0, 12),
      });
    }
    render();
    prepareHomeSelection();
  }
  function prepareHomeSelection() {
    if (!audio.paused) return;
    const first = current || tracks(sections.flatMap(section => section.items))[0];
    if (first) intent.enter(first.id);
  }
  const followedArtists = () => (saved.collections || []).filter(item => item.kind === "artist");
  let releasesLoading = false;
  // New albums and singles from followed artists: the last shelf at once, a fresh one when it is ready.
  function refreshReleases() {
    if (releasesLoading || !followedArtists().length) return;
    releasesLoading = true;
    newReleases
      .load(followedArtists(), language())
      .then(items => {
        if (view !== "home") return;
        const title = t("New from artists you follow"),
          shelf = sections.find(section => section.title === title);
        if ((shelf?.items || []).map(item => item.id).join() === items.map(item => item.id).join()) return;
        const ids = new Set(items.map(item => item.id));
        sections = sections
          .filter(section => section.title !== title)
          .map(section =>
            section.title === t("Albums from artists you follow")
              ? { ...section, items: section.items.filter(item => !ids.has(item.id)) }
              : section,
          )
          .filter(section => section.items.length);
        if (items.length) {
          const after = sections.findIndex(section => section.title === t("For you"));
          sections.splice(after + 1, 0, { title, items });
        }
        render();
      })
      .catch(() => {})
      .finally(() => (releasesLoading = false));
  }
  function homeSections(base, personal = []) {
    const result = [];
    if (personal.length) result.push({ title: t("For you"), items: personal });
    const releases = newReleases.cached(followedArtists(), language());
    if (releases.length) result.push({ title: t("New from artists you follow"), items: releases });
    Promise.resolve().then(refreshReleases);
    if (saved.recent.length) result.push({ title: t("Recently played"), items: saved.recent.slice(0, 12) });
    // Cached or imported regional catalog sections must never enter discovery.
    return result;
  }
  function showLocal(kind) {
    rememberNavigation({ type: "local", view: kind });
    listFilter = "";
    $("music-library-filter").value = "";
    ++request;
    loading = false;
    loaded = true;
    $("music-refresh").disabled = false;
    selectView(kind);
    status("");
    $("music-kicker").textContent = t("YOUR MUSIC");
    $("music-heading").textContent = kind === "favorites" ? t("Liked songs") : t("Recently played");
    sections = [{ title: "", items: kind === "favorites" ? saved.favorites : saved.recent }];
    render();
  }
  const smartDefinitions = () => ({
    frequent: {
      name: t("On repeat"),
      description: t("Your most played songs with positive listening signals."),
    },
    rediscover: {
      name: t("Rediscover favorites"),
      description: t("Songs you enjoyed and have not played for at least two weeks."),
    },
    liked: { name: t("Recently liked"), description: t("Your latest likes, gathered in one place.") },
    discover: { name: t("New to you"), description: t("Recommendations you have not played or liked yet.") },
  });
  function getPlaylist(id) {
    if (!id?.startsWith("smart:")) return library.find(id);
    const key = id.slice(6),
      definition = smartDefinitions()[key];
    if (!definition) return;
    return { id, ...definition, smart: true, items: smartPlaylists(saved, taste, discoveryCandidates)[key] };
  }
  function renderSmartLibrary(root) {
    const shelf = el("section", "music-smart-library");
    shelf.append(el("h4", "", t("Made from your listening")));
    const grid = el("div", "music-smart-grid");
    for (const [key, definition] of Object.entries(smartDefinitions())) {
      const list = getPlaylist("smart:" + key);
      if (!list.items.length) continue;
      const tile = button(definition.name, null, () => showPlaylist(list.id), "music-smart-tile");
      tile.dataset.mix = key;
      tile.replaceChildren(
        el("span", "music-eyebrow", t("SMART PLAYLIST")),
        el("strong", "", definition.name),
        el("small", "", definition.description),
        el("span", "", t("{count} tracks", { count: list.items.length })),
      );
      grid.append(tile);
    }
    shelf.append(grid);
    if (grid.children.length) root.append(shelf);
  }
  function chooseTrack(id, range) {
    selectedTracks = selectTrackRange(selectedTracks, id, visibleTrackIds, selectionAnchor, range);
    if (!range) selectionAnchor = id;
    render();
  }
  document.addEventListener("keydown", event => {
    if (
      view !== "playlist" ||
      getPlaylist(playlistId)?.smart ||
      document.querySelector("main").dataset.page !== "music" ||
      document.querySelector("dialog[open]") ||
      event.target.closest("input,textarea,select")
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectedTracks = new Set(visibleTrackIds);
      render();
    } else if (event.key === "Escape" && selectedTracks.size) {
      selectedTracks.clear();
      render();
    }
  });
  function showPlaylist(id) {
    rememberNavigation({ type: "playlist", id: id || null });
    ++request;
    loading = false;
    loaded = true;
    playlistId = id;
    listFilter = "";
    $("music-refresh").disabled = false;
    selectedTracks.clear();
    selectionAnchor = null;
    const list = getPlaylist(id);
    selectView(list ? "playlist" : "library");
    status("");
    $("music-kicker").textContent = t("YOUR MUSIC");
    $("music-heading").textContent = list?.name || t("Your library");
    sections = list ? [{ title: "", items: list.items }] : [];
    render();
  }
  $("music-library-filter").addEventListener("input", () => {
    listFilter = $("music-library-filter").value;
    document.querySelector(".music-main-content").scrollTop = 0;
    render();
  });
  $("music-library-sort").addEventListener("change", () => {
    listSort = $("music-library-sort").value;
    render();
  });
  musicSearch = wireMusicSearch({
    form: $("music-search"),
    input: $("music-query"),
    clear: $("music-search-clear"),
    shortcut: $("music-search-shortcut"),
    isActive: () => document.querySelector("main")?.dataset.page === "music",
    onSearch: query => {
      activeMood = "";
      browseItem = null;
      searchFilter = "all";
      load("search", query);
    },
    onClear: () => {
      if (view === "search") {
        activeMood = "";
        browseItem = null;
        searchFilter = "songs";
        load("home");
      }
    },
  });
  document
    .querySelectorAll("[data-music-view]")
    .forEach(b =>
      b.addEventListener("click", () =>
        b.dataset.musicView === "home"
          ? load("home")
          : b.dataset.musicView === "library"
            ? showPlaylist(null)
            : showLocal(b.dataset.musicView),
      ),
    );
  document.querySelectorAll("[data-music-mood]").forEach(b =>
    b.addEventListener("click", () => {
      activeMood = b.dataset.musicMood;
      activeMood ? load("search", moods[activeMood], b.textContent) : load("home");
    }),
  );
  $("music-refresh").addEventListener("click", () =>
    view === "interest"
      ? showInterestMix(interestViewId)
      : view === "offline"
        ? showOffline()
        : ["library", "playlist"].includes(view)
          ? showPlaylist(playlistId)
          : ["favorites", "recent"].includes(view)
            ? showLocal(view)
            : load(lastQuery.kind, lastQuery.value, lastQuery.heading, true, lastQuery.params || ""),
  );
  $("music-start").addEventListener("click", async () => {
    const token = playRequest,
      catalogRequest = request;
    $("music-start").disabled = true;
    try {
      const personal = view === "home" && lastQuery.kind === "home" && discoveryCandidates.length > 0;
      let items = tracks(personal ? discoveryCandidates : sections.flatMap(s => s.items));
      if (!items.length) {
        const album = sections.flatMap(s => s.items).find(item => ["album", "playlist"].includes(item.kind));
        if (!album) {
          $("music-query").focus();
          return;
        }
        status(t("Finding your music…"));
        const result = await invoke("music_catalog", {
          kind: "browse",
          value: album.id,
          language: language(),
        });
        if (token !== playRequest || catalogRequest !== request) return;
        items = tracks(result.sections.flatMap(s => s.items));
      }
      if (items.length) {
        status("");
        playItems(
          items,
          items[Math.floor(Math.random() * items.length)].id,
          personal ? { kind: "personal" } : selectionContext(),
        );
      } else status(t("No music found"));
    } catch (error) {
      if (token === playRequest && catalogRequest === request) status(errorText(error), true);
    } finally {
      $("music-start").disabled = false;
    }
  });
  const shortcutHelp = createShortcutHelp({ button });
  const nudgeVolume = delta =>
    setVolume(gainFromVolumePosition(Math.max(0, Math.min(1, Number(volume.value) + delta))));
  const seekBy = delta => {
    if (!roomControlsPlayback() && Number.isFinite(audio.duration))
      audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
  };
  // The wheel seeks over the timeline and changes the volume over the speaker or its slider.
  const volumeBubble = wireVolumeBubble({ input: volume, percent: () => volumePercent(audio.volume) });
  const wheelStep = event => (event.deltaY < 0 ? 1 : -1);
  seek.closest?.(".music-seek")?.addEventListener(
    "wheel",
    event => {
      if (seek.disabled) return;
      event.preventDefault();
      seekBy(wheelStep(event) * 5);
    },
    { passive: false },
  );
  for (const node of [volumeMark, volume])
    node.addEventListener?.(
      "wheel",
      event => {
        event.preventDefault();
        nudgeVolume(wheelStep(event) * 0.05);
        volumeBubble.show();
      },
      { passive: false },
    );
  const shortcuts = {
    play: togglePlay,
    next: () => next.click(),
    previous: () => previous.click(),
    forward: () => seekBy(5),
    back: () => seekBy(-5),
    louder: () => nudgeVolume(0.05),
    quieter: () => nudgeVolume(-0.05),
    mute: () => volumeMark.click(),
    like: () => like.click(),
    shuffle: () => shuffleButton.click(),
    repeat: () => repeatButton.click(),
    queue: () => queueButton.click(),
    full: () => {
      if (document.getElementById("music-now-playing")?.open) presentation.close();
      else $("music-expand")?.click();
    },
    help: () => shortcutHelp.open(),
    recognize: () => recognizer.listen(),
    refresh: () => {
      if (!$("music-refresh").disabled) $("music-refresh").click();
    },
    slower: () => quickSpeed.slower(),
    faster: () => quickSpeed.faster(),
  };
  document.addEventListener("keydown", event => {
    if (
      document.querySelector("main").dataset.page !== "music" ||
      document.querySelector("dialog[open]:not(#music-now-playing)") ||
      document.querySelector(".music-dock-menu:popover-open")
    )
      return;
    const action = musicShortcut(event);
    if (action) {
      event.preventDefault();
      shortcuts[action]();
      return;
    }
    if (
      event.key === "Escape" &&
      !event.target.closest("input,textarea,select,button") &&
      !document.querySelector("dialog[open]")
    ) {
      queueOpen = false;
      renderQueue();
    }
  });
  document.addEventListener("contextmenu", event => {
    if (
      document.querySelector("main").dataset.page !== "music" ||
      document.querySelector("dialog[open]") ||
      event.target.closest("input,textarea,select")
    )
      return;
    const entries = contextEntries(event.target);
    if (!entries) return;
    event.preventDefault();
    const box = event.target.getBoundingClientRect(),
      keyboard = event.button !== 2;
    showContextMenu(entries, keyboard ? box.left + 12 : event.clientX, keyboard ? box.bottom : event.clientY);
  });
  document.addEventListener("pointerdown", event =>
    document.querySelectorAll(".music-track-menu[open]").forEach(menu => {
      if (!menu.contains(event.target)) menu.open = false;
    }),
  );
  window.addEventListener("resize", () =>
    document.querySelectorAll(".music-track-menu[open]").forEach(menu => {
      menu.open = false;
    }),
  );
  document.addEventListener(
    "scroll",
    event => {
      if (event.target.matches?.(".music-main-content,.music-library-sidebar"))
        document.querySelectorAll(".music-track-menu[open]").forEach(menu => {
          menu.open = false;
        });
    },
    true,
  );
  new MutationObserver(syncDock).observe(document.querySelector("main"), {
    attributes: true,
    attributeFilter: ["data-page"],
  });
  window.addEventListener("pagehide", () => {
    clearVirtualLists();
    queueList?.destroy();
    clearRecommendationObservations();
    captureListening();
    persistSession();
  });
  window.addEventListener("focus", refreshRecommendationImpressions);
  window.addEventListener("blur", refreshRecommendationImpressions);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) persistSession();
    refreshRecommendationImpressions();
  });
  onLanguageChange(() => {
    resetPublicDiscovery();
    radioAhead = null;
    offlineTab.textContent = t("Downloaded music");
    offlineTab.title = t("Downloaded music");
    offlineTab.setAttribute("aria-label", t("Downloaded music"));
    localOpen.querySelector("span:not(.icon)").textContent = t("Add files");
    localOpen.title = localOpen.ariaLabel = t("Add local music");
    const labels = { all: "All results", songs: "Songs", albums: "Albums", artists: "Artists" };
    for (const node of filters.children) {
      const label = t(labels[node.dataset.filter]);
      node.textContent = label;
      node.title = label;
      node.setAttribute("aria-label", label);
    }

    for (const [node, label] of [
      [like, t("Like this song")],
      [shuffleButton, t("Shuffle")],
      [previous, t("Previous track")],
      [next, t("Next track")],
      [repeatButton, t("Repeat queue")],
      [queueButton, t("Play queue")],
      [saveToPlaylist, t("Add to playlist")],
      [downloadButton, t("Download MP3")],
    ]) {
      node.title = label;
      node.setAttribute("aria-label", label);
    }
    dock.setAttribute("aria-label", t("Music player"));
    queuePanel.setAttribute("aria-label", t("Play queue"));
    seek.setAttribute("aria-label", t("Playback position"));
    volume.setAttribute("aria-label", t("Volume"));
    if (current && !streamLoading) artist.textContent = displaySubtitle(current);
    if (!current) {
      title.textContent = t("Pick your first track");
      artist.textContent = t("Your soundtrack starts here");
    }
    homeCache = null;
    if (loaded && document.querySelector("main").dataset.page === "music") {
      view === "interest"
        ? showInterestMix(interestViewId)
        : view === "offline"
          ? showOffline()
          : ["library", "playlist"].includes(view)
            ? showPlaylist(playlistId)
            : ["favorites", "recent"].includes(view)
              ? showLocal(view)
              : load(lastQuery.kind, lastQuery.value, lastQuery.heading, true, lastQuery.params || "");
    }
    syncDock();
    renderQueue();
  });
  librarySidebar = createMusicLibrarySidebar({
    workspace: $("devil-music"),
    saved,
    onPlaylist: showPlaylist,
    onFavorites: () => showLocal("favorites"),
    onOffline: showOffline,
    onCreate: () => library.create(),
    onHome: () => homeButton.click(),
    onSearch: () => {
      $("music-query").focus();
      $("music-query").select();
    },
    summary: () => ({ ...weekly.summary(), days: weekly.daily() }),
    cover,
    onMoveToFolder: (id, folder) => library.setFolder(id, folder),
    button,
  });
  // The listening summary opens into "Your week in music".
  if (librarySidebar.stats) {
    const findItem = id =>
      [...saved.recent, ...saved.favorites, ...(saved.playlists || []).flatMap(list => list.items)].find(
        item => item?.id === id,
      ) || null;
    const statsWindow = createStatsWindow({
      weekly,
      findItem,
      cover: item => cover(item, "", 96),
      motion: () => !matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    const card = librarySidebar.stats;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-haspopup", "dialog");
    card.addEventListener("click", () => statsWindow.open(card));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        statsWindow.open(card);
      }
    });
  }
  presentation.attachPreview($("devil-music"));
  wireMusicPanels($("devil-music"));
  const resultKeys = wireResultKeys({ input: $("music-query"), root: $("music-shelves") });
  wireMusicSuggestions({
    onArrowOut: () => resultKeys.enter(),
    invoke,
    cover,
    getRecent: () => saved.recent,
    onPick: item => {
      if (item.kind === "song") playItems([item], item.id);
      else {
        browseItem = item;
        load("browse", item.id, item.title);
      }
    },
    input: $("music-query"),
    form: $("music-search"),
    isPrivate: () => privateSession,
    getItems: () => [
      ...saved.collections,
      ...saved.recent,
      ...saved.favorites,
      ...sections.flatMap(s => s.items),
    ],
  });
  const originalStart = $("music-start");
  homeHero = createMusicHero({
    root: $("music-home-hero"),
    cover,
    onDiscover: () => originalStart.click(),
    onPlay: item => {
      if (item.id === current?.id) {
        if (audio.paused) togglePlay();
        else presentation.open();
      } else playItems([item]);
    },
  });
  const playerState = () => ({
    id: current?.id || "",
    artists: current?.artists || [],
    title: current?.title || "",
    artist: displaySubtitle(current),
    image: current?.image || "",
    playing: !audio.paused && audio.readyState >= 3 && !audio.seeking,
    active: !!current,
    previousEnabled: !previous.disabled,
    nextEnabled: !next.disabled,
    position: resolvedTrack === current?.id ? audio.currentTime : retryPosition || 0,
    duration: knownDuration || 0,
    rate: audio.playbackRate,
    volume: volumePositionFromGain(audio.volume),
    repeat,
    shuffle,
  });
  miniPlayer = createMusicMiniPlayer({
    invoke,
    button,
    extras,
    getState: playerState,
    getQueue: miniQueue,
    notify: status,
  });
  phoneRemote = createMusicRemote({
    invoke,
    button,
    extras,
    getState: playerState,
    getLyric: () => lyricLines.current(),
    notify: status,
  });
  musicRoom = createMusicRoom({
    invoke,
    button,
    extras,
    getAudio: () => audio,
    notify: status,
    onModeChange: mode => sound.setRoomMode(mode),
    getState: () => ({
      id:
        current && !isLocalMusicId(current.id)
          ? resolveRecordingSource(current, saved.sourceBindings).id
          : "",
      title: current?.title || "",
      artists: current?.artists || [],
      image: current?.image || "",
      position: resolvedTrack === current?.id ? audio.currentTime : retryPosition || 0,
      duration: knownDuration || 0,
      playing: !!current && !audio.paused && !streamLoading,
    }),
    playTrack: async (item, position) => {
      queue = [item];
      automaticQueueIds.clear();
      order.reset();
      await playAt(0, { resume: position, origin: "room", autoplay: false });
      if (resolvedTrack !== item.id) throw Error(t("Could not play. Press play to retry."));
    },
    onEnter: () => {
      captureListening();
      roomReturn = { queue: [...queue], index, position: audio.currentTime || 0 };
    },
    onLeave: () => {
      clock.reset();
      session++;
      checkpoint = 0;
      historyAdded = false;
      audio.playbackRate = 1;
      cancelResolution();
      ++playRequest;
      if (roomReturn) {
        queue = roomReturn.queue;
        index = roomReturn.index;
        const position = roomReturn.position;
        roomReturn = null;
        if (queue[index]) playAt(index, { resume: position, autoplay: false });
        else {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          current = null;
          resolvedTrack = null;
          knownDuration = 0;
          syncDock();
        }
      }
    },
  });
  // Casting to a TV or speaker; the player here keeps time silently.
  const cast = createMusicCast({
    invoke,
    button,
    decks,
    getState: playerState,
    notify: (message, error) => status(message, error),
  });
  wireMusicConnectionShortcuts(button, librarySidebar.stats);
  const shortcutsOpen = button(t("Keyboard shortcuts"), "keyboard", () => shortcutHelp.open());
  onLanguageChange(() => {
    shortcutsOpen.title = shortcutsOpen.ariaLabel = t("Keyboard shortcuts");
  });
  desktopItem = button(t("Lyrics on the desktop"), "monitor", () =>
    lyricLines.toggle().catch(error => status(errorText(error))),
  );
  desktopItem.setAttribute("aria-pressed", "false");
  onLanguageChange(() => {
    desktopItem.title = desktopItem.ariaLabel = t("Lyrics on the desktop");
  });
  // Quick speed: common speeds in More, a badge beside it when the speed is not normal, and [ and ].
  const quickSpeed = wireMusicSpeed({ sound, button, notify: message => status(message) });
  wireMusicDockMenu({
    extras,
    button,
    workspace: $("devil-music"),
    direct: [$("music-expand"), $("music-clip-open"), quickSpeed.badge, cast.badge],
    // The mini player and the phone remote live in the menu only: each action has one place, and the dock keeps
    // what is used during a song.
    shortcuts: [],
    items: [
      quickSpeed.row,
      saveToPlaylist,
      soundButton,
      sleepButton,
      downloadButton,
      el("div", "music-dock-menu-sep"),
      ...["music-mini-open", "music-room-open", "music-remote-open"].map($),
      cast.trigger,
      el("div", "music-dock-menu-sep"),
      desktopItem,
      // Edit layout lives in the Themes menu only.
      shortcutsOpen,
    ],
  });
  homeTiles = createMusicHomeTiles({
    hero: $("music-home-hero"),
    button,
    cover,
    getPlaylists: () => saved.playlists,
    onView: target => (target === "offline" ? showOffline() : showLocal(target)),
    onPlaylist: showPlaylist,
  });
  const musicLayout = wireMusicLayout({ workspace: $("devil-music") });
  wireMusicTopbar();
  // The first visit to Devil Music walks through the main controls; music settings can replay it.
  const tourSteps = () => {
    const dock = document.querySelector(".music-dock");
    return [
      {
        target: () => document.querySelector(".music-navigation-toggle"),
        title: t("Menu"),
        text: t(
          "Open the rest of Deviload from here: downloads, your media library, Cinema, Cut and Convert.",
        ),
      },
      {
        target: () => $("music-search"),
        title: t("Search"),
        text: t("Find songs, artists and albums. Ctrl+K jumps here from anywhere."),
      },
      {
        before: async () => {
          librarySidebar?.open();
          await new Promise(resolve => setTimeout(resolve, 450));
        },
        target: () => document.querySelector(".music-library-sidebar"),
        title: t("Your library"),
        text: t(
          "Playlists, liked songs, history and downloads live here. The button at the top folds it into a slim strip of covers.",
        ),
      },
      {
        target: () => $("music-import-open"),
        title: t("Bring your music"),
        text: t(
          "Move playlists over from Spotify or YouTube Music. The next screens show exactly what to copy.",
        ),
      },
      {
        target: () => document.querySelector(".music-sidebar-stats"),
        title: t("Your week in music"),
        text: t("Click the summary to see your listening time, top artists and top songs."),
      },
      {
        target: () => dock?.querySelector(".music-transport"),
        title: t("The player"),
        text: t(
          "Play, skip, shuffle and repeat. The same buttons appear in the mini-player and the full player.",
        ),
      },
      {
        target: () => dock?.querySelector(".music-stage-lyrics-trigger"),
        title: t("Lyrics"),
        text: t("Shows the words wherever you are, highlighted as they are sung."),
      },
      {
        target: () => $("music-clip-open"),
        title: t("Music video"),
        text: t("Plays the song's video in step with the music, also in the mini-player."),
      },
      {
        target: () => dock?.querySelector(".music-dock-more"),
        title: t("More"),
        text: t(
          "Sound and equalizer, sleep timer, mini-player, listening together, the phone remote and lyrics on the desktop.",
        ),
      },
      {
        target: () => $("music-settings-top"),
        title: t("Music settings"),
        text: t("Recommendations, playback, your music profile and this tour."),
      },
      {
        target: () => $("quick-theme-button"),
        title: t("Themes and layout"),
        text: t(
          "Pick a theme, put your own picture or video behind the app, or rearrange Devil Music with Edit layout.",
        ),
      },
    ];
  };
  const startTour = (force = false) => runTour({ key: "music", steps: tourSteps(), force });
  let tourQueued = false;
  const offerTour = () => {
    if (tourQueued || tourSeen("music")) return;
    tourQueued = true;
    setTimeout(() => {
      if (
        document.querySelector("dialog[open]") ||
        document.querySelector("main")?.dataset.page !== "music"
      ) {
        tourQueued = false;
        return;
      }
      startTour();
    }, 1400);
  };
  {
    const preferences = $("music-preferences");
    if (preferences) {
      const replay = button(
        t("Show the tour again"),
        "play",
        () => {
          preferences.close();
          setTimeout(() => {
            forgetTour("music");
            startTour(true);
          }, 350);
        },
        "outline small music-tour-replay",
      );
      replay.append(el("span", "", t("Show the tour again")));
      const note = preferences.querySelector(".music-session-note");
      (note || preferences).after ? note.after(replay) : preferences.append(replay);
      onLanguageChange(() => {
        replay.lastChild.textContent = t("Show the tour again");
      });
      // Under plain headings; again on every opening, for blocks added later.
      groupMusicSettings(preferences);
      preferences.addEventListener("toggle", () => {
        if (preferences.open) groupMusicSettings(preferences);
      });
    }
  }
  index = queue.findIndex(item => item.id === restored.id);
  current = queue[index] || null;
  order.restore(restored.order, queue, current?.id);
  if (current) {
    retryPosition = restored.position;
    title.textContent = current.title;
    artist.textContent = displaySubtitle(current);
    updateDockArt(current);
    elapsed.textContent = time(retryPosition);
    duration.textContent = time(knownDuration);
    seek.value = knownDuration ? String((retryPosition / knownDuration) * 1000) : "0";
  }
  window.__TAURI__?.event
    ?.listen("music-control", ({ payload }) => {
      if (payload === "previous") previous.click();
      else if (payload === "play") play.click();
      else if (payload === "next") next.click();
      else if (payload === "repeat") repeatButton.click();
      else if (payload === "shuffle") shuffleButton.click();
      else if (payload === "mute") volumeMark.click();
    })
    .then(() => syncDock())
    .catch(() => {});
  window.__TAURI__?.event
    ?.listen("music-mini-adjust", ({ payload }) => {
      const value = payload?.value;
      if (!Number.isFinite(value) || value < 0 || value > 1) return;
      if (payload.action === "volume") {
        setVolume(gainFromVolumePosition(value));
        miniPlayer?.sync();
      } else if (payload.action === "seek" && !seek.disabled) {
        seek.value = String(value * 1000);
        seek.dispatchEvent(new Event("input"));
      }
    })
    .catch(() => {});
  window.__TAURI__?.event
    ?.listen("music-mini-queue", ({ payload }) => {
      if (roomControlsPlayback()) return;
      const available = miniQueue(),
        from = available.findIndex(item => item.id === payload?.id);
      if (from < 0) return;
      if (payload.action === "play") {
        const position = queue.findIndex(item => item.id === payload.id);
        if (position >= 0) playAt(position);
      } else if (payload.action === "move") {
        const ids = available.map(item => item.id).filter(id => id !== payload.id),
          target = payload.before ? ids.indexOf(payload.before) : ids.length;
        if (target < 0) return;
        ids.splice(target, 0, payload.id);
        if (shuffle) {
          order.plan(ids);
          nextPlan = null;
          renderQueue();
          syncDock();
          persistSession();
        } else {
          const item = queue.find(item => item.id === payload.id),
            anchor = available.filter(item => item.id !== payload.id).at(-1)?.id;
          if (!anchor) return;
          queue = queue.filter(item => item.id !== payload.id);
          const before = payload.before
            ? queue.findIndex(item => item.id === payload.before)
            : queue.findIndex(item => item.id === anchor) + 1;
          queue.splice(Math.max(0, before), 0, item);
          order.sequential();
          syncQueue();
        }
        miniPlayer?.sync();
      }
    })
    .catch(() => {});
  return {
    open(entering = true) {
      syncDock();
      if (entering) offerTour();
      if (!enginePrepared) {
        enginePrepared = true;
        invoke?.("music_prepare", {}).catch(() => {});
      }
      if (
        !loading &&
        (!loaded ||
          (entering &&
            view === "home" &&
            lastQuery.kind === "home" &&
            (homeRefreshRevision !== recommendationRevision ||
              (homeListeningRevision !== listeningRevision && Date.now() - homeBuiltAt >= 600000))))
      )
        load("home");
    },
  };
}
