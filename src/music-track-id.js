// Local identifiers name indexed content, never a filesystem path or remote URL.
export const isLocalMusicId=id=>typeof id==='string'&&/^local:[a-f0-9]{64}$/.test(id);
export const isMusicTrackId=id=>typeof id==='string'&&(/^[\w-]{11}$/.test(id)||isLocalMusicId(id));
export const localArtworkUrl=raw=>typeof raw==='string'&&/^music-art:\/\/localhost\/[a-f0-9]{64}\.jpg$/.test(raw);
