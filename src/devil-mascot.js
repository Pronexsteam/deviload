import {brands, brandForUrl} from "./source-brands.js";
import {t, onLanguageChange} from "./i18n.js";
export {brandForUrl} from "./source-brands.js";
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => preference.matches || document.documentElement.dataset.motion === "reduced";
export class DevilMascot {
  constructor(element) {
    this.element = element;
    onLanguageChange(() => {
      if (this.currentBrand) this.element.setAttribute("aria-label", t("The Deviload devil holds the {brand} badge. Click for a new reaction.", {brand:this.currentBrand.name}));
    });
    element.insertAdjacentHTML("afterbegin", `<div class="mascot-stage" aria-hidden="true">
      <canvas class="mascot-trident-fire" width="240" height="214"></canvas>
      <div class="mascot-figure"><img class="mascot-front" src="assets/devil-mascot-front.png" alt=""><img class="mascot-look" src="assets/devil-mascot-look.png" alt=""><img class="mascot-working" src="assets/devil-mascot-working.png" alt=""><img class="mascot-victory" src="assets/devil-mascot-victory.png" alt=""><img class="mascot-error" src="assets/devil-mascot-error.png" alt=""></div>
      <div class="mascot-service" data-brand="youtube"><img src="assets/brands/youtube.svg" alt=""><span class="mascot-service-label" hidden></span></div>
      <span class="mascot-spark spark-one"></span><span class="mascot-spark spark-two"></span><span class="mascot-reaction-label"></span>
    </div>`);
    this.stage = element.querySelector(".mascot-stage");
    this.figure = this.stage.querySelector(".mascot-figure");
    this.fireCanvas = this.stage.querySelector(".mascot-trident-fire");
    this.fireContext = this.fireCanvas.getContext("2d");
    this.look = this.stage.querySelector(".mascot-look");
    this.front = this.stage.querySelector(".mascot-front");
    this.working = this.stage.querySelector(".mascot-working");
    this.victory = this.stage.querySelector(".mascot-victory");
    this.error = this.stage.querySelector(".mascot-error");
    this.caption = this.stage.querySelector(".mascot-reaction-label");
    this.badge = this.stage.querySelector(".mascot-service");
    this.badgeImage = this.badge.querySelector("img");
    this.badgeLabel = this.badge.querySelector(".mascot-service-label");
    this.start = performance.now();
    this.last = 0;
    this.raf = 0;
    this.visible = true;
    this.menuLook = false;
    this.lookUntil = 0;
    this.reaction = "idle";
    this.reactionUntil = 0;
    this.reactionStarted = 0;
    this.clickIndex = 0;
    this.source = null;
    this.brandId = "youtube";
    this.state = "idle";
    this.activity = "idle";
    const nav = document.querySelector(".sidebar nav");
    nav?.addEventListener("pointerover", () => { this.menuLook = true; this.schedule(); });
    nav?.addEventListener("pointerleave", () => { this.menuLook = false; this.schedule(); });
    nav?.addEventListener("focusin", () => { this.menuLook = true; this.schedule(); });
    nav?.addEventListener("focusout", () => { this.menuLook = false; this.schedule(); });
    nav?.addEventListener("click", () => { this.lookUntil = performance.now() + 1700; this.schedule(); });
    element.addEventListener("click", () => { this.start = performance.now(); this.reactClick(); });
    this.intersection = new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; this.schedule(); });
    this.intersection.observe(element);
    document.addEventListener("visibilitychange", () => this.schedule());
    preference.addEventListener("change", () => { this.draw(performance.now()); this.schedule(); });
    document.addEventListener("deviload-motion-change", () => { this.draw(performance.now()); this.schedule(); });
    this.draw(this.start);
    this.schedule();
  }
  setActivity(activity) {
    this.activity = activity;
    this.stage.dataset.activity = activity;
    this.draw(performance.now());
    this.schedule();
  }
  setState(state) {
    this.state = state;
    this.stage.dataset.state = state;
    this.draw(performance.now());
    this.schedule();
  }
  setSource(url) {
    this.source = brandForUrl(url);
    this.draw(performance.now());
  }
  react(kind, duration) {
    this.reaction = kind;
    this.reactionStarted = performance.now();
    this.reactionUntil = this.reactionStarted + duration;
    this.draw(performance.now());
    this.schedule();
  }
  reactClick() {
    const kind = ["rage", "wink", "victory", "trick"][this.clickIndex++ % 4];
    this.react(kind, kind === "rage" ? 2800 : 2200);
  }
  reactStart() { this.react("start", 1450); }
  reactCinema() { this.react("cinema", 1900); }
  reactShare() { this.react("share", 2100); }
  reactSending() { this.react("sending", 1300); }
  reactTransferDone() { this.react("sent", 3400); }
  celebrate() { this.react("victory", 3100); }
  fail() { this.react("error", 2900); }
  showBrand(brand) {
    const key = brand.id + ":" + brand.name;
    if (this.brandId === key) return;
    this.brandId = key;
    this.badge.dataset.brand = brand.id;
    this.badgeImage.hidden = brand.id === "other";
    this.badgeLabel.hidden = brand.id !== "other";
    if (brand.id === "other") this.badgeLabel.textContent = brand.label;
    else this.badgeImage.src = `assets/brands/${brand.id}.svg`;
    this.currentBrand = brand;
    this.element.setAttribute("aria-label", t("The Deviload devil holds the {brand} badge. Click for a new reaction.", {brand:brand.name}));
    if (!reduced()) {
      this.badge.classList.remove("mascot-service-change");
      void this.badge.offsetWidth;
      this.badge.classList.add("mascot-service-change");
    }
  }
  schedule() {
    if (this.raf || reduced() || document.hidden || !this.visible) return;
    this.raf = requestAnimationFrame(now => {
      this.raf = 0;
      if (now - this.last >= 1000 / 30) { this.draw(now); this.last = now; }
      this.schedule();
    });
  }
  drawTridentFire(now, active) {
    const ctx = this.fireContext;
    ctx.clearRect(0, 0, 240, 214);
    if (!active || reduced()) return;
    const seconds = (now - this.reactionStarted) / 1000;
    const strength = Math.max(0, Math.min(1, seconds / .25, (2.8 - seconds) / .5));
    if (strength <= 0) return;
    const x = 145, y = 65;
    const glow = ctx.createRadialGradient(x, y - 9, 3, x, y - 9, 55);
    glow.addColorStop(0, `rgba(255,233,155,${.72 * strength})`);
    glow.addColorStop(.36, `rgba(255,87,37,${.42 * strength})`);
    glow.addColorStop(1, "rgba(255,43,23,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(95, 0, 145, 120);
    for (let i = 0; i < 9; i++) {
      const wave = Math.sin(seconds * 12 + i * 1.7);
      const baseX = x + (i - 4) * 2.7;
      const tipX = baseX + (28 + i * 4 + wave * 7) * strength;
      const tipY = y - (30 + (i % 3) * 14 + Math.sin(seconds * 17 + i) * 7) * strength;
      const width = (4 + i % 3) * strength;
      const gradient = ctx.createLinearGradient(baseX, y, tipX, tipY);
      gradient.addColorStop(0, "#fff5b7");
      gradient.addColorStop(.38, i % 2 ? "#ffb141" : "#ff7340");
      gradient.addColorStop(1, "#e72c2b");
      ctx.beginPath();
      ctx.moveTo(baseX - width, y);
      ctx.quadraticCurveTo(baseX - width - 8, y - 22 * strength, tipX, tipY);
      ctx.quadraticCurveTo(baseX + width + 8, y - 20 * strength, baseX + width, y);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    for (let i = 0; i < 13; i++) {
      const phase = (seconds * (1.7 + i % 4 * .3) + i * .381) % 1;
      const emberX = x + phase * 65 + Math.sin(i * 15.2 + seconds * 4) * 12;
      const emberY = y - 20 - phase * 62;
      ctx.beginPath();
      ctx.arc(emberX, emberY, (1.2 + (i % 3) * .6) * (1 - phase) * strength, 0, Math.PI * 2);
      ctx.fillStyle = i % 3 ? `rgba(255,140,63,${(1 - phase) * strength})` : `rgba(255,241,181,${(1 - phase) * strength})`;
      ctx.fill();
    }
  }  draw(now) {
    const elapsed = (now - this.start) / 1000;
    const brand = this.source || brands[reduced() ? 0 : Math.floor(Math.max(0, elapsed) / 3.4) % brands.length];
    this.showBrand(brand);
    const hug = reduced() ? 0 : Math.max(0, Math.min(1, (2.45 - elapsed) / .85));
    const menu = this.menuLook || now < this.lookUntil || (!reduced() && Math.floor(elapsed / 4.2) % 2 === 1);
    const activeReaction = now < this.reactionUntil ? this.reaction : "idle";
    const working = this.state === "running" || this.activity === "sending";
    const bob = reduced() ? 0 : Math.sin(elapsed * (working ? 5.3 : 2.15)) * (working ? 4 : 1.65);
    const sway = reduced() ? 0 : Math.sin(elapsed * 1.35) * 1.15;
    const victory = activeReaction === "victory" || activeReaction === "sent";
    const rage = activeReaction === "rage";
    const wink = activeReaction === "wink";
    const trick = activeReaction === "trick";
    const error = activeReaction === "error" || rage;
    const start = activeReaction === "start";
    const cinema = activeReaction === "cinema";
    const sharing = activeReaction === "share";
    const jump = reduced() ? 0 : victory ? Math.abs(Math.sin(elapsed * 10)) * 12 : start || trick ? Math.abs(Math.sin(elapsed * 12)) * 7 : 0;
    const shake = reduced() ? 0 : error ? Math.sin(elapsed * (rage ? 35 : 27)) * (rage ? 5 : 4) : 0;
    const trickPhase = (now - this.reactionStarted) / 1000;
    const toss = reduced() || !trick ? 0 : Math.max(0, 1 - Math.abs(trickPhase - .75) / .75);
    this.figure.style.transform = `translate3d(${hug * 9 + shake}px, ${bob - jump}px, 0) rotate(${sway + hug * 4 + (victory ? 5 : error ? -4 : 0)}deg)`;
    this.badge.style.transform = `translate3d(${-hug * 12 + shake * .6 + toss * 15}px, ${-hug * 8 - bob * .55 - jump * .4 - toss * 32}px, 0) rotate(${-hug * 9 + (start ? sway * 3 : 0) + toss * 330}deg)`;
    this.front.style.opacity = victory || error || working ? "0" : "1";
    this.working.style.opacity = working && !victory && !error ? "1" : "0";
    this.victory.style.opacity = victory ? "1" : "0";
    this.error.style.opacity = error ? "1" : "0";
    this.look.style.opacity = !victory && !error && !working && (menu || wink || cinema || sharing || this.activity === "cinema") ? "1" : "0";
    this.caption.textContent = t(rage ? "ON FIRE!" : wink ? "I SEE YOU" : trick ? "CATCH!" : activeReaction === "sent" ? "SENT!" : victory ? "DONE!" : error ? "OOPS…" : start ? "LET’S GO!" : cinema ? "WATCHING" : sharing ? "TO PHONE" : "");
    this.drawTridentFire(now, rage);
    this.stage.dataset.reaction = activeReaction;
    this.stage.dataset.gaze = menu ? "menu" : "viewer";
    this.stage.dataset.hugging = hug > .08 ? "true" : "false";
    this.stage.dataset.working = working ? "true" : "false";
  }
}
