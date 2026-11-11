import { t, onLanguageChange } from "./i18n.js";
import {
  frequencies,
  presets,
  soundSettings,
  equalizerHeadroom,
  createMusicRate,
  createSilenceWatch,
  SILENCE,
} from "./music-sound-model.js";
import { createSegmentSkip } from "./music-skip-segments.js";
export { soundSettings } from "./music-sound-model.js";
export function createMusicSound({
  nodes,
  storage,
  button,
  notify,
  getAudio = () => nodes[0],
  onRateChange = () => {},
  invoke = null,
  canSkip = () => true,
}) {
  let settings;
  try {
    settings = soundSettings(JSON.parse(storage?.getItem("devil-music-sound") || "{}"));
  } catch {
    settings = soundSettings();
  }
  // Per-player level trims for "Even out song volume": loud songs are turned down, quiet ones left as they are.
  let context = null,
    graphs = [],
    revision = 0;
  const trims = new Map();
  const speed = createMusicRate(nodes, () => settings.rate);
  const segments = createSegmentSkip({
    invoke: invoke || (async () => null),
    enabled: () => !!invoke && settings.skipSegments,
    allowed: canSkip,
  });
  for (const node of nodes)
    node.addEventListener("timeupdate", () => {
      if (node === getAudio()) segments.check(node);
    });
  function ramp(param, value, delay = 0) {
    const now = context.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.setTargetAtTime(value, now + delay, 0.025);
  }
  function apply() {
    const bands = settings.bypass ? frequencies.map(() => 0) : settings.bands;
    for (const graph of graphs) {
      const gain =
        equalizerHeadroom(bands, context.sampleRate) * (settings.level ? (trims.get(graph.node) ?? 1) : 1);
      ramp(graph.preamp.gain, gain, gain > graph.preamp.gain.value ? 0.12 : 0.6);
      graph.filters.forEach((filter, i) => ramp(filter.gain, bands[i]));
      ramp(graph.compressor.threshold, !settings.bypass && settings.soft ? -24 : 0);
      ramp(graph.compressor.ratio, !settings.bypass && settings.soft ? 3 : 1);
    }
  }
  async function activate() {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw Error(t("Sound processing is unavailable on this device."));
      context = new AudioContext();
      for (const node of nodes) {
        const source = context.createMediaElementSource(node),
          preamp = context.createGain(),
          compressor = context.createDynamicsCompressor();
        const filters = frequencies.map(frequency => {
          const filter = context.createBiquadFilter();
          filter.type = "peaking";
          filter.frequency.value = Math.min(frequency, context.sampleRate * 0.49);
          filter.Q.value = 0.7;
          return filter;
        });
        source.connect(preamp);
        let output = preamp;
        for (const filter of filters) {
          output.connect(filter);
          output = filter;
        }
        output.connect(compressor);
        compressor.connect(context.destination);
        graphs.push({ node, filters, preamp, compressor });
      }
    }
    apply();
    await context.resume();
  }
  const needsGraph = () =>
    settings.soft || settings.level || settings.skipSilence || settings.bands.some(Boolean);
  // The analyser is a side branch, never a second connection to the speakers.
  function tap(graph) {
    if (graph.analyser) return;
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.35;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -15;
    graph.compressor.connect(analyser);
    graph.analyser = analyser;
    graph.spectrum = new Uint8Array(analyser.frequencyBinCount);
    graph.wave = new Float32Array(analyser.fftSize);
  }
  const silence = createSilenceWatch();
  let silenceTimer = 0,
    hurried = null;
  function release() {
    if (hurried) speed.hurry(hurried, 0);
    hurried = null;
    silence.reset();
  }
  function checkSilence() {
    const node = getAudio(),
      graph = graphs.find(graph => graph.node === node);
    if (hurried && hurried !== node) release();
    // During an overlap the other song is still audible, and a muted player tells nothing about its sound.
    const listening =
      context.state === "running" &&
      !!graph?.analyser &&
      !node.paused &&
      !node.seeking &&
      node.readyState >= 3 &&
      !node.muted &&
      node.volume >= 0.02 &&
      !nodes.some(other => other !== node && !other.paused);
    let rms = 1;
    if (listening) {
      graph.analyser.getFloatTimeDomainData(graph.wave);
      let energy = 0;
      for (const sample of graph.wave) energy += sample * sample;
      // Whether or not the browser applies the element volume before the graph, this hears the song itself.
      rms = Math.sqrt(energy / graph.wave.length) / node.volume;
    }
    const quiet = silence.update(rms, performance.now() / 1000, listening);
    if (quiet && hurried !== node) {
      hurried = node;
      speed.hurry(node, SILENCE.rate);
    } else if (!quiet && hurried) release();
  }
  function watchSilence() {
    if (!settings.skipSilence || speed.mode || !context) {
      clearInterval(silenceTimer);
      silenceTimer = 0;
      release();
      return;
    }
    graphs.forEach(tap);
    silenceTimer ||= setInterval(checkSilence, 50);
  }
  async function commit() {
    const token = ++revision;
    try {
      storage?.setItem("devil-music-sound", JSON.stringify(settings));
      speed.refresh();
      onRateChange();
      if (context || needsGraph()) await activate();
      watchSilence();
    } catch (error) {
      if (token === revision) notify(error.message, true);
    }
    refresh();
  }
  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    return n;
  };
  const dialog = node("dialog");
  dialog.className = "music-settings-dialog music-sound-panel";
  dialog.setAttribute("aria-label", t("Sound and transitions"));
  const heading = node("h2"),
    intro = node("p");
  dialog.append(heading, intro);
  const presetRow = node("label"),
    presetLabel = node("span"),
    presetInput = node("select");
  presetRow.append(presetLabel, presetInput);
  dialog.append(presetRow);
  presetInput.addEventListener("change", () => {
    const key = presetInput.value;
    if (key.startsWith("saved:")) {
      settings.bands = [...settings.custom[Number(key.slice(6))].bands];
      settings.preset = "custom";
      settings.selected = settings.custom[Number(key.slice(6))].name;
    } else if (presets[key]) {
      settings.selected = "";
      settings.preset = key;
      settings.bands = [...presets[key]];
    }
    commit();
  });
  const grid = node("div");
  grid.className = "music-eq-bands";
  const sliders = frequencies.map((frequency, i) => {
    const row = node("label"),
      caption = node("span", frequency >= 1000 ? frequency / 1000 + " kHz" : frequency + " Hz"),
      input = node("input"),
      value = node("output");
    input.type = "range";
    input.min = -12;
    input.max = 12;
    input.step = 0.5;
    input.ariaLabel = caption.textContent;
    input.addEventListener("input", () => {
      settings.bands[i] = Number(input.value);
      settings.preset = "custom";
      settings.selected = "";
      commit();
    });
    row.append(caption, input, value);
    grid.append(row);
    return { input, value };
  });
  dialog.append(grid);
  const presetEditor = node("div");
  presetEditor.className = "music-preset-editor";
  const name = node("input");
  name.maxLength = 48;
  const save = button(
    "",
    null,
    () => {
      const title = name.value.trim();
      if (!title) {
        name.focus();
        return;
      }
      const existing = settings.custom.findIndex(
        p => p.name.toLocaleLowerCase() === title.toLocaleLowerCase(),
      );
      if (existing >= 0) settings.custom[existing] = { name: title, bands: [...settings.bands] };
      else if (settings.custom.length < 50) settings.custom.push({ name: title, bands: [...settings.bands] });
      else {
        notify(t("You can save up to 50 sound presets."), true);
        return;
      }
      settings.selected = title;
      settings.preset = "custom";
      name.value = "";
      commit();
    },
    "outline small",
  );
  const remove = button(
    "",
    null,
    () => {
      const selected = settings.custom.findIndex(p => p.name === settings.selected);
      if (selected >= 0) {
        settings.custom.splice(selected, 1);
        settings.selected = "";
        commit();
      }
    },
    "outline small",
  );
  presetEditor.append(name, save, remove);
  dialog.append(presetEditor);
  function choice(onchange) {
    const row = node("label"),
      label = node("span"),
      input = node("select");
    row.append(label, input);
    dialog.append(row);
    input.addEventListener("change", () => {
      onchange(input.value);
      commit();
    });
    return { label, input };
  }
  function toggle(onchange) {
    const row = node("label"),
      label = node("span"),
      input = node("input");
    input.type = "checkbox";
    row.className = "music-sound-toggle";
    row.append(label, input);
    dialog.append(row);
    input.addEventListener("change", () => {
      onchange(input.checked);
      commit();
    });
    return { label, input };
  }
  const bypass = toggle(value => (settings.bypass = value)),
    soft = toggle(value => (settings.soft = value)),
    level = toggle(value => (settings.level = value)),
    transition = choice(value => (settings.transition = Number(value))),
    seamless = toggle(value => (settings.seamless = value)),
    skipSilence = toggle(value => (settings.skipSilence = value)),
    skipSegments = toggle(value => (settings.skipSegments = value));
  const rateRow = node("label"),
    rateLabel = node("span"),
    rate = node("input"),
    rateValue = node("output");
  rate.type = "range";
  rate.min = 0.5;
  rate.max = 2;
  rate.step = 0.05;
  rate.addEventListener("input", () => {
    if (!speed.reason(getAudio())) {
      settings.rate = Number(rate.value);
      commit();
    }
  });
  rateRow.className = "music-sound-rate";
  rateRow.append(rateLabel, rate, rateValue);
  dialog.append(rateRow);
  const rateHelp = node("p");
  rateHelp.role = "status";
  dialog.append(rateHelp);
  const actions = node("div");
  actions.className = "music-sound-actions";
  const reset = button(
      "",
      null,
      () => {
        settings = soundSettings({ custom: settings.custom });
        commit();
      },
      "outline small",
    ),
    close = button("", null, () => dialog.close(), "outline small");
  actions.append(reset, close);
  dialog.append(actions);
  const note = node("p");
  dialog.append(note);
  document.body.append(dialog);
  const options = (input, values, value) => {
    input.replaceChildren(
      ...values.map(([key, label]) => {
        const option = node("option", label);
        option.value = key;
        return option;
      }),
    );
    input.value = value;
  };
  function refresh() {
    heading.textContent = t("Sound and transitions");
    intro.textContent = t("Shape your sound. Your original files stay unchanged.");
    const customIndex = settings.custom.findIndex(p => p.name === settings.selected);
    options(
      presetInput,
      [
        ["flat", t("Flat")],
        ["bass", t("Bass boost")],
        ["voice", t("Vocals")],
        ["night", t("Night")],
        ["custom", t("Custom")],
        ...settings.custom.map((p, i) => ["saved:" + i, p.name]),
      ],
      settings.preset === "custom" && customIndex >= 0 ? "saved:" + customIndex : settings.preset,
    );
    presetLabel.textContent = t("Equalizer");
    for (const [i, slider] of sliders.entries()) {
      slider.input.value = settings.bands[i];
      slider.input.disabled = settings.bypass;
      slider.value.textContent = (settings.bands[i] > 0 ? "+" : "") + settings.bands[i] + " dB";
      slider.input.setAttribute("aria-valuetext", slider.value.textContent);
    }
    name.placeholder = name.ariaLabel = t("Preset name");
    save.textContent = save.ariaLabel = t("Save preset");
    remove.textContent = remove.ariaLabel = t("Delete preset");
    remove.disabled = customIndex < 0;
    bypass.input.checked = !!settings.bypass;
    soft.input.checked = !!settings.soft;
    bypass.label.textContent = t("Bypass sound effects");
    soft.label.textContent = t("Volume smoothing");
    soft.input.disabled = settings.bypass;
    level.input.checked = !!settings.level;
    level.label.textContent = t("Even out song volume");
    level.input.disabled = settings.bypass;
    level.label.title = t(
      "Loud songs play a little quieter, the way YouTube levels them. Quiet songs are not boosted.",
    );
    transition.label.textContent = t("Track transition");
    options(
      transition.input,
      [
        [0, t("No overlap")],
        [2, t("2 seconds")],
        [4, t("4 seconds")],
        [6, t("6 seconds")],
        [8, t("8 seconds")],
        [12, t("12 seconds")],
      ],
      String(settings.transition),
    );
    seamless.input.checked = settings.seamless;
    seamless.label.textContent = t("Play albums without gaps");
    skipSilence.input.checked = settings.skipSilence;
    skipSilence.input.disabled = !!speed.mode;
    skipSilence.label.textContent = t("Skip silence");
    skipSegments.input.checked = settings.skipSegments;
    skipSegments.label.textContent = t("Skip non-music parts of music videos");
    skipSegments.label.title = t(
      "Intros and outros marked by the SponsorBlock community. Only a short fragment of a code made from the video id is sent, never the video itself.",
    );
    skipSilence.label.title = t(
      "Quiet stretches inside and around a song pass quickly. Listening rooms keep normal time.",
    );
    rateLabel.textContent = rate.ariaLabel = t("Playback speed");
    rate.value = settings.rate;
    rateValue.textContent = settings.rate.toFixed(2) + "\u00d7";
    rate.disabled = !!speed.reason(getAudio());
    const reason = speed.reason(getAudio());
    rateHelp.textContent =
      reason === "room"
        ? t("Listening rooms use normal speed for synchronization.")
        : reason === "pitch"
          ? t("This device cannot preserve pitch at other speeds.")
          : t("Voice pitch is preserved.");
    reset.textContent = reset.ariaLabel = t("Reset sound settings");
    close.textContent = close.ariaLabel = t("Close");
    note.textContent = t(
      "Prepared tracks start immediately. Overlap applies when the next track is ready. Volume smoothing reduces sudden peaks; it does not measure album loudness.",
    );
  }
  refresh();
  onLanguageChange(refresh);
  document.addEventListener(
    "pointerdown",
    () => {
      if (needsGraph())
        activate()
          .then(watchSilence)
          .catch(() => {});
    },
    { once: true },
  );
  // How long sound takes from the player to the speakers; Bluetooth headphones add a lot. Text and video
  // that follow the song subtract it so they meet the voice rather than run ahead of it.
  const latency = () => {
    if (!context || context.state !== "running") return 0;
    const value = (Number(context.outputLatency) || 0) + (Number(context.baseLatency) || 0);
    return Number.isFinite(value) ? Math.min(0.6, Math.max(0, value)) : 0;
  };
  // [db] is how much louder than YouTube's reference the song is; unknown leaves the player at full level.
  async function setLevel(node, db) {
    const trim = Number.isFinite(db) && db > 0 ? Math.max(0.25, 10 ** (-db / 20)) : 1;
    if (trims.get(node) === trim) return;
    trims.set(node, trim);
    if (!settings.level) return;
    try {
      await activate();
    } catch {
      /* Levelling needs the sound graph; playback continues without it. */
    }
  }
  return {
    latency,
    setLevel,
    get levelling() {
      return !!settings.level;
    },
    open() {
      refresh();
      if (!dialog.open) dialog.showModal();
    },
    get transition() {
      return settings.transition;
    },
    get rate() {
      return settings.rate;
    },
    // The speed from outside this dialog (the dock menu, the [ and ] keys). Refused where a listening room
    // or the device rules speed out, exactly like the slider.
    setRate(value) {
      if (speed.reason(getAudio())) return false;
      settings.rate = soundSettings({ ...settings, rate: Number(value) }).rate;
      commit();
      return true;
    },
    rateBlocked: () => speed.reason(getAudio()),
    get seamless() {
      return settings.seamless;
    },
    get skipSegments() {
      return settings.skipSegments;
    },
    resume() {
      if (context) context.resume().catch(() => {});
    },
    // [sourceId] is the YouTube recording being played; local and downloaded files have none.
    setSource(node, offline, sourceId) {
      speed.setSource(node, offline);
      if (node === getAudio()) segments.load(sourceId);
      if (dialog.open) refresh();
    },
    setRoomMode(mode) {
      speed.setMode(mode);
      watchSilence();
      refresh();
      onRateChange();
    },
    async enableAnalysis() {
      await activate();
      graphs.forEach(tap);
    },
    analyse(node) {
      const graph = graphs.find(graph => graph.node === node);
      if (context?.state !== "running" || !graph?.analyser) return null;
      const { analyser, spectrum, wave } = graph;
      analyser.getByteFrequencyData(spectrum);
      analyser.getFloatTimeDomainData(wave);
      const hz = context.sampleRate / analyser.fftSize;
      const band = (low, high) => {
        const from = Math.max(1, Math.floor(low / hz)),
          to = Math.min(spectrum.length - 1, Math.ceil(high / hz));
        let sum = 0,
          peak = 0;
        for (let i = from; i <= to; i++) {
          const value = spectrum[i] / 255;
          sum += value * value;
          peak = Math.max(peak, value);
        }
        return peak * 0.6 + Math.sqrt(sum / Math.max(1, to - from + 1)) * 0.4;
      };
      let energy = 0;
      for (const sample of wave) energy += sample * sample;
      return {
        bass: band(35, 180),
        mid: band(180, 2200),
        high: band(2200, 9000),
        rms: Math.sqrt(energy / wave.length),
      };
    },
  };
}
