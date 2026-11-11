// The reserve source continues a song from the first byte still missing, never from the start.
// A slow connection is fine: a transfer is dropped only after it stops delivering for a while,
// and a dropped transfer resumes where it stopped. It gives up after a few attempts in a row
// that bring nothing new.
export const RESERVE_IDLE_MS = 20000, RESERVE_ATTEMPTS = 3, RESERVE_PAUSE_MS = 1000;
type Options = {
  size: number;
  next: () => number | undefined;
  open: (from: number, signal: AbortSignal) => Promise<Response>;
  place: (offset: number, bytes: Uint8Array) => Promise<unknown>;
  signal: AbortSignal;
  idleMs?: number;
  attempts?: number;
  pauseMs?: number;
  // Lets the listener move the transfer: jump() drops it, and the next one starts at next().
  onTransfer?: (transfer: Transfer | undefined) => void;
};
export type Transfer = { from: number; at: () => number; jump: () => void };
// A song whose continuation failed for a passing reason is tried again when the player asks for
// the missing audio, a few times per song, instead of failing every later request at once.
export const CONTINUATION_RETRIES = 3;
// The rest of a song is fetched once it has been playing for a while, or at once when someone seeks past its
// opening. A song skipped within seconds then costs YouTube only the small opening request. The opening
// holds about a minute of audio, far more than this delay plus the slowest continuation.
export const CONTINUE_AFTER_MS = 10000;
export function continueDelay(selectedAt: number, now: number, seek: boolean) {
  return seek ? 0 : Math.max(0, selectedAt + CONTINUE_AFTER_MS - now);
}
export function mayRetryContinuation(error: string, failures: number, video: boolean) {
  return !video && failures < CONTINUATION_RETRIES && !/cancel|unavailable or temporarily limited|differ|mismatch/i.test(error);
}
const differs = (error: unknown) => /differ|mismatch/.test(error instanceof Error ? error.message : String(error));
export async function continueFromReserve({ size, next, open, place, signal, idleMs = RESERVE_IDLE_MS, attempts = RESERVE_ATTEMPTS, pauseMs = RESERVE_PAUSE_MS, onTransfer }: Options) {
  let failures = 0;
  for (let from = next(); from !== undefined; from = next()) {
    if (signal.aborted) throw Error('Cancelled');
    const idle = new AbortController(), moved = new AbortController();
    let timer = setTimeout(() => idle.abort(), idleMs);
    const heard = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(), idleMs); };
    let offset = from;
    onTransfer?.({ from, at: () => offset, jump: () => moved.abort() });
    try {
      const response = await open(from, AbortSignal.any([signal, idle.signal, moved.signal]));
      // A relay error (502 while YouTube hiccups) is worth another attempt; a different recording is not.
      if (response.status !== 206) {
        await response.body?.cancel().catch(() => {});
        throw Error(`Reserve answered ${response.status}`);
      }
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (!range || Number(range[1]) !== from || Number(range[2]) !== size - 1 || Number(range[3]) !== size) {
        await response.body?.cancel().catch(() => {});
        throw Error('Reserve audio differs');
      }
      const reader = response.body!.getReader();
      let reached = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          heard();
          const added = await place(offset, value);
          offset += value.length;
          // Audio from here on is already on disk (after a jump); continue at the next hole instead.
          if (added === false) { reached = true; break; }
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!reached && offset !== size) throw Error('Incomplete audio stream');
    } catch (error) {
      if (signal.aborted) throw Error('Cancelled');
      // The listener moved elsewhere; that is not a failure of the reserve.
      if (moved.signal.aborted) { failures = 0; continue; }
      if (differs(error)) throw error;
      failures = offset > from ? 0 : failures + 1;
      if (failures >= attempts) throw error;
      if (offset === from) await new Promise(resolve => setTimeout(resolve, pauseMs));
    } finally { clearTimeout(timer); onTransfer?.(undefined); }
  }
}
