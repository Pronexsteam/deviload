// Apply the stored skin before styles paint. A missing or invalid preference
// keeps the existing appearance for people upgrading from older versions.
(() => {
  const themes = ["classic", "glass-light", "matte-black", "glass-black"];
  let theme = "classic";
  try {
    const saved = localStorage.getItem("deviload-theme");
    if (themes.includes(saved)) theme = saved;
  } catch { /* The theme can still be changed for this session. */ }
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.motion = theme === "classic" ? "full" : "reduced";
  root.style.colorScheme = theme === "glass-light" ? "light" : "dark";
})();
