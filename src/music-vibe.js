import { t, onLanguageChange } from "./i18n.js";

// Sound moods in the dock's More menu: Normal, Slowed + reverb, Nightcore and 8D side by side, and a small
// badge beside More while a mood plays, which returns the song to normal.
export function wireMusicVibe({ sound, button }) {
  const row = document.createElement("div"),
    head = document.createElement("div"),
    label = document.createElement("span"),
    group = document.createElement("div");
  row.className = "music-speed-row music-vibe-row";
  head.className = "music-speed-head";
  group.className = "music-speed-options music-vibe-options";
  group.setAttribute("role", "group");
  head.append(label);
  row.append(head, group);
  const chips = sound.vibes().map(([key]) => {
    const chip = button("", null, () => sound.setVibe(key), "music-speed-chip");
    chip.dataset.vibe = key;
    return chip;
  });
  group.append(...chips);
  const badge = button("", null, () => sound.setVibe(""), "music-speed-badge music-vibe-badge");
  function refresh() {
    const names = new Map(sound.vibes()),
      short = new Map([
        ["", t("Normal")],
        ["slowed", t("Slowed")],
        ["nightcore", t("Nightcore")],
        ["8d", "8D"],
      ]);
    label.textContent = group.ariaLabel = t("Sound mood");
    for (const chip of chips) {
      const key = chip.dataset.vibe;
      chip.textContent = short.get(key);
      chip.title = chip.ariaLabel = names.get(key);
      chip.setAttribute("aria-pressed", String(key === sound.vibe));
    }
    badge.textContent = short.get(sound.vibe) || "";
    badge.title = badge.ariaLabel = t("{mood} is on. Press to return to normal sound.", {
      mood: names.get(sound.vibe) || "",
    });
    badge.hidden = !sound.vibe;
  }
  refresh();
  onLanguageChange(refresh);
  addEventListener("music-vibe-change", refresh);
  return { row, badge, refresh };
}
