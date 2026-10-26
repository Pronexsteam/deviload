// Apply the new collection before first paint. The Ambient reset happens once.
(() => {
  const themes = ["ambient", "glass-light", "aurora", "prism"];
  let theme = "ambient";
  try {
    if (localStorage.getItem("deviload-theme-collection") !== "ambient-aurora-prism-v1") {
      localStorage.setItem("deviload-theme", "ambient");
      localStorage.setItem("deviload-theme-collection", "ambient-aurora-prism-v1");
    } else {
      const saved = localStorage.getItem("deviload-theme");
      if (themes.includes(saved)) theme = saved;
    }
  } catch { /* The theme can still be changed for this session. */ }
  const root = document.documentElement;
  root.dataset.theme = theme;
  const visibility = () => { root.dataset.atmospherePaused = String(document.hidden === true); };
  document.addEventListener?.("visibilitychange", visibility); visibility();
  root.dataset.motion = "reduced";
  root.style.colorScheme = theme === "glass-light" ? "light" : "dark";
})();
