export const exportPresets = Object.freeze({
  video:{format:'mp4',quality:'1080',codec:'h264'},
  small:{format:'mp4',quality:'720',codec:'h264'},
  audio:{format:'mp3',quality:'0',codec:'h264'},
  gif:{format:'gif',quality:'480',codec:'h264'},
});

export function trimBounds(start, end, duration) {
  if (![start,end,duration].every(Number.isFinite) || start < 0 || end > duration || end - start < 0.1 - 1e-9) {
    throw Error('Keep at least 0.1 seconds within the source duration.');
  }
  return {start,end};
}
