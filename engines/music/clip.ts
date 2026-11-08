export const CLIP_LIMIT = 160 * 1024 * 1024;

type VideoFormat = { itag: number; mime_type: string; has_video?: boolean; has_audio?: boolean; height?: number; content_length?: number | string; is_drc?: boolean };

// H.264 video without sound, the tallest not above the wanted height, or else the smallest there is.
export function clipFormat<T extends VideoFormat>(formats: T[], height: number): T | undefined {
  const usable = formats.filter(f => f.has_video && !f.has_audio && !f.is_drc && /^video\/mp4;.*avc1/.test(f.mime_type) && Number(f.height) > 0 && Number(f.content_length) > 0 && Number(f.content_length) <= CLIP_LIMIT);
  const fit = usable.filter(f => Number(f.height) <= height).sort((a, b) => Number(b.height) - Number(a.height));
  return fit[0] ?? usable.sort((a, b) => Number(a.height) - Number(b.height))[0];
}

// The heights a listener can choose between, tallest first.
export function clipHeights<T extends VideoFormat>(formats: T[]): number[] {
  const usable = formats.filter(f => clipFormat([f], 100000) === f).map(f => Number(f.height));
  return [...new Set(usable)].sort((a, b) => b - a);
}
