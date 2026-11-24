// Native title remains the fallback; popovers also work above modal dialogs.
// Every button that shows only an icon gets the same tooltip, in Devil Music and in the rest of the app.
const selector = [
  ".music-icon-button[title]",
  ".music-card button[title]",
  ".music-navigation button[title]",
  ".music-library-panel-toggle[title]",
  ".music-lyrics-tools button[title]",
  ".quick-theme-toggle[title]",
  ".music-mini-page button[title]",
  ".topbar-actions button[title]",
  ".icon-only[title]",
  ".transfer-button[title]",
  ".library-view button[title]",
  ".dialog-close[title]",
  ".sidebar-collapse[title]",
  "body.sidebar-collapsed .sidebar .nav[title]",
].join(",");
const tip = document.createElement("div");
tip.className = "ui-tip";
tip.id = "music-ui-tip";
tip.setAttribute("role", "tooltip");
tip.setAttribute("popover", "manual");
if (typeof tip.showPopover === "function") {
  document.body.append(tip);
  let target = null,
    original = "",
    described = null,
    timer = null;
  function hide() {
    clearTimeout(timer);
    timer = null;
    if (target) {
      if (!target.title) target.title = original;
      if (described === null) target.removeAttribute("aria-describedby");
      else target.setAttribute("aria-describedby", described);
    }
    target = null;
    if (tip.matches(":popover-open")) tip.hidePopover();
  }
  function show(node) {
    if (!node.isConnected || node.disabled) return;
    hide();
    target = node;
    original = node.title;
    if (!original) {
      target = null;
      return;
    }
    described = node.getAttribute("aria-describedby");
    tip.textContent = original;
    node.removeAttribute("title");
    node.setAttribute("aria-describedby", [described, tip.id].filter(Boolean).join(" "));
    tip.showPopover();
    const r = node.getBoundingClientRect(),
      b = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(innerWidth - b.width - 8, r.x + (r.width - b.width) / 2)) + "px";
    tip.style.top =
      (r.bottom + b.height + 10 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - b.height - 6)) + "px";
  }
  document.addEventListener("pointerover", event => {
    const node = event.target.closest(selector);
    if (!node || node === target || node.contains(event.relatedTarget)) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(node), 400);
  });
  document.addEventListener("pointerout", event => {
    const node = event.target.closest(selector) || target;
    if (node?.contains(event.target) && !node.contains(event.relatedTarget)) hide();
  });
  document.addEventListener("focusin", event => {
    const node = event.target.closest(selector);
    // On the next frame: focus often moves while a dialog opens, and placing the tip at once would lay the page
    // out in the middle of that.
    if (node?.matches(":focus-visible"))
      requestAnimationFrame(() => {
        if (document.activeElement === node) show(node);
      });
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide);
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") hide();
  });
}
