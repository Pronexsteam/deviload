// Apply the new collection before first paint. The Ambient reset happens once.
(() => {
  const themes = ["ambient", "glass-light", "aurora", "prism", "noir", "vinyl", "paper", "custom"];
  const bases = { noir: "prism", vinyl: "prism", paper: "glass-light", custom: "ambient" };
  let theme = "ambient";
  try {
    if (localStorage.getItem("deviload-theme-collection") !== "ambient-aurora-prism-v1") {
      localStorage.setItem("deviload-theme", "ambient");
      localStorage.setItem("deviload-theme-collection", "ambient-aurora-prism-v1");
    } else {
      const saved = localStorage.getItem("deviload-theme");
      if (themes.includes(saved)) theme = saved;
    }
  } catch {
    /* The theme can still be changed for this session. */
  }
  const root = document.documentElement;
  root.dataset.theme = bases[theme] || theme;
  if (bases[theme]) root.dataset.variant = theme;
  // Your own theme: its blur, darkening and accent apply before the first paint too.
  if (theme === "custom") {
    try {
      const custom = JSON.parse(localStorage.getItem("deviload-custom-theme") || "null") || {};
      const number = (value, low, high, fallback) =>
        Number.isFinite(Number(value)) && value !== null
          ? Math.min(high, Math.max(low, Number(value)))
          : fallback;
      root.style.setProperty("--custom-blur", number(custom.blur, 0, 60, 24) + "px");
      root.style.setProperty("--custom-dim", String(number(custom.dim, 0, 85, 45) / 100));
      root.style.setProperty("--custom-ambient", String(number(custom.ambient, 0, 100, 70) / 100));
      root.style.setProperty("--custom-panel", String(number(custom.panels, 15, 100, 66) / 100));
      if (/^#[0-9a-f]{6}$/i.test(custom.accent || ""))
        root.style.setProperty("--custom-accent", custom.accent);
    } catch {
      /* Defaults apply. */
    }
  }
  const visibility = () => {
    root.dataset.atmospherePaused = String(document.hidden === true);
  };
  document.addEventListener?.("visibilitychange", visibility);
  visibility();
  root.dataset.motion = "reduced";
  root.style.colorScheme = (bases[theme] || theme) === "glass-light" ? "light" : "dark";
})();
