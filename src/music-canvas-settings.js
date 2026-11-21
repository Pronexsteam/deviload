import { t, onLanguageChange } from "./i18n.js";
import { CANVAS_QUALITIES, readCanvasLook, saveCanvasLook } from "./music-canvas.js";

// The video behind the music, in the Themes menu: Canvas in the full player, and how dark and how sharp the video
// is there and in the Live theme.
export function wireCanvasSettings({ place, isEnabled, setEnabled }) {
  const make = (tag, cls = "") => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  };
  const box = make("section", "music-canvas-settings"),
    heading = make("h3", "music-canvas-heading");
  // The same shape as the other switches in music settings: the switch and its name, then a line about it.
  const toggleRow = make("div", "music-catalog-context"),
    toggleLabel = make("label"),
    toggle = make("input"),
    toggleName = make("span"),
    toggleNote = make("p");
  toggle.type = "checkbox";
  toggleLabel.append(toggle, toggleName);
  toggleRow.append(toggleLabel, toggleNote);
  const dimRow = make("label", "music-canvas-row"),
    dimName = make("span"),
    dim = make("input"),
    dimValue = make("output");
  dim.type = "range";
  dim.min = "0";
  dim.max = "80";
  dim.step = "5";
  dimRow.append(dimName, dim, dimValue);
  const qualityRow = make("label", "music-canvas-row"),
    qualityName = make("span"),
    quality = make("select");
  qualityRow.append(qualityName, quality);
  const note = make("p", "music-canvas-note");
  box.append(heading, toggleRow, dimRow, qualityRow, note);
  place(box);
  let look = readCanvasLook();
  function show() {
    toggle.checked = isEnabled();
    dim.value = String(Math.round(look.dim * 100));
    dimValue.textContent = look.dim ? `${Math.round(look.dim * 100)}%` : t("Off");
    quality.value = String(look.quality);
  }
  function label() {
    heading.textContent = t("Video behind the music");
    box.setAttribute("aria-label", heading.textContent);
    toggleName.textContent = t("Canvas in the full player");
    toggleNote.textContent = t("A few seconds of the song's video loop silently behind the player.");
    dimName.textContent = t("Video dimming");
    dim.setAttribute("aria-label", t("Video dimming"));
    qualityName.textContent = t("Video quality");
    quality.replaceChildren(
      ...CANVAS_QUALITIES.map(value => {
        const option = make("option");
        option.value = String(value);
        option.textContent = value === "auto" ? t("Automatic") : `${value}p`;
        return option;
      }),
    );
    note.textContent = t(
      "The Live theme shows the same video behind all of Devil Music. Higher quality uses more internet.",
    );
    show();
  }
  toggle.addEventListener("change", () => setEnabled(toggle.checked));
  dim.addEventListener("input", () => {
    look = saveCanvasLook({ ...look, dim: Number(dim.value) / 100 });
    show();
  });
  quality.addEventListener("change", () => {
    const value = quality.value === "auto" ? "auto" : Number(quality.value);
    look = saveCanvasLook({ ...look, quality: value });
    show();
  });
  label();
  onLanguageChange(label);
  return { box, refresh: show };
}
