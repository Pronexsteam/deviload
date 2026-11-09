import { t, onLanguageChange, locale } from "./i18n.js";
import { playlistArtwork } from "./music-playlist-art.js";

const STORAGE_KEY = "deviload-music-library-panel";
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const glyph = name => {
  const node = el("span", "icon");
  node.dataset.icon = name;
  node.setAttribute("aria-hidden", "true");
  return node;
};
const normalize = value =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .trim();

export function createMusicLibrarySidebar({
  workspace,
  saved,
  onPlaylist,
  onFavorites,
  onOffline,
  onCreate,
  onHome,
  summary,
  cover,
}) {
  const content = el("div", "music-main-content"),
    aside = el("aside", "music-library-sidebar"),
    header = el("div", "music-library-sidebar-head"),
    title = el("h3", ""),
    headActions = el("div", "music-library-sidebar-actions");
  aside.id = "music-library-panel";
  title.id = "music-library-panel-title";
  aside.setAttribute("aria-labelledby", title.id);
  content.append(...workspace.childNodes);
  workspace.append(aside, content);
  workspace.classList.add("has-library-sidebar");
  const makeButton = (cls, icon, action) => {
    const node = el("button", cls);
    node.type = "button";
    if (icon) node.append(glyph(icon));
    node.addEventListener("click", action);
    return node;
  };
  const media = window.matchMedia("(min-width:960px)");
  let preference = null,
    active = null,
    destroyed = false,
    animation = 0;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "open" || value === "closed") preference = value;
  } catch {
    /* Local preferences are optional. */
  }
  let opened = preference ? preference === "open" : media.matches;
  const toggle = makeButton("music-library-panel-toggle", "sidebar-simple", () =>
      setOpen(!opened, true, true),
    ),
    toggleText = el("span", "");
  toggle.append(toggleText);
  toggle.setAttribute("aria-controls", aside.id);
  const toolbar = content.querySelector(".music-toolbar");
  if (toolbar) toolbar.prepend(toggle);
  else content.prepend(toggle);
  const create = makeButton("music-icon-button", "plus", () => {
    if (!media.matches) setOpen(false, true, false);
    onCreate();
  });
  const close = makeButton("music-icon-button", "sidebar-simple", () => setOpen(!opened, true, true));
  headActions.append(create, close);
  header.append(title, headActions);
  const searchWrap = el("div", "music-library-sidebar-search"),
    search = el("input", "");
  search.type = "search";
  search.maxLength = 60;
  search.autocomplete = "off";
  search.spellcheck = false;
  searchWrap.append(glyph("magnifying-glass"), search);
  const list = el("nav", "music-library-sidebar-list"),
    empty = el("p", "music-library-sidebar-empty");
  empty.setAttribute("role", "status");
  const primary = el("nav", "music-primary-nav"),
    home = makeButton("music-primary-nav-link", "house-simple", () => navigate(() => onHome?.()));
  const homeLabel = el("span", "");
  home.append(homeLabel);
  primary.append(home, close);
  const body = el("div", "music-library-body");
  body.append(header, searchWrap, list, empty);
  aside.append(primary, body);
  const stats = el("section", "music-sidebar-stats"),
    statsLabel = el("span", "music-sidebar-stats-label"),
    statsValue = el("strong", ""),
    statsDetail = el("span", "music-sidebar-stats-detail"),
    statsNote = el("span", "music-sidebar-stats-note"),
    chart = el("div", "music-sidebar-stats-chart");
  chart.setAttribute("aria-hidden", "true");
  stats.append(statsLabel, statsValue, statsNote, chart, statsDetail);
  function refreshStats() {
    if (!summary || destroyed) return;
    const value = summary();
    statsLabel.textContent = t("Your last 7 days");
    statsValue.textContent = t("{minutes} min", { minutes: value.totalMinutes });
    stats.hidden = !value.totalMinutes;
    statsDetail.textContent = value.totalSeconds
      ? t("{plays} listens · On this device", { plays: value.totalQualifiedPlays })
      : t("Your next song starts the story.");
    stats.setAttribute("aria-label", t("Your last 7 days"));
    stats.title =
      statsDetail.textContent +
      " · " +
      t("Only listening on this device is counted. Private sessions are excluded.");
    const days = value.days || [],
      maximum = Math.max(1, ...days.map(day => day.seconds));
    statsNote.textContent = value.topArtist
      ? t("Mostly {artist}", { artist: value.topArtist })
      : t("{plays} listens", { plays: value.totalQualifiedPlays });
    const letter = new Intl.DateTimeFormat(locale(), { weekday: "narrow" }),
      dateLabel = new Intl.DateTimeFormat(locale(), { weekday: "short", day: "numeric", month: "short" });
    chart.replaceChildren(
      ...days.map((day, index) => {
        const date = new Date(day.date + "T12:00:00"),
          column = el("span", "music-stats-day"),
          track = el("span", "music-stats-track"),
          fill = el("span", "music-stats-fill");
        fill.style.height = day.seconds ? `${Math.max(14, (day.seconds / maximum) * 100)}%` : "0";
        track.append(fill);
        column.append(track, el("span", "music-stats-weekday", letter.format(date)));
        column.classList.toggle("is-today", index === days.length - 1);
        column.classList.toggle("is-empty", !day.seconds);
        column.title = `${dateLabel.format(date)} · ${t("{minutes} min", { minutes: Math.round(day.seconds / 60) })}`;
        return column;
      }),
    );
  }
  function setOpen(value, remember = false, focus = false) {
    // On a wide window a closed library folds into a rail of icons and covers instead of disappearing.
    const rail = !value && media.matches;
    // Folding and unfolding glide; window resizes stay immediate.
    if (value !== opened && workspace.isConnected) {
      workspace.classList.add("music-library-animating");
      clearTimeout(animation);
      animation = setTimeout(() => workspace.classList.remove("music-library-animating"), 620);
    }
    opened = value;
    aside.hidden = !value && !rail;
    workspace.classList.toggle("library-panel-open", value);
    workspace.classList.toggle("music-library-rail", rail);
    document.body.classList.toggle(
      "music-rail-start",
      rail && !workspace.classList.contains("music-panels-swapped"),
    );
    toggle.setAttribute("aria-expanded", String(value));
    closeLabel();
    if (remember) {
      preference = value ? "open" : "closed";
      try {
        localStorage.setItem(STORAGE_KEY, preference);
      } catch {
        /* Remain usable with denied storage. */
      }
    }
    if (focus) {
      if (value && !media.matches) home.focus();
      else if (!value) toggle.focus();
    }
  }
  function closeLabel() {
    const label = opened ? t("Collapse library") : t("Expand library");
    close.title = label;
    close.setAttribute("aria-label", label);
    close.setAttribute("aria-expanded", String(opened));
  }
  function navigate(callback) {
    if (!media.matches) setOpen(false, true, false);
    callback();
  }
  function row(name, count, art, action, id, pinned = false, description = null) {
    const node = makeButton("music-library-nav-item", null, () => navigate(action)),
      copy = el("span", "music-library-nav-copy"),
      label = el("strong", "", name),
      meta = el("small", "", description ?? t("{count} tracks", { count }));
    if (pinned) {
      const pin = el("span", "music-library-nav-pin", "★");
      pin.setAttribute("aria-label", t("Pinned playlist"));
      meta.prepend(pin);
    }
    copy.append(label, meta);
    node.append(art, copy);
    node.title = name;
    node.dataset.collection = id;
    node.classList.toggle("selected", active === id);
    if (active === id) node.setAttribute("aria-current", "page");
    return node;
  }
  function refresh(activeId) {
    if (destroyed) return;
    if (activeId !== undefined) active = activeId;
    home.setAttribute("aria-current", active === "home" ? "page" : "false");
    const query = normalize(search.value);
    list.replaceChildren();
    {
      const heart = el("span", "music-library-nav-art music-library-liked-art", "♥");
      heart.setAttribute("aria-hidden", "true");
      list.append(row(t("Liked songs"), saved.favorites?.length || 0, heart, onFavorites, "favorites"));
    }
    if (onOffline) {
      const art = el("span", "music-library-nav-art");
      art.append(glyph("download-simple"));
      list.append(
        row(t("Downloaded music"), null, art, onOffline, "offline", false, t("Available without internet")),
      );
    }
    const playlists = [...(saved.playlists || [])].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
    let matchingPlaylists = 0;
    for (const playlist of playlists) {
      if (query && !normalize(playlist.name).includes(query)) continue;
      matchingPlaylists++;
      const art = el("span", "music-library-nav-art");
      if (cover) art.append(playlistArtwork(playlist, cover, 96));
      else art.append(glyph("playlist"));
      list.append(
        row(
          playlist.name,
          playlist.items?.length || 0,
          art,
          () => onPlaylist(playlist.id),
          playlist.id,
          playlist.pinned,
        ),
      );
    }
    empty.textContent = query
      ? t("No matching playlists.")
      : t("Create a playlist to keep your favorites close.");
    empty.hidden = query ? matchingPlaylists > 0 : playlists.length > 0;
  }
  function translate() {
    if (destroyed) return;
    title.textContent = t("Playlists");
    list.setAttribute("aria-label", t("Your library"));
    toggleText.textContent = t("Your library");
    toggle.title = t("Show or hide your music library");
    toggle.setAttribute("aria-label", t("Show or hide your music library"));
    homeLabel.textContent = t("Music home");
    primary.setAttribute("aria-label", t("Devil Music"));
    toggleText.textContent = t("Library");
    create.title = t("Create playlist");
    create.setAttribute("aria-label", t("Create playlist"));
    closeLabel();
    search.placeholder = t("Search your playlists");
    search.setAttribute("aria-label", t("Search your playlists"));
    refresh();
    refreshStats();
  }
  const onResize = () => {
    setOpen(preference === null ? media.matches : opened);
  };
  const onEscape = event => {
    if (event.key === "Escape" && opened) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false, true, true);
    }
  };
  search.addEventListener("input", () => refresh());
  aside.addEventListener("keydown", onEscape);
  media.addEventListener("change", onResize);
  onLanguageChange(translate);
  translate();
  setOpen(opened);
  return {
    refresh,
    refreshStats,
    stats: summary ? stats : null,
    open() {
      if (!opened) setOpen(true, false, false);
    },
    get opened() {
      return opened;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      media.removeEventListener("change", onResize);
      aside.removeEventListener("keydown", onEscape);
      stats.remove();
      toggle.remove();
      aside.remove();
      content.replaceWith(...content.childNodes);
      workspace.classList.remove("has-library-sidebar", "library-panel-open");
    },
  };
}
