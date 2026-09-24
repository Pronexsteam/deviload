// Responsive feedback for mouse, touch and keyboard. Respect OS motion settings.
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
export const motionAllowed = () => !reduced.matches && document.documentElement.dataset.motion !== "reduced";

export function pop(element, distance = 7) {
  if (!element || !motionAllowed()) return;
  element.animate([
    { opacity: 0, transform: "translateY(" + distance + "px) scale(.985)" },
    { opacity: 1, transform: "translateY(0) scale(1)" }
  ], { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" });
}

export function reactToPress(element, event) {
  if (!motionAllowed() || !element || element.disabled) return;
  const rect = element.getBoundingClientRect();
  const x = event && event.clientX ? event.clientX - rect.left : rect.width / 2;
  const y = event && event.clientY ? event.clientY - rect.top : rect.height / 2;
  const wave = document.createElement("span");
  wave.className = "tap-wave";
  const diameter = Math.max(rect.width, rect.height) * 2.1;
  wave.style.cssText = "width:" + diameter + "px;height:" + diameter + "px;left:" +
    (x - diameter/2) + "px;top:" + (y - diameter/2) + "px";
  element.append(wave);
  const ripple = wave.animate([
    { transform: "scale(0)", opacity: .28 },
    { transform: "scale(1)", opacity: 0 }
  ], { duration: 480, easing: "ease-out" });
  ripple.onfinish = () => wave.remove();
  element.animate([
    { transform: "scale(1)" }, { transform: "scale(.965)" }, { transform: "scale(1)" }
  ], { duration: 290, easing: "cubic-bezier(.2,.9,.3,1)" });
}

export function animateDetails(details) {
  const summary = details.querySelector("summary");
  const body = details.querySelector(".details-body");
  summary.addEventListener("click", event => {
    event.preventDefault();
    body.getAnimations().forEach(a => a.finish());
    if (!motionAllowed()) { details.open = !details.open; return; }
    if (!details.open) {
      details.open = true;
      body.animate([
        { height: "0px", opacity: 0, transform: "translateY(-7px)" },
        { height: body.scrollHeight + "px", opacity: 1, transform: "translateY(0)" }
      ], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
    } else {
      const close = body.animate([
        { height: body.offsetHeight + "px", opacity: 1 },
        { height: "0px", opacity: 0 }
      ], { duration: 190, easing: "ease-in" });
      close.onfinish = () => { details.open = false; };
    }
  });
}

export function wireMotion(orb) {
  document.addEventListener("pointerdown", event => {
    const target = event.target.closest("button, summary");
    if (target) { if (!target.classList.contains("brand-scene")) reactToPress(target, event); orb.bump(); }
  });
  document.addEventListener("keydown", event => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("button, summary")) {
      if (!event.target.classList.contains("brand-scene")) reactToPress(event.target); orb.bump();
    }
  });
  const advanced = document.querySelector(".advanced");
  if (advanced) animateDetails(advanced);
}
