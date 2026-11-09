// A small glass bubble above the volume that shows the level while it changes.
export function wireVolumeBubble({ input, percent }) {
  if (!input?.addEventListener) return { show() {} };
  const bubble = document.createElement("div");
  bubble.className = "music-volume-bubble";
  bubble.setAttribute("aria-hidden", "true");
  document.body.append(bubble);
  let timer = 0;
  function show() {
    const box = input.getBoundingClientRect();
    if (!box.width) return;
    bubble.textContent = `${Math.round(percent())}%`;
    const fill = Number(input.value) / Number(input.max || 1);
    bubble.style.left = `${box.left + 6 + fill * (box.width - 12)}px`;
    bubble.style.top = `${box.top - 6}px`;
    bubble.classList.add("is-shown");
    clearTimeout(timer);
    timer = setTimeout(() => bubble.classList.remove("is-shown"), 900);
  }
  input.addEventListener("input", show);
  return { show };
}
