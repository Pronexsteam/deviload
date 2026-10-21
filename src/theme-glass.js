// Static wallpaper optics for the two glass skins. The normal CSS material is
// always underneath this optional layer, including on devices without WebGL.
const GLASS_THEMES = new Set(["glass-light", "glass-black"]);
const SURFACES = ".sidebar, .topbar, .supporters-board, .download-composer, .library, .media-library, .discover, .editor-card, .music-library-sidebar, .music-hero, .music-dock, .convert-drop, .convert-options, .convert-list-wrap, .cut-head, .cut-media, .cut-inspector";
const MAX_SURFACES = 6;
const wired = new WeakMap();
const wallpaper = new URL("./assets/themes/coast.png", import.meta.url).href;

const vertexSource = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const fragmentSource = `
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec2 u_viewport;
uniform vec4 u_cover;
uniform vec4 u_rects[6];
uniform float u_radii[6];
uniform int u_count;
uniform float u_brightness;
uniform float u_saturation;

float surfaceDistance(vec2 p, vec4 rect, float radius) {
  vec2 halfSize = rect.zw * 0.5;
  vec2 q = abs(p - rect.xy - halfSize) - (halfSize - radius);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

void main() {
  vec2 screen = gl_FragCoord.xy / u_resolution;
  vec2 p = vec2(screen.x, 1.0 - screen.y) * u_viewport;
  vec2 displacement = vec2(0.0);
  float specular = 0.0;
  float shade = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= u_count) break;
    vec4 rect = u_rects[i];
    float radius = u_radii[i];
    float d = surfaceDistance(p, rect, radius);
    // Refraction lives near the physical edge, keeping the text area quiet.
    float edge = (1.0 - smoothstep(0.0, 16.0, abs(d)))
      * (1.0 - smoothstep(0.0, 2.0, d));
    if (edge > 0.0) {
      vec2 normal = vec2(
        surfaceDistance(p + vec2(1.0, 0.0), rect, radius)
          - surfaceDistance(p - vec2(1.0, 0.0), rect, radius),
        surfaceDistance(p + vec2(0.0, 1.0), rect, radius)
          - surfaceDistance(p - vec2(0.0, 1.0), rect, radius)
      );
      normal /= max(length(normal), 0.001);
      displacement += normal * edge * 4.0;
      float rim = (1.0 - smoothstep(0.0, 2.5, abs(d))) * edge;
      specular += max(dot(normal, normalize(vec2(-0.65, -1.0))), 0.0) * rim;
      shade += max(dot(normal, normalize(vec2(0.65, 1.0))), 0.0) * rim;
    }
  }
  // Overlapping panels cannot amplify displacement beyond five CSS pixels.
  displacement *= min(1.0, 5.0 / max(length(displacement), 0.001));
  vec2 shifted = screen + vec2(displacement.x, -displacement.y) / u_viewport;
  vec2 uv = clamp(shifted * u_cover.xy + u_cover.zw, vec2(0.001), vec2(0.999));
  vec3 color = texture2D(u_image, uv).rgb;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, u_saturation) * u_brightness;
  color += min(specular, 1.0) * 0.11 * (0.35 + u_brightness * 0.65);
  color -= min(shade, 1.0) * 0.035;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

/** UV transform matching a centered CSS background-size: cover image. */
export function glassCover(viewportWidth, viewportHeight, imageWidth, imageHeight) {
  const dimensions = [viewportWidth, viewportHeight, imageWidth, imageHeight];
  if (!dimensions.every(value => Number.isFinite(value) && value > 0)) return [1, 1, 0, 0];
  const relativeAspect = (viewportWidth / viewportHeight) / (imageWidth / imageHeight);
  const x = Math.min(1, relativeAspect), y = Math.min(1, 1 / relativeAspect);
  return [x, y, (1 - x) / 2, (1 - y) / 2];
}

/** Cull offscreen panels without moving the rounded edge of a scrolled panel. */
export function glassSurfaceRect(bounds, viewportWidth, viewportHeight, radius = 0) {
  const x = bounds?.left, y = bounds?.top, width = bounds?.width, height = bounds?.height;
  if (![x, y, width, height, viewportWidth, viewportHeight].every(Number.isFinite)
    || width <= 0 || height <= 0 || viewportWidth <= 0 || viewportHeight <= 0
    || x >= viewportWidth || y >= viewportHeight || x + width <= 0 || y + height <= 0) return null;
  return {rect:[x, y, width, height], radius:Math.max(0, Math.min(Number(radius) || 0, width / 2, height / 2))};
}

function compile(gl, type, source, state) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("No glass shader");
  state.shaders.push(shader);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Glass shader unavailable");
  return shader;
}

/** Returns an idempotent cleanup function. No animation loop or remote assets. */
export function wireGlassMaterial({document = globalThis.document, window = globalThis.window} = {}) {
  const root = document?.documentElement, body = document?.body;
  if (!root || !body || !window) return () => {};
  if (wired.has(root)) return wired.get(root);
  let state = null, frame = null, disposed = false, suspended = false, failedTheme = null;
  let transparencyQuery = null;
  try { transparencyQuery = window.matchMedia?.("(prefers-reduced-transparency: reduce)") || null; } catch { /* Older embedded browsers may not expose media queries. */ }
  const listeners = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };

  function clearFrame() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
  }

  function release() {
    clearFrame();
    const previous = state;
    state = null;
    if (!previous) return;
    if (previous.image) {
      previous.image.onload = null;
      previous.image.onerror = null;
    }
    previous.canvas.removeEventListener("webglcontextlost", previous.onContextLost);
    previous.canvas.remove();
    const gl = previous.gl;
    if (gl) {
      try {
        if (previous.texture) gl.deleteTexture(previous.texture);
        if (previous.buffer) gl.deleteBuffer(previous.buffer);
        if (previous.program) gl.deleteProgram(previous.program);
        for (const shader of previous.shaders) gl.deleteShader(shader);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      } catch { /* A lost GPU context is already released by the browser. */ }
    }
  }

  function fail(theme) {
    if (disposed) return;
    failedTheme = theme;
    release();
    root.dataset.glassRenderer = "fallback";
  }

  function schedule() {
    if (!state?.ready || disposed || document.hidden || suspended || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      try { draw(); } catch { if (state) fail(state.theme); }
    });
  }

  function draw() {
    const current = state;
    if (!current?.ready || disposed || document.hidden || suspended) return;
    const width = Math.max(1, root.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, window.innerHeight || root.clientHeight || 1);
    // One static draw is capped at 2.5 million pixels, even on large Retina screens.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2500000 / (width * height)));
    const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
    const {canvas, gl, uniforms} = current;
    const rectangles = new Float32Array(MAX_SURFACES * 4), radii = new Float32Array(MAX_SURFACES);
    let count = 0;
    for (const panel of document.querySelectorAll(SURFACES)) {
      if (count === MAX_SURFACES) break;
      if (panel.hidden || !panel.getClientRects().length) continue;
      const style = window.getComputedStyle(panel);
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
      const bounds = panel.getBoundingClientRect();
      const rawRadius = style.borderTopLeftRadius || "0";
      const radius = rawRadius.includes("%") ? parseFloat(rawRadius) * Math.min(bounds.width, bounds.height) / 100 : parseFloat(rawRadius);
      const surface = glassSurfaceRect(bounds, width, height, radius);
      if (!surface) continue;
      rectangles.set(surface.rect, count * 4);
      radii[count] = surface.radius;
      count++;
    }
    const layout = `${width},${height},${pixelWidth},${pixelHeight},${count};${rectangles.join(",")};${radii.join(",")}`;
    if (current.layout === layout && canvas.isConnected) return;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.useProgram(current.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, current.buffer);
    gl.enableVertexAttribArray(current.position);
    gl.vertexAttribPointer(current.position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, current.texture);
    gl.uniform1i(uniforms.image, 0);
    gl.uniform2f(uniforms.resolution, pixelWidth, pixelHeight);
    gl.uniform2f(uniforms.viewport, width, height);
    gl.uniform4fv(uniforms.cover, glassCover(width, height, current.image.naturalWidth, current.image.naturalHeight));
    gl.uniform4fv(uniforms.rects, rectangles);
    gl.uniform1fv(uniforms.radii, radii);
    gl.uniform1i(uniforms.count, count);
    gl.uniform1f(uniforms.brightness, current.theme === "glass-light" ? 1 : .30);
    gl.uniform1f(uniforms.saturation, current.theme === "glass-light" ? .55 : .45);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (gl.isContextLost()) throw new Error("Glass context lost");
    current.layout = layout;
    if (!canvas.isConnected) body.prepend(canvas);
    root.dataset.glassRenderer = "webgl";
  }

  function activate(theme) {
    const canvas = document.createElement("canvas");
    canvas.className = "theme-glass-scene";
    canvas.setAttribute("aria-hidden", "true");
    // The canvas is decoration and must never capture window or content actions.
    Object.assign(canvas.style, {position:"fixed", inset:"0", width:"100%", height:"100%", zIndex:"0", pointerEvents:"none"});
    const current = {theme, canvas, gl:null, shaders:[], program:null, texture:null, buffer:null, image:null, ready:false};
    state = current;
    current.onContextLost = event => {
      event.preventDefault();
      if (state === current) fail(theme);
    };
    canvas.addEventListener("webglcontextlost", current.onContextLost);
    try {
      const gl = canvas.getContext("webgl", {alpha:false, antialias:false, depth:false, stencil:false, preserveDrawingBuffer:false, powerPreference:"low-power"});
      if (!gl) throw new Error("WebGL not available");
      current.gl = gl;
      const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource, current);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, current);
      const program = gl.createProgram();
      if (!program) throw new Error("No glass program");
      current.program = program;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Glass material unavailable");
      current.position = gl.getAttribLocation(program, "a_position");
      if (current.position < 0) throw new Error("No glass geometry");
      current.buffer = gl.createBuffer();
      current.texture = gl.createTexture();
      if (!current.buffer || !current.texture) throw new Error("No glass resources");
      gl.bindBuffer(gl.ARRAY_BUFFER, current.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      current.uniforms = Object.fromEntries([
        ["image", "u_image"], ["resolution", "u_resolution"], ["viewport", "u_viewport"],
        ["cover", "u_cover"], ["rects", "u_rects[0]"], ["radii", "u_radii[0]"],
        ["count", "u_count"], ["brightness", "u_brightness"], ["saturation", "u_saturation"]
      ].map(([key, name]) => [key, gl.getUniformLocation(program, name)]));
      const image = new window.Image();
      current.image = image;
      image.onload = () => {
        if (disposed || state !== current) return;
        try {
          if (!image.naturalWidth || !image.naturalHeight) throw new Error("No glass wallpaper");
          gl.bindTexture(gl.TEXTURE_2D, current.texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          current.ready = true;
          draw();
        } catch { fail(theme); }
      };
      image.onerror = () => { if (state === current) fail(theme); };
      image.src = wallpaper;
    } catch { fail(theme); }
  }

  function update({retry = false} = {}) {
    if (disposed) return;
    const theme = root.dataset.theme;
    if (retry || (failedTheme && failedTheme !== theme)) failedTheme = null;
    if (!GLASS_THEMES.has(theme) || document.hidden || suspended) {
      release();
      delete root.dataset.glassRenderer;
      return;
    }
    if (transparencyQuery?.matches) {
      release();
      root.dataset.glassRenderer = "fallback";
      return;
    }
    if (failedTheme === theme) {
      root.dataset.glassRenderer = "fallback";
      return;
    }
    if (state?.theme === theme) { schedule();return; }
    release();
    activate(theme);
  }

  function cleanup() {
    if (disposed) return;
    disposed = true;
    mutationObserver?.disconnect();
    resizeObserver?.disconnect();
    for (const remove of listeners) remove();
    release();
    delete root.dataset.glassRenderer;
    wired.delete(root);
  }

  const mutationObserver = window.MutationObserver ? new window.MutationObserver(records => {
    // Current playback time and transfer sizes replace text nodes frequently;
    // they do not move the material and must not keep the GPU drawing.
    if (records.some(record => record.type === "attributes"
      || [...(record.addedNodes || []), ...(record.removedNodes || [])].some(node => node.nodeType === 1))) schedule();
  }) : null;
  mutationObserver?.observe(body, {subtree:true, childList:true, attributes:true, attributeFilter:["class", "hidden", "open", "data-page", "data-view"]});
  const resizeObserver = window.ResizeObserver ? new window.ResizeObserver(schedule) : null;
  resizeObserver?.observe(body);
  const main = document.querySelector("main");
  if (main) resizeObserver?.observe(main);
  listen(document, "deviload-theme-change", () => update({retry:true}));
  listen(window, "resize", schedule, {passive:true});
  listen(document, "scroll", schedule, {passive:true, capture:true});
  listen(document, "visibilitychange", update);
  listen(window, "pagehide", () => { suspended = true;release();delete root.dataset.glassRenderer; });
  listen(window, "pageshow", () => { suspended = false;update(); });
  if (transparencyQuery?.addEventListener) listen(transparencyQuery, "change", update);
  else if (transparencyQuery?.addListener) {
    transparencyQuery.addListener(update);
    listeners.push(() => transparencyQuery.removeListener(update));
  }
  wired.set(root, cleanup);
  update();
  return cleanup;
}
