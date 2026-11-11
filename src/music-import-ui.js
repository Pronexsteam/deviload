import { t, language, errorText } from "./i18n.js";
import { parseMusicImport } from "./music-import-format.js";
import { resolveMusicImportLibrary, readPlaylistLink, createMatchMemory } from "./music-import-resolver.js";
import { readImportDraft, writeImportDraft, clearImportDraft } from "./music-import-session.js";
import { showTip } from "./music-tour.js";
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
// Seconds as m:ss for the reading timer.
export const formatElapsed = seconds => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

export function wireMusicImport({ invoke, button, commit, storage = window.localStorage }) {
  const matchMemory = createMatchMemory(storage);
  function open() {
    const modal = el("dialog", "music-import-dialog"),
      head = el("header", "music-library-dialog-head"),
      body = el("div", "music-import-body"),
      notice = el("p", "music-import-status");
    notice.setAttribute("role", "status");
    modal.setAttribute("aria-label", t("Bring your music"));
    let controller = null,
      batch = null,
      rows = [],
      busy = false,
      reading = false,
      cancelImport = false,
      service = "spotify";
    const selected = new Set(),
      boxes = new Map();
    let shown = 200,
      lastPersist = 0;
    head.append(
      el("h2", "", t("Bring your music")),
      button(t("Close"), "x-circle", () => modal.close()),
    );
    const intro = el("p", "", t("Bring your favorite music with you. Your current library stays."));
    const resume = button(
      t("Resume unfinished import"),
      null,
      () => {
        if (busy || reading) return;
        const draft = readImportDraft(storage);
        if (!draft) return;
        setBatch(draft.batch);
        name.value = draft.name || draft.batch.name;
        destination.value = draft.destination;
        syncDestination();
        subset.value = draft.subset;
        if (!subset.value) subset.value = "all";
        use.checked = draft.useForTaste;
        rows = draft.rows;
        applied.clear();
        draft.applied.forEach(key => applied.add(key));
        selected.clear();
        const restoredSelection = new Set(draft.selected);
        rows
          .filter(row => restoredSelection.has(row.entry.key) && !applied.has(row.entry.key))
          .forEach(row => selected.add(row));
        renderRows();
        review.open = true;
        showRows();
        resume.hidden = true;
        // An unfinished import goes straight to its review, with a way back to the sources.
        start.hidden = true;
        step.hidden = false;
        linkArea.hidden = fileArea.hidden = true;
        stepList.replaceChildren();
        stepTitle.textContent = t("Resume unfinished import");
      },
      "music-primary",
    );
    resume.hidden = !readImportDraft(storage);
    function persist() {
      if (!batch) return;
      try {
        if (batch.entries.every(entry => applied.has(entry.key))) {
          clearImportDraft(storage);
          return;
        }
        writeImportDraft(storage, {
          batch,
          rows,
          selected: [...selected].map(row => row.entry.key),
          applied: [...applied],
          destination: destination.value,
          name: name.value,
          subset: subset.value,
          useForTaste: use.checked,
        });
      } catch {
        notice.textContent = t(
          "Could not save import progress. Save the remaining songs as JSON before closing.",
        );
      }
    }
    const sources = el("div", "music-import-sources"),
      guide = el("p", "music-import-guide");
    const spotify = button("Spotify", null, () => choose("spotify"), "music-filter-chip"),
      youtube = button("YouTube Music", null, () => choose("youtube"), "music-filter-chip");
    sources.append(spotify, youtube);
    const help = button(
      t("Open export page"),
      null,
      async () => {
        const url =
          service === "spotify" ? "https://www.spotify.com/account/privacy/" : "https://takeout.google.com/";
        try {
          if (window.__TAURI__?.core?.invoke) await invoke("open_music_import_help", { service });
          else window.open(url, "_blank", "noopener,noreferrer");
        } catch (error) {
          notice.textContent = errorText(error);
        }
      },
      "quiet small",
    );
    function choose(value) {
      service = value;
      spotify.setAttribute("aria-pressed", String(value === "spotify"));
      youtube.setAttribute("aria-pressed", String(value === "youtube"));
      guide.textContent =
        value === "spotify"
          ? t("Paste a public Spotify playlist link. No sign-in or export file is needed.")
          : t(
              "Paste a public playlist link below, or export YouTube and YouTube Music using Google Takeout and choose the ZIP here.",
            );
    }
    const file = el("input", "");
    file.type = "file";
    file.accept = ".json,.csv";
    file.multiple = true;
    file.hidden = true;
    const pick = button(
      t("Choose music export"),
      null,
      () => {
        if (busy || reading) return;
        if (window.__TAURI__?.core?.invoke) receiveFiles(() => invoke("read_music_import", {}));
        else file.click();
      },
      "music-primary",
    );
    async function receiveFiles(load) {
      if (busy || reading) return;
      reading = true;
      pick.disabled = read.disabled = true;
      try {
        const files = await load();
        if (modal.isConnected && files.length) acceptFiles(files);
      } catch (error) {
        if (modal.isConnected) notice.textContent = errorText(error);
      } finally {
        reading = false;
        if (!busy) pick.disabled = read.disabled = false;
      }
    }
    const drop = el("div", "music-import-drop", t("Or drop JSON / CSV files here"));
    drop.addEventListener("dragover", event => {
      event.preventDefault();
      drop.classList.add("is-over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
    drop.addEventListener("drop", event => {
      event.preventDefault();
      drop.classList.remove("is-over");
      if (!busy) readFiles([...event.dataTransfer.files]);
    });
    async function readFiles(files) {
      await receiveFiles(async () => {
        if (!files.length) return [];
        if (files.length > 100 || files.reduce((n, f) => n + f.size, 0) > 50 * 1024 * 1024)
          throw Error(t("Choose music exports up to 50 MB in total."));
        if (files.some(f => !/\.(json|csv)$/i.test(f.name)))
          throw Error(t("Choose JSON or CSV files here. ZIP import is available in the installed app."));
        return Promise.all(files.map(async f => ({ name: f.name, text: await f.text() })));
      });
    }
    file.addEventListener("change", () => {
      readFiles([...file.files]);
      file.value = "";
    });
    const linkForm = el("form", "music-import-link"),
      link = el("input", "");
    link.type = "url";
    link.placeholder = t("Spotify playlist or album, YouTube playlist or Mix link");
    link.setAttribute("aria-label", link.placeholder);
    link.required = true;
    const read = el("button", "outline small", t("Read link"));
    read.type = "submit";
    linkForm.append(link, read);
    const preview = el("section", "music-import-preview");
    preview.hidden = true;
    const coverage = el("p", "music-import-coverage");
    coverage.setAttribute("role", "status");
    // Where the songs go: three buttons side by side instead of a list to open.
    const destinationLabel = el("div", "music-import-field"),
      destination = el("select", ""),
      destinationChips = el("div", "music-import-segments");
    destination.hidden = true;
    destinationChips.setAttribute("role", "group");
    destinationChips.setAttribute("aria-label", t("Save songs to"));
    for (const [value, title] of [
      ["export", t("As in the source")],
      ["favorites", t("Liked songs")],
      ["playlist", t("A separate playlist")],
    ]) {
      const option = el("option", "", title);
      option.value = value;
      destination.append(option);
      const chip = el("button", "music-import-segment", title);
      chip.type = "button";
      chip.dataset.value = value;
      chip.addEventListener("click", () => {
        if (busy || reading) return;
        destination.value = value;
        syncDestination();
        persist();
      });
      destinationChips.append(chip);
    }
    destinationLabel.append(
      el("span", "music-import-field-label", t("Save songs to")),
      destinationChips,
      destination,
    );
    // The name matters only for a separate playlist.
    function syncDestination() {
      for (const chip of destinationChips.children)
        chip.setAttribute("aria-pressed", String(chip.dataset.value === destination.value));
      nameLabel.hidden = destination.value !== "playlist";
    }
    const destinationHint = el(
      "p",
      "music-import-caption",
      t("Liked songs influence recommendations. A separate playlist does not mark songs as liked."),
    );
    const nameLabel = el("label", "", t("Imported playlist name")),
      name = el("input", "");
    name.maxLength = 60;
    nameLabel.append(name);
    const subsetLabel = el("label", "", t("Music to transfer")),
      subset = el("select", "");
    subsetLabel.append(subset);
    const summary = el("p", ""),
      warnings = el("div", "music-import-warnings"),
      matchingNote = el(
        "p",
        "music-import-caption",
        t(
          "Matching sends song titles and artist names to YouTube Music. Other export data stays on this computer.",
        ),
      );
    const progress = el("progress", "music-import-progress");
    progress.setAttribute("aria-label", t("Find my music"));
    const meter = el("div", "music-import-meter"),
      meterText = el("span", "music-import-meter-text");
    meterText.setAttribute("role", "status");
    meter.hidden = true;
    meter.append(meterText, progress);
    // One tally of the chosen songs: the meter, the review heading and the hint beside Add all read it,
    // so their numbers tell one story (checked, found, found but to check, not found).
    const tally = () => {
      const keys = new Set(chosenEntries().map(entry => entry.key)),
        mine = rows.filter(row => keys.has(row.entry.key)),
        found = mine.filter(row => row.item);
      return {
        total: keys.size,
        found: found.length,
        check: found.filter(row => row.confidence === "review" && !applied.has(row.entry.key)).length,
        missing: mine.filter(row => !row.item).length,
      };
    };
    const finalMeter = () => {
      const now = tally();
      return [
        t("Found {found} of {total}", { found: now.found, total: now.total }),
        now.check ? t("{count} to check", { count: now.check }) : "",
        now.missing ? t("{count} not found", { count: now.missing }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
    };
    async function matchBatch(signal) {
      const ready = new Set([...applied, ...rows.filter(row => row.item).map(row => row.entry.key)]),
        pending = chosenEntries().filter(entry => !ready.has(entry.key));
      rows = rows.filter(row => row.item);
      renderRows();
      review.open = true;
      meter.hidden = false;
      meter.classList.add("is-running");
      progress.max = chosenEntries().length;
      const readyCount = chosenEntries().filter(entry => ready.has(entry.key)).length;
      progress.value = readyCount;
      await resolveMusicImportLibrary(pending, {
        invoke,
        language: language(),
        signal,
        memory: matchMemory,
        onRow: row => {
          rows.push(row);
          showRow(row);
          // The counts grow with the search, not only at its end.
          updateSelection();
          if (rows.length % 25 === 0 && performance.now() - lastPersist > 2000) {
            lastPersist = performance.now();
            persist();
          }
        },
        onProgress: done => {
          progress.value = readyCount + done;
          meterText.textContent = t("Searching YouTube Music… checked {done} of {total}, found {found}", {
            done: readyCount + done,
            total: progress.max,
            found: tally().found,
          });
        },
      });
      meter.classList.remove("is-running");
      meterText.textContent = finalMeter();
      showRows();
    }
    const match = button(t("Find my music"), null, () => run(matchBatch), "outline small");
    const results = el("div", "music-import-results"),
      useLabel = el("label", "music-import-use"),
      use = el("input", "");
    use.type = "checkbox";
    use.checked = false;
    useLabel.append(use, el("span", "", t("Use these songs to improve my recommendations")));
    const applied = new Set();
    const apply = button(
      t("Add selected songs"),
      null,
      async () => {
        if (busy || reading) return;
        busy = true;
        updateSelection();
        try {
          const byKey = new Map(rows.map(row => [row.entry.key, row]));
          const chosen = chosenEntries()
            .map(entry => byKey.get(entry.key))
            .filter(row => selected.has(row) && !applied.has(row.entry.key));
          if (!chosen.length) return;
          const mapped = chosen.map(row => ({
            ...row,
            entry: {
              ...row.entry,
              liked: destination.value === "favorites" || (destination.value === "export" && row.entry.liked),
            },
          }));
          const value = await commit(
            { rows: mapped, name: name.value.trim() || t("Imported music"), source: batch.source },
            { useForTaste: use.checked },
          );
          chosen.forEach(row => {
            applied.add(row.entry.key);
            selected.delete(row);
          });
          renderRows();
          updateSelection();
          notice.textContent = t("Music added: {count}. Your previous library is preserved.", {
            count: value.added,
          });
          persist();
        } catch (error) {
          notice.textContent = errorText(error);
        } finally {
          busy = false;
          updateSelection();
        }
      },
      "music-primary",
    );
    apply.disabled = true;
    const selectionHint = el("p", "music-import-caption music-import-hint");
    selectionHint.hidden = true;
    const review = el("details", "music-import-review-details"),
      reviewTitle = el("summary", "", "");
    const selectionTools = el("div", "music-import-selection");
    const selectAll = button(t("Select all"), null, () => setAll(true), "quiet small");
    const clearSelection = button(t("Clear selection"), null, () => setAll(false), "quiet small");
    const selectionCount = el("span", "music-import-selection-count");
    selectionCount.setAttribute("role", "status");
    selectionTools.append(selectAll, clearSelection, selectionCount);
    const moreRows = button(
      t("Load more"),
      null,
      () => {
        shown += 200;
        renderRows();
        updateSelection();
      },
      "quiet small",
    );
    moreRows.hidden = true;
    review.append(reviewTitle, selectionTools, results, moreRows);
    function renderRows() {
      results.replaceChildren();
      boxes.clear();
      rows.forEach(showRow);
    }
    function setAll(value) {
      if (busy || reading) return;
      for (const row of rows) {
        if (row.item && !applied.has(row.entry.key)) {
          row.reviewed = true;
          if (value) selected.add(row);
          else selected.delete(row);
        }
      }
      for (const [row, box] of boxes) box.checked = selected.has(row);
      updateSelection();
      persist();
    }
    function updateSelection() {
      const available = rows.filter(row => row.item && !applied.has(row.entry.key));
      selectAll.disabled = busy || reading || !available.some(row => !selected.has(row));
      clearSelection.disabled = busy || reading || !selected.size;
      apply.disabled = busy || reading || !selected.size;
      apply.textContent = selected.size
        ? t("Add {count} songs", { count: selected.size })
        : t("Add selected songs");
      selectionCount.textContent = t("{count} selected", { count: selected.size });
      moreRows.hidden = rows.length <= shown;
      const now = tally();
      reviewTitle.textContent = t("Found songs ({count})", { count: available.length });
      // Songs marked to check are left unticked: the hint says why Add counts fewer than were found.
      const unticked = available.filter(row => !selected.has(row)).length;
      selectionHint.textContent =
        unticked && now.check
          ? t("{count} songs marked to check are not selected. Tick them if the version is right.", {
              count: Math.min(unticked, now.check),
            })
          : "";
      selectionHint.hidden = !selectionHint.textContent;
      if (!busy && rows.length && !meter.hidden) meterText.textContent = finalMeter();
      // Search again only for songs still missing; save to a file only what could not be found.
      const done = new Set([...applied, ...rows.filter(row => row.item).map(row => row.entry.key)]);
      const missing = batch ? chosenEntries().filter(entry => !done.has(entry.key)).length : 0;
      match.hidden = !batch || busy || (rows.length > 0 && missing === 0);
      report.hidden = !rows.some(row => !row.item && !applied.has(row.entry.key));
      // Once the search has begun, the directions before it have done their job.
      summary.hidden = matchingNote.hidden = rows.length > 0;
    }
    const report = button(
      t("Save remaining songs"),
      null,
      () => {
        const remaining = chosenEntries()
          .filter(entry => !applied.has(entry.key))
          .map(entry => ({
            title: entry.title,
            artists: entry.artists,
            spotifyId: entry.spotifyId,
            durationMs: entry.durationMs,
            album: entry.album,
            isrc: entry.isrc,
            liked: destination.value === "favorites" || (destination.value === "export" && entry.liked),
          }));
        const blob = new Blob(
            [
              JSON.stringify(
                { tracks: remaining, unidentified: batch.unidentified || [], warnings: batch.warnings },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
          url = URL.createObjectURL(blob),
          anchor = el("a", "");
        anchor.href = url;
        anchor.download = "devil-music-remaining.json";
        modal.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      "outline small",
    );
    const cancel = button(t("Stop matching"), null, () => controller?.abort(), "outline small");
    cancel.hidden = true;
    const discard = button(
      t("Cancel import"),
      null,
      () => {
        cancelImport = true;
        controller?.abort();
      },
      "quiet small",
    );
    discard.hidden = true;
    function chosenEntries() {
      if (!batch) return [];
      const choice = subset.value;
      if (choice === "all") return batch.entries;
      const keys = new Set(batch.playlists[Number(choice)]?.keys || []);
      return batch.entries.filter(entry => keys.has(entry.key));
    }
    function refreshSelection() {
      const entries = chosenEntries();
      summary.textContent = t("{count} songs found. Check the destination, then find matching songs.", {
        count: entries.length,
      });
      match.disabled = busy || !entries.length;
      rows = [];
      selected.clear();
      results.replaceChildren();
      boxes.clear();
      shown = 200;
      updateSelection();
      meter.hidden = true;
    }
    subset.addEventListener("change", () => {
      refreshSelection();
      persist();
    });
    for (const input of [name, destination, use]) input.addEventListener("change", persist);
    function setBatch(value) {
      batch = value;
      completeFile.hidden = value.completeness !== "unknown";
      coverage.textContent =
        value.origin === "account"
          ? t("{songs} songs in {lists} lists.", {
              songs: value.entries.length,
              lists: value.playlists.length,
            })
          : value.completeness === "complete" && Number.isSafeInteger(value.reportedTotal)
            ? t("Spotify playlist read: {received} / {total} entries. {unavailable} unavailable.", {
                received: value.receivedCount,
                total: value.reportedTotal,
                unavailable: value.unavailableCount || 0,
              })
            : value.completeness === "unknown"
              ? t(
                  "Spotify returned {count} songs in a public preview. The full playlist size is unknown. You can transfer these songs or choose an export file below.",
                  { count: value.entries.length },
                )
              : "";
      coverage.hidden = !coverage.textContent;
      applied.clear();
      match.textContent = t("Find my music");
      destination.value =
        value.entries.length && value.entries.every(entry => entry.liked)
          ? "favorites"
          : value.origin === "link"
            ? "playlist"
            : "export";
      preview.hidden = false;
      name.value = value.name.slice(0, 60);
      subset.replaceChildren();
      const all = el("option", "", t("All imported music"));
      all.value = "all";
      subset.append(all);
      value.playlists.forEach((list, index) => {
        const option = el("option", "", list.name);
        option.value = String(index);
        subset.append(option);
      });
      subsetLabel.hidden = value.playlists.length <= 1;
      syncDestination();
      warnings.replaceChildren(...value.warnings.map(message => el("p", "", t(message))));
      refreshSelection();
      notice.textContent = "";
      resume.hidden = true;
      persist();
    }
    function acceptFiles(files) {
      const entries = new Map(),
        playlists = [],
        issues = [],
        sources = new Set();
      let firstName = "";
      for (const file of files) {
        try {
          const parsed = parseMusicImport(file.text, file.name);
          firstName ||= parsed.name;
          sources.add(parsed.source);
          playlists.push(...parsed.playlists);
          issues.push(...parsed.warnings);
          for (const entry of parsed.entries) {
            const old = entries.get(entry.key);
            entries.set(
              entry.key,
              old
                ? {
                    ...old,
                    ...entry,
                    title: entry.title || old.title,
                    artists: entry.artists.length ? entry.artists : old.artists,
                    liked: old.liked || entry.liked,
                    plays: Math.max(old.plays, entry.plays),
                    lastPlayed: Math.max(old.lastPlayed || 0, entry.lastPlayed || 0),
                  }
                : entry,
            );
          }
        } catch (error) {
          issues.push(error.message);
        }
      }
      if (!entries.size) throw Error(issues.length ? t(issues[0]) : t("No importable music was found."));
      setBatch({
        source: [...sources].sort().join("+"),
        name: files.length === 1 ? firstName : t("Imported music"),
        entries: [...entries.values()],
        playlists,
        warnings: [...new Set(issues)],
      });
    }
    function showRow(row) {
      const label = el("label", "music-import-result"),
        box = el("input", "");
      box.type = "checkbox";
      box.disabled = !row.item || applied.has(row.entry.key);
      box.checked = !box.disabled && (selected.has(row) || (!row.reviewed && row.confidence === "exact"));
      row.reviewed = true;
      if (box.checked) selected.add(row);
      if (results.children.length >= shown) return;
      boxes.set(row, box);
      box.addEventListener("change", () => {
        box.checked ? selected.add(row) : selected.delete(row);
        updateSelection();
        persist();
      });
      const copy = el("span", "music-import-result-copy"),
        cover = el("span", "music-import-thumb"),
        song = row.item || row.entry;
      if (row.item?.image) {
        const image = el("img", "");
        image.src = row.item.image;
        image.alt = "";
        image.loading = "lazy";
        cover.append(image);
      }
      copy.append(
        el("strong", "", song.title || row.entry.videoId),
        el("small", "", (song.artists || []).join(", ")),
      );
      const plain = value =>
        String(value || "")
          .toLocaleLowerCase()
          .replace(/\s+/g, " ")
          .trim();
      if (row.item && plain(row.item.title) !== plain(row.entry.title))
        copy.append(el("small", "music-import-from", t("From: {title}", { title: row.entry.title })));
      const status = applied.has(row.entry.key)
        ? t("Added")
        : row.error
          ? t(row.error)
          : row.confidence === "review"
            ? t("Check this version before selecting")
            : row.item
              ? ""
              : t("No match found");
      label.dataset.state = applied.has(row.entry.key) ? "added" : row.item ? row.confidence : "none";
      label.append(box, cover, copy);
      if (status) label.append(el("small", "music-import-pill", status));
      results.append(label);
    }
    function showRows() {
      notice.textContent = t("{ready} songs ready. {review} need review.", {
        ready: selected.size,
        review: chosenEntries().filter(entry => !applied.has(entry.key)).length - selected.size,
      });
      updateSelection();
    }
    async function run(action) {
      if (busy || reading) return;
      busy = true;
      updateSelection();
      cancelImport = false;
      controller = new AbortController();
      pick.disabled =
        read.disabled =
        link.disabled =
        match.disabled =
        subset.disabled =
        destination.disabled =
        name.disabled =
        apply.disabled =
        report.disabled =
          true;
      cancel.hidden = discard.hidden = false;
      try {
        await action(controller.signal);
      } catch (error) {
        if (error.name === "AbortError") {
          if (cancelImport) {
            clearImportDraft(storage);
            batch = null;
            rows = [];
            selected.clear();
            results.replaceChildren();
            preview.hidden = true;
            notice.textContent = t("Music import canceled.");
          } else
            notice.textContent = t("Matching stopped. {count} songs are ready to add.", {
              count: selected.size,
            });
        } else notice.textContent = errorText(error);
      } finally {
        busy = false;
        controller = null;
        pick.disabled =
          read.disabled =
          link.disabled =
          subset.disabled =
          destination.disabled =
          name.disabled =
          report.disabled =
            false;
        match.disabled = !batch || chosenEntries().length === 0;
        match.textContent = t(rows.length ? "Continue matching missing songs" : "Find my music");
        apply.disabled = !selected.size;
        cancel.hidden = discard.hidden = true;
        meter.classList.remove("is-running");
        updateSelection();
        persist();
      }
    }
    linkForm.addEventListener("submit", event => {
      event.preventDefault();
      run(async signal => {
        notice.textContent = t("Reading playlist: {count} songs", { count: 0 });
        const value = await readPlaylistLink(link.value, {
          invoke,
          language: language(),
          signal,
          onProgress: count => (notice.textContent = t("Reading playlist: {count} songs", { count })),
        });
        const fallbackNames = {
          "Imported YouTube Music playlist": t("Imported YouTube Music playlist"),
          "Imported Spotify playlist": t("Imported Spotify playlist"),
          "Imported Spotify album": t("Imported Spotify album"),
          "Imported YouTube Mix": t("Imported YouTube Mix"),
        };
        setBatch({ ...value, name: fallbackNames[value.name] || value.name });
      });
    });
    // Step one: choose where the music comes from. Step two: short directions and the matching field.
    const SOURCES = [
      {
        key: "youtube-account",
        brand: "youtubemusic",
        title: t("My YouTube Music library"),
        text: t("Liked songs and your playlists, read through your YouTube sign-in on this computer."),
        command: "music_import_youtube_account",
        account: "youtube",
        signIn: {
          status: "youtube_login_status",
          open: ["open_youtube", { signIn: true }],
          event: "youtube-session",
        },
        steps: [
          t("Sign in to YouTube if you have not yet."),
          t("Press Read my library. Only song lists are read; nothing changes in your account."),
          t("Check the matches, then add the songs you want."),
        ],
      },
      {
        key: "spotify-account",
        brand: "spotify",
        title: t("My Spotify library"),
        text: t("Liked Songs and your playlists, private ones included, through your own Spotify sign-in."),
        command: "music_import_spotify_account",
        account: "spotify",
        signIn: { status: "spotify_account_status", open: ["spotify_sign_in", {}], event: "spotify-session" },
        steps: [
          t("Sign in to Spotify in the window that opens. Deviload keeps the sign-in on this computer only."),
          t("Press Read my library. Only song lists are read; nothing changes in your account."),
          t("Check the matches, then add the songs you want."),
        ],
      },
      {
        key: "file",
        icon: "files",
        title: t("Your whole library from a file"),
        text: t("Liked songs and every playlist from a Spotify or Google export."),
        steps: [
          t("Ask for your data on the Spotify privacy page, or use Google Takeout for YouTube Music."),
          t("The export arrives by email, usually within a few days."),
          t("Choose its JSON, CSV or ZIP files here."),
        ],
      },
    ];
    const start = el("section", "music-import-start"),
      cards = el("div", "music-import-cards");
    const linkStart = el("div", "music-import-link-start");
    linkStart.append(el("p", "music-import-or", t("Or paste a link to a playlist, album or Mix")), linkForm);
    const fileLink = button(
      t("I have a data export file"),
      "files",
      () => {
        if (busy || reading) return;
        showStep(SOURCES.find(source => source.key === "file"));
      },
      "quiet small music-import-file-link",
    );
    fileLink.append(el("span", "", t("I have a data export file")));
    start.append(intro, resume, cards, linkStart, fileLink);
    const step = el("section", "music-import-step"),
      back = button(
        t("All sources"),
        "arrow-left",
        () => {
          if (busy || reading) return;
          showStart();
        },
        "quiet small music-import-back",
      );
    back.append(el("span", "", t("All sources")));
    const stepHead = el("div", "music-import-step-head"),
      stepTitle = el("h3", ""),
      stepList = el("ol", "music-import-steps");
    stepHead.append(el("span", "music-import-art"), stepTitle);
    const linkArea = el("div", "music-import-link-area"),
      fileArea = el("div", "music-import-file-area");
    fileArea.append(sources, guide, pick, file, drop, help);
    // Libraries read through the person's own sign-in: no link or file, one button.
    const accountArea = el("div", "music-import-account-area"),
      accountState = el("span", "music-import-account-state"),
      readingBar = el("div", "music-import-meter is-running music-import-reading"),
      readingText = el("span", "music-import-meter-text"),
      readingTrack = el("div", "music-import-bar");
    readingText.setAttribute("role", "status");
    readingTrack.append(el("span", ""));
    readingBar.append(readingText, readingTrack);
    readingBar.hidden = true;
    let accountSource = null,
      signedIn = false,
      readingTimer = null;
    const signIn = button(
      t("Sign in"),
      null,
      async () => {
        if (!accountSource) return;
        try {
          const [command, args] = accountSource.signIn.open;
          await invoke(command, args);
        } catch (error) {
          notice.textContent = errorText(error);
        }
      },
      "music-account-in",
    );
    function showAccount() {
      accountState.textContent = signedIn ? t("Signed in") : t("Sign-in needed");
      accountState.dataset.signedIn = String(signedIn);
      signIn.hidden = signedIn;
      if (accountSource) {
        signIn.className = `music-account-in music-account-in-${accountSource.account}`;
        signIn.textContent =
          accountSource.account === "spotify" ? t("Sign in with Spotify") : t("Sign in with YouTube");
      }
      // Once signed in, the step about signing in is done and steps aside.
      if (stepList.firstElementChild) stepList.firstElementChild.hidden = signedIn;
      readAccount.disabled = !signedIn || busy;
    }
    async function checkAccount() {
      const source = accountSource;
      if (!source) return;
      try {
        signedIn = !!(await invoke(source.signIn.status));
      } catch {
        signedIn = false;
      }
      if (source === accountSource) showAccount();
    }
    // A sign-in finished in its own window updates this step; the listeners end with the dialog.
    const sessionListeners = ["youtube-session", "spotify-session"].map(name =>
      window.__TAURI__?.event?.listen?.(name, () => {
        checkAccount();
        refreshChips();
      }),
    );
    const readAccount = button(
      t("Read my library"),
      null,
      () =>
        run(async signal => {
          // A large library takes a minute or two: a moving bar and the time so far show it is still working.
          const started = performance.now();
          const tick = () =>
            (readingText.textContent = t("Reading your library… {time}", {
              time: formatElapsed((performance.now() - started) / 1000),
            }));
          notice.textContent = "";
          tick();
          readingBar.hidden = false;
          readAccount.disabled = true;
          readingTimer = setInterval(tick, 1000);
          let value;
          try {
            value = await invoke(accountSource.command);
          } finally {
            clearInterval(readingTimer);
            readingTimer = null;
            readingBar.hidden = true;
          }
          if (!Array.isArray(value?.entries) || !Array.isArray(value?.playlists))
            throw Error("No importable music was found.");
          const names = {
            "My YouTube Music library": t("My YouTube Music library"),
            "Liked music": t("Liked music"),
            "My Spotify library": t("My Spotify library"),
            "Liked Songs": t("Liked Songs"),
          };
          setBatch({
            ...value,
            name: names[value.name] || value.name,
            playlists: value.playlists.map(list => ({ ...list, name: names[list.name] || list.name })),
            warnings: Array.isArray(value.warnings) ? value.warnings : [],
          });
          stepList.hidden = true;
          readAccount.textContent = t("Read again");
          readAccount.className = "quiet small";
          // A whole library is read to be matched: matching starts at once instead of waiting for another press.
          if (chosenEntries().length) await matchBatch(signal);
        }).finally(showAccount),
      "music-primary",
    );
    const accountHead = el("div", "music-import-account-head");
    accountHead.append(accountState);
    accountArea.append(accountHead, signIn, readAccount, readingBar);
    step.append(back, stepHead, stepList, linkArea, fileArea, accountArea);
    step.hidden = true;
    const art = source => {
      const node = el("span", "music-import-art");
      if (source.brand === "youtubemusic" || source.brand === "youtube") {
        const mark = el("span", `music-import-mark music-import-mark-${source.brand}`);
        mark.setAttribute("aria-hidden", "true");
        node.append(mark);
      } else if (source.brand) {
        const image = el("img", "");
        image.src = `assets/brands/${source.brand}.svg`;
        image.alt = "";
        node.append(image);
      } else {
        const icon = el("span", "icon");
        icon.dataset.icon = source.icon;
        icon.setAttribute("aria-hidden", "true");
        node.append(icon);
      }
      return node;
    };
    // A sign-in or sign-out while the dialog is open, and every return to the sources, refreshes the cards' state.
    const chipUpdates = [];
    const refreshChips = () => chipUpdates.forEach(update => update());
    for (const source of SOURCES.filter(source => source.command)) {
      const card = el("button", "music-import-card");
      card.type = "button";
      const copy = el("span", "music-import-card-copy");
      const name = el("strong", "", source.title);
      copy.append(name, el("small", "", source.text));
      if (source.signIn) {
        // The account cards say at a glance whether a sign-in is ready.
        const chip = el("span", "music-import-chip", "");
        chip.hidden = true;
        name.append(chip);
        const update = () =>
          Promise.resolve(invoke(source.signIn.status))
            .then(value => {
              chip.textContent = value ? t("Signed in") : t("Sign-in needed");
              chip.dataset.signedIn = String(!!value);
              chip.hidden = false;
            })
            .catch(() => {});
        chipUpdates.push(update);
        update();
      }
      const chevron = el("span", "icon music-import-chevron");
      chevron.dataset.icon = "caret-down";
      chevron.setAttribute("aria-hidden", "true");
      card.append(art(source), copy, chevron);
      card.addEventListener("click", () => showStep(source));
      if (!cards.querySelector(".music-import-card")) card.autofocus = true;
      cards.append(card);
    }

    function showStep(source) {
      start.hidden = true;
      step.hidden = false;
      stepHead.firstChild.replaceWith(art(source));
      stepTitle.textContent = source.title;
      stepList.replaceChildren(...source.steps.map(text => el("li", "", text)));
      stepList.hidden = false;
      readAccount.textContent = t("Read my library");
      readAccount.className = "music-primary";
      const isFile = source.key === "file",
        isAccount = !!source.command;
      accountSource = isAccount ? source : null;
      linkArea.hidden = isFile || isAccount;
      fileArea.hidden = !isFile;
      accountArea.hidden = !isAccount;
      if (isFile) choose(service);
      else if (isAccount) {
        signedIn = false;
        showAccount();
        checkAccount();
      } else {
        link.placeholder = source.placeholder;
        link.setAttribute("aria-label", source.placeholder);
        requestAnimationFrame(() => link.focus());
      }
    }
    function showStart() {
      refreshChips();
      step.hidden = true;
      preview.hidden = true;
      start.hidden = false;
      notice.textContent = "";
    }
    const completeFile = button(
      t("Choose an export for the full library"),
      "folder-open",
      () => {
        showStep(SOURCES.find(source => source.key === "file"));
        pick.click();
      },
      "outline small",
    );
    completeFile.append(el("span", "", t("Choose an export for the full library")));
    completeFile.hidden = true;
    const actions = el("div", "music-import-actions");
    actions.append(apply, report, selectionHint);
    preview.append(
      coverage,
      completeFile,
      warnings,
      destinationLabel,
      destinationHint,
      nameLabel,
      subsetLabel,
      summary,
      matchingNote,
      match,
      meter,
      review,
      useLabel,
      actions,
    );
    body.append(start, step, preview, cancel, discard, notice);
    modal.append(head, body);
    document.body.append(modal);
    const previous = document.activeElement;
    choose("spotify");
    updateSelection();
    modal.addEventListener("close", () => {
      for (const listener of sessionListeners) listener?.then(stop => stop()).catch(() => {});
      controller?.abort();
      persist();
      modal.remove();
      if (previous?.isConnected) previous.focus();
    });
    modal.showModal();
    setTimeout(() => {
      if (modal.open && !start.hidden)
        showTip({
          key: "import-sources",
          target: cards,
          title: t("Choose where your music is"),
          text: t("Pick a source. The next screen shows exactly where to copy the link from."),
        });
    }, 520);
  }
  const trigger = button(t("Bring your music"), "arrows-left-right", open, "outline small music-import-open");
  trigger.id = "music-import-open";
  trigger.append(el("span", "", t("Bring your music")));
  trigger.lastChild.dataset.i18n = "Bring your music";
  trigger.dataset.i18nTitle = "Bring your music";
  trigger.dataset.i18nAriaLabel = "Bring your music";
  document.querySelector(".music-heading-actions").prepend(trigger);
  return { open };
}
