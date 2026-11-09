export const SLEEP_MINUTES = [15, 30, 45, 60, 90];
export const SLEEP_FADE = 30000;

// Pure volume factor for the last part of a timed sleep.
export function sleepDim(remaining, fade = SLEEP_FADE) {
  if (!Number.isFinite(remaining)) return 1;
  return remaining >= fade ? 1 : Math.max(0, remaining / fade);
}

export function createSleepTimer({
  now = Date.now,
  schedule = setInterval,
  cancel = clearInterval,
  onDim = () => {},
  onExpire = () => {},
  onChange = () => {},
} = {}) {
  let mode = "off",
    until = 0,
    timer = null;
  const stop = () => {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  };
  function tick() {
    const remaining = until - now();
    onDim(sleepDim(remaining));
    if (remaining <= 0) {
      stop();
      mode = "off";
      until = 0;
      onExpire();
      onDim(1);
    }
    onChange();
  }
  return {
    get mode() {
      return mode;
    },
    remaining() {
      return mode === "time" ? Math.max(0, until - now()) : 0;
    },
    set(value) {
      stop();
      onDim(1);
      if (value === "track") {
        mode = "track";
        until = 0;
      } else if (SLEEP_MINUTES.includes(value)) {
        mode = "time";
        until = now() + value * 60000;
        timer = schedule(tick, 1000);
      } else {
        mode = "off";
        until = 0;
      }
      onChange();
    },
    holdsTrackEnd() {
      return mode === "track";
    },
    // Called when the current track ends naturally; true means playback stops here.
    consumeTrackEnd() {
      if (mode !== "track") return false;
      mode = "off";
      onChange();
      return true;
    },
    clear() {
      this.set(0);
    },
  };
}

export function sleepLabel(timer, t) {
  if (timer.mode === "track") return t("Sleep after this track");
  if (timer.mode === "time")
    return t("Sleep in {minutes} min", { minutes: Math.max(1, Math.ceil(timer.remaining() / 60000)) });
  return t("Sleep timer");
}
