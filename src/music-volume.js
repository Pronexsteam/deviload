export const DEFAULT_MUSIC_GAIN=.7;
// Keep stored/profile volume in the original amplitude domain. Changing the
// slider curve must not change the sound of existing preferences or backups.
export function musicGain(value,fallback=DEFAULT_MUSIC_GAIN){
  return typeof value==="number"&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):fallback;
}
export function gainFromVolumePosition(position){const value=musicGain(position,0);return value*value;}
export function volumePositionFromGain(gain){return Math.sqrt(musicGain(gain));}
export function volumePercent(gain){return Math.round(volumePositionFromGain(gain)*100);}
