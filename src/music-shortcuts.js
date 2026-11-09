const LETTERS = { KeyL: "like", KeyM: "mute", KeyQ: "queue", KeyF: "full", KeyS: "shuffle", KeyR: "repeat" };
const ARROWS = { ArrowRight: "next", ArrowLeft: "previous", ArrowUp: "louder", ArrowDown: "quieter" };
const SEEK = { ArrowRight: "forward", ArrowLeft: "back" };

const isTyping = target => {
  const field = target?.closest?.('input,textarea,select,[contenteditable="true"]');
  return !!field && !(field.tagName === "INPUT" && ["range", "checkbox"].includes(field.type));
};
const ownsKeys = target => !!target?.closest?.('button,summary,a,input,[role="slider"],[role="separator"]');

export function musicShortcut(event) {
  if (event.isComposing || event.altKey || event.metaKey || isTyping(event.target)) return null;
  if (event.ctrlKey) return event.shiftKey ? null : ARROWS[event.code] || null;
  if (event.key === "?") return "help";
  if (event.shiftKey) return null;
  if (LETTERS[event.code]) return event.repeat ? null : LETTERS[event.code];
  if (ownsKeys(event.target)) return null;
  if (event.code === "Space") return event.repeat ? null : "play";
  return SEEK[event.code] || null;
}
