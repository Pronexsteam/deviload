import {t, onLanguageChange} from "./i18n.js";
import {supporters} from "./supporters-data.js";

const instances = new WeakMap();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function wireSupporters({root = document.getElementById("supporters"), onSupport} = {}) {
  if (!root || instances.has(root)) return root ? instances.get(root) : null;
  let disposed = false;
  const heading = element("div", "supporters-heading"), copy = element("div"), title = element("h2"), subtitle = element("p");
  title.id = "supporters-title";copy.append(title, subtitle);
  const mascot = element("img", "supporters-mascot");
  mascot.src = "assets/devil-supporters-thanks-v2.png";mascot.alt = "";mascot.setAttribute("aria-hidden", "true");
  mascot.width = 76;mascot.height = 76;mascot.decoding = "async";
  const support = element("button", "outline small supporters-support");support.type = "button";
  support.addEventListener("click", () => onSupport?.());heading.append(mascot, copy);
  const list = element("ol", "supporters-list");
  root.setAttribute("aria-labelledby", title.id);root.replaceChildren(heading, list, support);

  function render() {
    if (disposed) return;
    title.textContent = t("Top supporters");subtitle.textContent = t("Thank you for your support.");
    support.textContent = t("Support on Ko-fi");list.replaceChildren();
    list.setAttribute("aria-label", t("Top supporters"));
    // This bundled list is maintained by hand. Matching display names remain
    // separate entries; names are always text, never HTML or translation keys.
    for (const [index, item] of supporters.slice(0, 3).entries()) {
      const row = element("li", "supporter"), rank = element("span", "supporter-rank", "#" + (index + 1));
      rank.setAttribute("aria-hidden", "true");
      const name = element("span", "supporter-name", item.name);
      name.setAttribute("translate", "no");name.setAttribute("dir", "auto");
      row.append(rank, name);list.append(row);
    }
    root.hidden = !list.children.length;
  }
  onLanguageChange(render);render();
  const result = {dispose() { disposed = true; }};
  instances.set(root, result);return result;
}
