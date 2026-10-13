export const safe = (e: any) => String(e?.message || e).replace(/https?:\/\/\S+/g, '[url]').slice(0, 300);
export const restricted = (error: unknown) => /403|429|LOGIN_REQUIRED|UNPLAYABLE|AGE_CHECK_REQUIRED|not a bot|sign in|rate limit/i.test(safe(error));
export function playbackError(error: unknown): string {
  const message = safe(error);
  if (/429|rate limit/i.test(message)) return 'Playback temporarily limited by YouTube. Wait before trying again.';
  if (/LOGIN_REQUIRED|AGE_CHECK_REQUIRED|not a bot|sign in/i.test(message)) return 'Playback restricted: YouTube requires sign-in or verification. Try another track.';
  if (/UNPLAYABLE/i.test(message)) return 'Playback restricted: this track is unavailable from YouTube. Try another track.';
  if (/403/.test(message)) return 'Playback restricted: YouTube denied access to the audio. Try another track.';
  return /abort|cancel/i.test(message) ? 'Cancelled' : message;
}
