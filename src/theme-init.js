// Apply before first paint; retire Classic without touching other preferences.
(() => {
  const themes = ["glass-light", "matte-black", "glass-black", "midnight", "spotify", "ambient"];
  let theme = "ambient";
  try {
    const saved = localStorage.getItem("deviload-theme");
    if (themes.includes(saved)) theme = saved;
    if (saved === "classic") localStorage.setItem("deviload-theme",theme);
  } catch { /* The theme can still be changed for this session. */ }
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.motion = "reduced";
  root.style.colorScheme = theme === "glass-light" ? "light" : "dark";
})();
