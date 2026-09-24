// Media pulse: a play mark and progress ring, shared by the brand, hero and task cards.
// One 30 fps loop; offscreen and reduced-motion indicators do not animate.
const instances = new Set();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const motionIsReduced = () => reducedMotion.matches || document.documentElement.dataset.motion === "reduced";
const palettes = {
  idle:[239,120,106],queued:[205,169,143],running:[168,221,183],
  done:[168,221,183],error:[246,156,146],cancelled:[153,153,153],
  interrupted:[224,190,145],cancelling:[204,181,159],pausing:[204,181,159],paused:[166,153,146]
};
let frame = 0, last = 0;
function schedule() {
  if (!frame && !document.hidden && !motionIsReduced() && [...instances].some(item => item.visible && (!["done","cancelled","paused"].includes(item.state) || item.impulse > .01))) {
    frame = requestAnimationFrame(tick);
  }
}
function tick(now) {
  frame = 0;
  if (document.hidden || motionIsReduced()) return;
  if (now - last >= 1000 / 30) {
    for (const item of instances) if (item.visible) item.draw(now / 1000);
    last = now;
  }
  schedule();
}
export class MediaPulse {
  constructor(element, state = "idle") {
    this.element = element;
    this.state = state;
    this.progress = null;
    this.visible = true;
    this.phase = 0;
    this.lastTime = 0;
    this.impulse = 0;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    element.append(this.canvas);
    this.context = this.canvas.getContext("2d");
    this.resize = new ResizeObserver(() => this.draw(0));
    this.resize.observe(element);
    this.visibility = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) { this.draw(0); schedule(); }
    });
    this.visibility.observe(element);
    instances.add(this);
    this.draw(0);
    schedule();
  }
  setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.element.dataset.pulseState = state;
    this.bump();
    this.draw(0);
    schedule();
  }
  setProgress(percent) {
    const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
    if (value === this.progress) return;
    this.progress = value;
    this.draw(0);
  }
  bump() {
    if (motionIsReduced()) return;
    this.impulse = 1;
    schedule();
  }
  destroy() {
    instances.delete(this);
    this.resize.disconnect();
    this.visibility.disconnect();
    this.canvas.remove();
  }
  draw(time) {
    const {canvas, context:ctx, element} = this;
    if (!ctx || !this.visible) return;
    const size = Math.min(element.clientWidth, element.clientHeight);
    if (!size) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = Math.round(size * ratio);
    if (canvas.width !== pixels) { canvas.width = pixels; canvas.height = pixels; }
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.clearRect(0,0,size,size);
    if (time > 0) {
      if (this.lastTime && !motionIsReduced() && !["done","cancelled","paused"].includes(this.state)) {
        this.phase += Math.min(.1,Math.max(0,time-this.lastTime)) * (this.state === "running" ? 1.15 : .34);
      }
      this.lastTime = time;
      this.impulse *= .86;
    }
    const c = size/2;
    const r = size*.335;
    const ring = size*.385;
    const rgb = (palettes[this.state] || palettes.idle).join(",");
    const breath = motionIsReduced() ? 0 : Math.sin(this.phase*2.1)*.022;
    const scale = 1 + breath + this.impulse*.075;
    ctx.save();
    ctx.translate(c,c);
    ctx.scale(scale,scale);
    ctx.translate(-c,-c);
    const halo = ctx.createRadialGradient(c,c,r*.4,c,c,size*.5);
    halo.addColorStop(0,"rgba("+rgb+",.07)");
    halo.addColorStop(1,"rgba("+rgb+",0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0,0,size,size);
    const disc = ctx.createLinearGradient(c-r,c-r,c+r,c+r);
    disc.addColorStop(0,"#343333");
    disc.addColorStop(1,"#202224");
    ctx.beginPath();ctx.arc(c,c,r,0,Math.PI*2);ctx.fillStyle=disc;ctx.fill();
    ctx.beginPath();ctx.arc(c,c,r,0,Math.PI*2);ctx.strokeStyle="rgba(255,255,255,.2)";ctx.lineWidth=Math.max(1,size*.012);ctx.stroke();
    ctx.beginPath();ctx.arc(c,c,ring,-Math.PI/2,Math.PI*1.5);ctx.strokeStyle="rgba("+rgb+",.22)";ctx.lineWidth=Math.max(2,size*.034);ctx.stroke();
    const fraction = this.progress === null ? (this.state === "running" ? .42 : .27) : Math.max(.025,this.progress/100);
    const start = -Math.PI/2 + (this.progress === null && !motionIsReduced() ? this.phase : 0);
    const end = start + Math.PI*2*fraction;
    ctx.beginPath();ctx.arc(c,c,ring,start,end);ctx.strokeStyle="rgb("+rgb+")";ctx.lineWidth=Math.max(2,size*.038);ctx.lineCap="round";ctx.stroke();
    if (size > 55) {
      ctx.beginPath();ctx.arc(c+Math.cos(end)*ring,c+Math.sin(end)*ring,size*.018,0,Math.PI*2);
      ctx.fillStyle="#f4f1ff";ctx.fill();
    }
    if (this.state === "done") {
      ctx.beginPath();ctx.moveTo(c-r*.40,c);ctx.lineTo(c-r*.08,c+r*.27);ctx.lineTo(c+r*.44,c-r*.28);
      ctx.strokeStyle="#eefdf5";ctx.lineWidth=Math.max(2,size*.062);ctx.lineCap="round";ctx.lineJoin="round";ctx.stroke();
    } else if (this.state === "error") {
      ctx.beginPath();ctx.moveTo(c-r*.25,c-r*.25);ctx.lineTo(c+r*.25,c+r*.25);ctx.moveTo(c+r*.25,c-r*.25);ctx.lineTo(c-r*.25,c+r*.25);
      ctx.strokeStyle="#fff1ef";ctx.lineWidth=Math.max(2,size*.056);ctx.lineCap="round";ctx.stroke();
    } else {
      ctx.beginPath();ctx.moveTo(c-r*.18,c-r*.39);ctx.lineTo(c+r*.40,c);ctx.lineTo(c-r*.18,c+r*.39);ctx.closePath();
      ctx.fillStyle="#f3efff";ctx.fill();
    }
    ctx.restore();
  }
}
document.addEventListener("visibilitychange",()=>{
  if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=0;}else schedule();
});
reducedMotion.addEventListener("change",()=>{
  if(frame)cancelAnimationFrame(frame);frame=0;
  for(const item of instances)item.draw(0);
  schedule();
});
document.addEventListener("deviload-motion-change", () => { for (const item of instances) item.draw(0); schedule(); });