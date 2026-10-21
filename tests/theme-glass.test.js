import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {glassCover, glassSurfaceRect, wireGlassMaterial} from "../src/theme-glass.js";

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type) { for (const callback of [...(this.listeners.get(type) || [])]) callback({type, preventDefault() {}}); }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function fixture({theme = "glass-light", gpu = true, compile = true, reduced = false, width = 1440, height = 900} = {}) {
  const frames = new Map(), images = [], canvases = [], contexts = [], observers = [];
  let frameId = 0;
  const media = new Events();media.matches = reduced;
  const root = {dataset:{theme}, clientWidth:width, clientHeight:height};
  const panel = (left = 12, top = 60) => ({hidden:false,
    getClientRects:() => [{}], getBoundingClientRect:() => ({left, top, width:320, height:450})});
  const panels = Array.from({length:8}, (_, index) => panel(index * 20, index * 12));
  const document = new Events(), window = new Events();
  document.documentElement = root;
  document.hidden = false;
  document.body = {prepend(canvas) { canvas.isConnected = true; }};
  document.querySelector = () => panels[0];
  document.querySelectorAll = () => panels;
  document.createElement = tag => {
    assert.equal(tag, "canvas");
    const canvas = new Events();canvas.style = {};canvas.attributes = {};
    canvas.setAttribute = (key, value) => canvas.attributes[key] = value;
    canvas.remove = () => { canvas.isConnected = false; };
    canvas.getContext = kind => {
      assert.equal(kind, "webgl");
      if (!gpu) return null;
      const context = {draws:0, disposed:[], uniforms:{}, lost:false,
        createShader:() => ({}), shaderSource() {}, compileShader() {},
        getShaderParameter:() => compile, createProgram:() => ({}),
        attachShader() {}, linkProgram() {}, getProgramParameter:() => true,
        getAttribLocation:() => 0, createBuffer:() => ({}), createTexture:() => ({}),
        bindBuffer() {}, bufferData() {}, getUniformLocation:(_, name) => name,
        bindTexture() {}, pixelStorei() {}, texParameteri() {}, texImage2D() {},
        viewport() {}, useProgram() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, activeTexture() {},
        uniform1i(name, value) { this.uniforms[name] = value; },
        uniform1f(name, value) { this.uniforms[name] = value; },
        uniform2f(name, x, y) { this.uniforms[name] = [x, y]; },
        uniform4fv(name, values) { this.uniforms[name] = Array.from(values); },
        uniform1fv(name, values) { this.uniforms[name] = Array.from(values); },
        drawArrays() { this.draws++; }, isContextLost() { return this.lost; },
        deleteTexture() { this.disposed.push("texture"); }, deleteBuffer() { this.disposed.push("buffer"); },
        deleteProgram() { this.disposed.push("program"); }, deleteShader() { this.disposed.push("shader"); },
        getExtension() { return {loseContext:() => this.disposed.push("context")}; }
      };
      contexts.push(context);return context;
    };
    canvases.push(canvas);return canvas;
  };
  window.innerWidth = width;window.innerHeight = height;window.devicePixelRatio = 3;
  window.matchMedia = () => media;
  window.getComputedStyle = () => ({visibility:"visible", display:"block", borderTopLeftRadius:"18px"});
  window.requestAnimationFrame = callback => { const id = ++frameId;frames.set(id, callback);return id; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.Image = class { naturalWidth = 2048;naturalHeight = 1152;constructor() { images.push(this); } };
  window.MutationObserver = window.ResizeObserver = class {
    constructor(callback) { this.callback = callback;observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  return {document, window, root, media, frames, images, canvases, contexts, observers, panels,
    switchTheme(theme) { root.dataset.theme = theme;document.emit("deviload-theme-change"); },
    flush() { for (const [id, callback] of [...frames]) { frames.delete(id);callback(); } }};
}

test("wallpaper cover UVs crop the centered excess on wide and tall viewports", () => {
  assert.deepEqual(glassCover(800, 800, 1600, 800), [.5, 1, .25, 0]);
  assert.deepEqual(glassCover(1600, 800, 800, 800), [1, .5, 0, .25]);
  assert.deepEqual(glassCover(1600, 900, 1600, 900), [1, 1, 0, 0]);
  assert.deepEqual(glassCover(0, 800, 1600, 800), [1, 1, 0, 0]);
  assert.deepEqual(glassCover(800, 800, Infinity, 800), [1, 1, 0, 0]);
});

test("surface geometry culls invisible panels while preserving a scrolled edge and bounded corner radius", () => {
  assert.deepEqual(glassSurfaceRect({left:-20, top:-120, width:400, height:300}, 800, 600, 999),
    {rect:[-20, -120, 400, 300], radius:150});
  assert.equal(glassSurfaceRect({left:800, top:0, width:200, height:200}, 800, 600), null);
  assert.equal(glassSurfaceRect({left:0, top:-300, width:200, height:200}, 800, 600), null);
  assert.equal(glassSurfaceRect({left:0, top:0, width:0, height:200}, 800, 600), null);
  assert.equal(glassSurfaceRect({left:NaN, top:0, width:200, height:200}, 800, 600), null);
});

test("classic and matte allocate no canvas; unavailable GPU falls back once per activation", () => {
  const app = fixture({theme:"classic", gpu:false});
  const cleanup = wireGlassMaterial(app);
  assert.equal(wireGlassMaterial(app), cleanup);
  assert.equal(app.canvases.length, 0);
  app.switchTheme("matte-black");assert.equal(app.canvases.length, 0);
  app.switchTheme("glass-light");assert.equal(app.root.dataset.glassRenderer, "fallback");
  assert.equal(app.canvases.length, 1);assert.equal(app.images.length, 0);
  app.window.emit("resize");app.observers[0].callback([]);
  assert.equal(app.canvases.length, 1);assert.equal(app.frames.size, 0);
  cleanup();cleanup();
  assert.equal(app.document.listenerCount, 0);assert.equal(app.window.listenerCount, 0);
  assert.ok(app.observers.every(observer => observer.disconnected));
  assert.equal(app.root.dataset.glassRenderer, undefined);
});

test("successful optics are static, bounded and release all GPU resources on skin changes", () => {
  const app = fixture({width:4000, height:2500}), cleanup = wireGlassMaterial(app);
  assert.equal(app.images.length, 1);
  assert.match(app.images[0].src, /assets\/themes\/coast\.png$/);
  const canvas = app.canvases[0], gl = app.contexts[0];
  assert.equal(canvas.attributes["aria-hidden"], "true");assert.equal(canvas.style.pointerEvents, "none");
  app.images[0].onload();
  assert.equal(app.root.dataset.glassRenderer, "webgl");assert.equal(canvas.isConnected, true);
  assert.equal(gl.draws, 1);assert.equal(app.frames.size, 0);
  assert.equal(gl.uniforms.u_count, 6);assert.equal(gl.uniforms.u_brightness, 1);assert.equal(gl.uniforms.u_saturation, .55);
  assert.ok(canvas.width * canvas.height < 2504000);
  app.window.emit("resize");app.document.emit("scroll");app.observers[0].callback([]);
  assert.equal(app.frames.size, 1);app.flush();
  assert.equal(gl.draws, 1);assert.equal(app.frames.size, 0);
  app.observers[0].callback([{type:"childList", addedNodes:[{nodeType:3}], removedNodes:[{nodeType:3}]}]);
  assert.equal(app.frames.size, 0);
  app.panels[0].getBoundingClientRect = () => ({left:18, top:70, width:320, height:450});
  app.document.emit("scroll");app.flush();
  assert.equal(gl.draws, 2);assert.equal(app.frames.size, 0);
  app.switchTheme("glass-black");
  assert.equal(canvas.isConnected, false);
  assert.deepEqual(gl.disposed.sort(), ["buffer", "context", "program", "shader", "shader", "texture"]);
  app.images[1].onload();assert.equal(app.contexts[1].uniforms.u_brightness, .30);
  assert.equal(app.contexts[1].uniforms.u_saturation, .45);
  app.switchTheme("matte-black");assert.equal(app.canvases[1].isConnected, false);
  assert.equal(app.root.dataset.glassRenderer, undefined);
  cleanup();
});

test("hidden pages and reduced transparency release optics and restore them only when appropriate", () => {
  const app = fixture({reduced:true}), cleanup = wireGlassMaterial(app);
  assert.equal(app.canvases.length, 0);assert.equal(app.root.dataset.glassRenderer, "fallback");
  app.media.matches = false;app.media.emit("change");
  app.images[0].onload();
  app.window.emit("resize");assert.equal(app.frames.size, 1);
  app.document.hidden = true;app.document.emit("visibilitychange");
  assert.equal(app.frames.size, 0);assert.equal(app.canvases[0].isConnected, false);
  assert.equal(app.images[0].onload, null);
  app.document.hidden = false;app.document.emit("visibilitychange");
  assert.equal(app.canvases.length, 2);app.images[1].onload();
  app.media.matches = true;app.media.emit("change");
  assert.equal(app.canvases[1].isConnected, false);assert.equal(app.root.dataset.glassRenderer, "fallback");
  cleanup();assert.equal(app.media.listenerCount, 0);
});

test("optics match the real home composer and exclude hidden or offscreen surfaces", () => {
  const markup = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
  const composer = markup.match(/<section\b[^>]*class="([^"]+)"[^>]*aria-labelledby="composer-title"/);
  assert.ok(composer, "the home download composer exists");
  const app = fixture(), visible = app.panels[0];
  const hidden = {...visible, hidden:true};
  const collapsed = {...visible, getClientRects:() => []};
  const transparent = {...visible, transparent:true};
  const offscreen = {...visible, getBoundingClientRect:() => ({left:2000, top:0, width:400, height:300})};
  app.document.querySelectorAll = selector => {
    assert.ok(composer[1].split(/\s+/).some(name => selector.split(/,\s*/).includes("." + name)),
      "the material targets the semantic home composer from the current HTML");
    return [hidden, collapsed, transparent, offscreen, visible];
  };
  app.window.getComputedStyle = panel => ({display:"block", visibility:"visible", opacity:panel.transparent ? "0" : "1", borderTopLeftRadius:"18px"});
  const cleanup = wireGlassMaterial(app);app.images[0].onload();
  assert.equal(app.contexts[0].uniforms.u_count, 1);
  assert.deepEqual(app.contexts[0].uniforms["u_rects[0]"].slice(0, 4), [0, 0, 320, 450]);
  cleanup();
});

test("shader, image and context failures leave the CSS fallback usable without retry loops", () => {
  const compileFailure = fixture({compile:false}), stopCompile = wireGlassMaterial(compileFailure);
  assert.equal(compileFailure.root.dataset.glassRenderer, "fallback");
  assert.equal(compileFailure.canvases[0].isConnected, false);
  assert.equal(compileFailure.images.length, 0);stopCompile();
  const app = fixture(), cleanup = wireGlassMaterial(app);
  const staleLoad = app.images[0].onload;
  app.images[0].onerror();assert.equal(app.root.dataset.glassRenderer, "fallback");
  staleLoad();assert.equal(app.root.dataset.glassRenderer, "fallback");
  app.switchTheme("glass-light");app.images[1].onload();
  app.canvases[1].emit("webglcontextlost");
  assert.equal(app.root.dataset.glassRenderer, "fallback");
  assert.equal(app.canvases[1].isConnected, false);
  app.window.emit("resize");assert.equal(app.frames.size, 0);
  cleanup();
});
