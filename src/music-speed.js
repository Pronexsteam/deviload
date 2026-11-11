import { t, onLanguageChange } from "./i18n.js";

// Quick speed: a row of common speeds in the dock's More menu, the [ and ] keys, and a small badge beside
// More whenever the speed is not 1×, which resets it. The sound settings keep the fine slider.
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
export const speedText = rate => `${Number((Number(rate) || 1).toFixed(2))}×`;
// The next common speed below or above the current one; a speed set on the slider moves to its neighbour.
export function stepSpeed(rate, direction) {
  const current = Number(rate) || 1;
  if (direction > 0) return SPEEDS.find(speed => speed > current + 0.001) ?? SPEEDS.at(-1);
  return [...SPEEDS].reverse().find(speed => speed < current - 0.001) ?? SPEEDS[0];
}

export function wireMusicSpeed({ sound, button, notify = () => {} }) {
  // Two lines that fit the menu: the name with its keys, then the speeds side by side across the full width.
  const row = document.createElement("div"),
    head = document.createElement("div"),
    label = document.createElement("span"),
    keys = document.createElement("span"),
    group = document.createElement("div"),
    chips = SPEEDS.map(speed => {
      const chip = button(speedText(speed), null, () => apply(speed), "music-speed-chip");
      chip.textContent = speedText(speed);
      return chip;
    });
  row.className = "music-speed-row";
  head.className = "music-speed-head";
  keys.className = "music-speed-keys";
  group.className = "music-speed-options";
  group.setAttribute("role", "group");
  for (const key of ["[", "]"]) {
    const kbd = document.createElement("kbd");
    kbd.textContent = key;
    keys.append(kbd);
  }
  head.append(label, keys);
  group.append(...chips);
  row.append(head, group);
  const badge = button("", null, () => apply(1), "music-speed-badge");
  function apply(speed) {
    if (!sound.setRate(speed)) notify(t("Speed is not available in a listening room."));
    refresh();
  }
  function refresh() {
    const rate = sound.rate,
      blocked = !!sound.rateBlocked();
    label.textContent = t("Speed");
    group.ariaLabel = t("Speed");
    keys.title = t("Slower or faster");
    for (const [i, chip] of chips.entries()) {
      chip.setAttribute("aria-pressed", String(Math.abs(SPEEDS[i] - rate) < 0.001));
      chip.disabled = blocked;
    }
    badge.textContent = speedText(rate);
    badge.title = badge.ariaLabel = t("Playback speed {rate}. Press to return to normal speed.", {
      rate: speedText(rate),
    });
    badge.hidden = Math.abs(rate - 1) < 0.001;
  }
  refresh();
  onLanguageChange(refresh);
  // The slider in the sound settings and a listening room change the speed too.
  addEventListener("music-rate-change", refresh);
  row.addEventListener("pointerenter", refresh);
  return {
    row,
    badge,
    refresh,
    slower: () => apply(stepSpeed(sound.rate, -1)),
    faster: () => apply(stepSpeed(sound.rate, 1)),
  };
}
