// Two painted frames form the flame head and the fire trail. JS follows real download progress.
const headFrames = ["assets/fire-front-a.png", "assets/fire-front-b.png"];
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => motionPreference.matches || document.documentElement.dataset.motion === "reduced";

export class FireAnimation {
  constructor(element) {
    this.element = element;
    this.track = element.querySelector(".track");
    this.fill = element.querySelector(".fill");
    this.trail = element.querySelector(".live-fire-trail");
    this.head = element.querySelector(".live-fire-head");
    this.active = false;
    this.raf = 0;
    this.frame = -1;
    for (const source of [...headFrames, "assets/fire-trail-a.png", "assets/fire-trail-b.png"]) {
      const image = new Image();
      image.src = source;
    }
    document.addEventListener("visibilitychange", () => this.schedule());
    document.addEventListener("deviload-motion-change", () => this.schedule());
    motionPreference.addEventListener("change", () => this.schedule());
  }
  setProgress(value) {
    const percent = Math.max(0, Math.min(100, Number(value) || 0));
    const width = percent + "%";
    this.fill.style.width = width;
    this.trail.style.width = width;
    this.track.style.setProperty("--progress", width);
    this.track.setAttribute("aria-valuenow", String(Math.round(percent)));
    this.head.style.left = width;
    this.head.style.opacity = percent < 2 ? "0" : "1";
  }
  setActive(active) {
    this.active = active;
    this.element.hidden = !active;
    if (!active && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    if (active) this.schedule();
  }
  schedule() {
    if (!this.active || this.raf || document.hidden || reduced()) {
      if (reduced()) this.showFrame(0);
      return;
    }
    this.raf = requestAnimationFrame(now => {
      this.raf = 0;
      this.showFrame(Math.floor(now / 220) % 2);
      this.schedule();
    });
  }
  showFrame(index) {
    if (index === this.frame) return;
    this.frame = index;
    this.head.src = headFrames[index];
    this.element.dataset.fireFrame = index ? "b" : "a";
  }
}
