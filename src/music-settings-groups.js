import { t, onLanguageChange } from "./i18n.js";

// Music settings grew one block at a time. Each time the window opens, the blocks are put under a few plain
// headings, so a person looking for Discord or the cache does not read through everything. A block nobody named
// here stays where it was, at the end.
const GROUPS = [
  { key: "accounts", title: () => t("Accounts"), match: [".music-accounts"] },
  {
    key: "playback",
    title: () => t("Playback"),
    match: [".music-yield", ".music-song-notice", "#music-playback-settings"],
  },
  {
    key: "recommendations",
    title: () => t("Suggestions for you"),
    match: [".music-discovery-controls", ":has(#music-public-discovery)", "#music-profile"],
  },
  {
    key: "privacy",
    title: () => t("Privacy"),
    match: [":has(#music-private-session)", ".music-session-note"],
  },
  {
    key: "integrations",
    title: () => t("Integrations"),
    match: [":has(#music-discord-presence)", ".music-control-api", ".music-scrobbling", ".music-lighting"],
  },
  { key: "app", title: () => t("App"), match: [".app-mode-toggle", ".music-tour-replay"] },
];

export function groupMusicSettings(host) {
  if (!host) return;
  const sections = new Map();
  for (const group of GROUPS) {
    let section = host.querySelector(`:scope > .music-settings-group[data-group="${group.key}"]`);
    if (!section) {
      section = document.createElement("section");
      section.className = "music-settings-group";
      section.dataset.group = group.key;
      const heading = document.createElement("h3");
      heading.className = "music-settings-group-title";
      section.append(heading);
    }
    sections.set(group, section);
  }
  const head = host.querySelector(":scope > .music-preferences-head");
  let after = head;
  for (const group of GROUPS) {
    const section = sections.get(group);
    for (const selector of group.match)
      for (const node of host.querySelectorAll(`:scope > ${selector.startsWith(":") ? "*" : ""}${selector}`))
        if (!node.classList.contains("music-settings-group")) section.append(node);
    // An empty group (a block that does not exist on this system) shows no heading.
    section.hidden = section.children.length <= 1;
    if (after) after.after(section);
    else host.prepend(section);
    after = section;
  }
  const label = () => {
    for (const group of GROUPS) sections.get(group).firstElementChild.textContent = group.title();
  };
  label();
  if (!host.dataset.groupsLabelled) {
    host.dataset.groupsLabelled = "true";
    onLanguageChange(label);
  }
}
