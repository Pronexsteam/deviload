import { t, language, errorText } from "./i18n.js";
import {
  recordingAlternatives,
  recordingDescriptor,
  resolveRecordingSource,
  videoRecordingCandidates,
} from "./music-recordings.js";
import { localRecordingCandidates, localDurationDiffers } from "./music-local-model.js";

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
function durationLabel(item) {
  const seconds =
    Number.isFinite(item?.duration) && item.duration > 0 ? item.duration : recordingDescriptor(item).duration;
  if (seconds === null) return t("Duration unknown");
  const value = Math.round(seconds),
    minutes = Math.floor(value / 60),
    tail = String(value % 60).padStart(2, "0");
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${tail}`
    : `${minutes}:${tail}`;
}

export function openRecordingPicker({ item, invoke, button, cover, bindings, save, local, resumeLabel }) {
  const previous = document.activeElement,
    modal = el("dialog", "music-library-dialog music-recording-dialog"),
    head = el("header", "music-library-dialog-head"),
    body = el("div", "music-library-dialog-body");
  modal.setAttribute("aria-label", t("Choose recording source"));
  head.append(
    el("h3", "", t("Choose recording source")),
    button(t("Close"), "x-circle", () => modal.close()),
  );
  body.append(
    el(
      "p",
      "",
      t("Choose the recording you want to play. Your likes, history and playlists keep this song."),
    ),
  );
  const current = () => resolveRecordingSource(item, bindings?.() || []);
  function trackSummary(track, label) {
    const section = el("section", "music-duplicate-group");
    if (label) section.append(el("strong", "", label));
    const row = el("div", "music-artist-choice"),
      copy = el("div", "");
    copy.style.minWidth = "0";
    copy.style.flex = "1";
    copy.style.overflowWrap = "anywhere";
    const title = el("strong", "", track.title),
      artists = el(
        "p",
        "",
        (track.artists || []).filter(name => typeof name === "string").join(", ") || t("Unknown artist"),
      );
    title.setAttribute("translate", "no");
    if ((track.artists || []).some(name => typeof name === "string" && name.trim()))
      artists.setAttribute("translate", "no");
    copy.append(title, artists, el("small", "", durationLabel(track)));
    row.append(cover(track), copy);
    section.append(row);
    return section;
  }
  body.append(trackSummary(item, t("Your song")));
  const chosen = current();
  if (chosen.id !== item.id) body.append(trackSummary(chosen, t("Current source")));
  const form = el("form", ""),
    input = el("input", "");
  input.type = "search";
  input.required = true;
  input.maxLength = 180;
  input.placeholder = t("Search by title and artist");
  input.setAttribute("aria-label", t("Search by title and artist"));
  input.value = [...(item.artists || []).filter(name => typeof name === "string"), item.title]
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 180);
  const search = el("button", "outline small", t("Search"));
  search.type = "submit";
  form.append(input, search);
  const status = el("p", "music-status"),
    results = el("div", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  let request = 0,
    closed = false,
    saving = false,
    pending = "";
  function message(value, error = false) {
    status.textContent = value;
    status.className = error ? "music-status error" : "music-status";
    status.setAttribute("role", error ? "alert" : "status");
  }
  function choose(source) {
    if (closed || saving) return;
    saving = true;
    try {
      if (save(source) === true) modal.close();
      else message(t("Could not save your music preferences."), true);
    } catch (error) {
      message(errorText(error), true);
    } finally {
      saving = false;
    }
  }
  const reset = button(t("Use original source"), null, () => choose(null), "outline small");
  reset.disabled = chosen.id === item.id;
  const actions = el("div", "music-library-actions");
  actions.append(
    reset,
    button(t("Cancel"), null, () => modal.close(), "quiet small"),
  );
  if (local) {
    const group = el("section", "music-duplicate-group"),
      query = el("input", ""),
      list = el("div", "");
    const choice = local.choice(),
      localStatus = el("p", "music-status");
    let items = [];
    group.append(
      el("h4", "", t("Exact copy on this device")),
      el(
        "p",
        "",
        t(
          "Choose a file only if it is the same recording, with the same timing. This choice stays on this device.",
        ),
      ),
    );
    if (choice)
      group.append(button(t("Remove local copy choice"), null, () => saveLocal(null), "outline small"));
    async function saveLocal(row) {
      if (closed || saving) return;
      saving = true;
      try {
        if ((await local.save(row)) === true) modal.close();
        else message(t("Could not save your music preferences."), true);
      } catch (error) {
        if (!closed) message(errorText(error), true);
      } finally {
        saving = false;
      }
    }
    query.type = "search";
    query.maxLength = 180;
    query.placeholder = t("Search local music");
    query.setAttribute("aria-label", query.placeholder);
    query.value = item.title.slice(0, 180);
    function showLocal() {
      list.replaceChildren();
      const rows = localRecordingCandidates(items, query.value);
      if (!rows.length)
        list.append(
          el("p", "", t("No matching local files. Add music to this device or change your search.")),
        );
      for (const row of rows) {
        const section = trackSummary(row),
          use = button(t("Use this exact local copy"), null, () => saveLocal(row), "outline small");
        const different = localDurationDiffers(current(), row);
        if (different)
          section.append(
            el("p", "music-import-review", t("The durations differ. Choose a file with the same timing.")),
          );
        use.disabled = different || (choice?.localId === row.id && choice.hash === row.contentHash);
        section.append(use);
        list.append(section);
      }
    }
    const openLocal = button(
      t("Search local music"),
      null,
      async () => {
        openLocal.disabled = true;
        localStatus.textContent = "";
        try {
          items = await local.items();
          if (closed) return;
          if (choice) {
            const selected = items.find(row => row.id === choice.localId && row.contentHash === choice.hash);
            if (selected) group.append(trackSummary(selected, t("Selected local copy")));
            else localStatus.textContent = t("The selected local recording is unavailable.");
          }
          openLocal.remove();
          group.append(query, list);
          showLocal();
          query.focus();
        } catch (error) {
          if (!closed) {
            localStatus.textContent = errorText(error);
            openLocal.disabled = false;
          }
        }
      },
      "outline small",
    );
    localStatus.setAttribute("role", "status");
    group.append(openLocal, localStatus);
    body.append(group);
    query.addEventListener("input", showLocal);
  }
  body.append(form, el("h4", "", t("Available recordings")), results, status, actions);
  function showRow(row) {
    const section = trackSummary(row.item),
      matched = row.confidence === "high";
    section.append(el("p", "", matched ? t("Matching metadata") : t("Check this recording")));
    const reasons = new Set(row.reasons),
      warnings = [];
    if (reasons.has("version_mismatch")) warnings.push(t("This is a different version."));
    if (reasons.has("artist_mismatch") || reasons.has("artist_overlap"))
      warnings.push(t("The artist credits differ."));
    if (reasons.has("duration_mismatch")) warnings.push(t("The duration differs."));
    if (warnings.length) section.append(el("p", "music-import-review", warnings.join(" ")));
    const used = current().id === row.item.id;
    const position = !used && resumeLabel?.(row.item);
    const label = used
      ? t("Currently used")
      : position
        ? t("Continue from {position}", { position })
        : warnings.length
          ? t("Choose this different version")
          : t("Use this source");
    const use = button(
      label,
      null,
      () => choose(row.item),
      warnings.length ? "outline small" : "music-primary",
    );
    use.disabled = used;
    section.append(use);
    results.append(section);
  }
  async function find() {
    const value = input.value.replace(/\s+/gu, " ").trim().slice(0, 180);
    if (!value || closed || pending === value) return;
    const token = ++request;
    pending = value;
    search.disabled = true;
    results.replaceChildren();
    message(t("Searching recordings…"));
    try {
      const seen = new Set();
      const live = () => !closed && token === request && modal.isConnected;
      const append = candidates => {
        if (!live()) return;
        for (const row of recordingAlternatives(item, candidates)) {
          if (seen.has(row.item.id)) continue;
          seen.add(row.item.id);
          showRow(row);
        }
        if (seen.size) message(t("Choose a source after checking the title, artist and version."));
      };
      const sources = await Promise.allSettled([
        invoke("music_catalog", { kind: "search", value, filter: "songs", language: language() }).then(data =>
          append((data.sections || []).flatMap(section => section.items || [])),
        ),
        invoke("search_media", {
          source: "youtube",
          query: [...value].slice(0, 120).join(""),
          offset: 0,
        }).then(data => append(videoRecordingCandidates(data.hits))),
      ]);
      if (!live() || seen.size) return;
      if (sources.every(source => source.status === "rejected")) throw sources[0].reason;
      message(t("No alternative recordings found. Try another search."));
    } catch (error) {
      if (!closed && token === request) message(errorText(error), true);
    } finally {
      if (!closed && token === request) {
        pending = "";
        search.disabled = false;
      }
    }
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    find();
  });
  modal.addEventListener("close", () => {
    if (closed) return;
    closed = true;
    ++request;
    modal.remove();
    if (previous?.isConnected) previous.focus();
  });
  modal.append(head, body);
  document.body.append(modal);
  modal.showModal();
  input.focus();
  find();
  return modal;
}
