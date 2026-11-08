const assertEquals=(actual:unknown,expected:unknown)=>{const a=JSON.stringify(actual),b=JSON.stringify(expected);if(a!==b)throw Error(`${a} !== ${b}`);};
import { clipFormat, CLIP_LIMIT } from './clip.ts';

const video = (itag: number, height: number, mime = 'video/mp4; codecs="avc1.4d401f"', size = 5_000_000) => ({ itag, height, mime_type: mime, has_video: true, has_audio: false, content_length: size });

Deno.test('a music video uses silent H.264 video near the wanted height', () => {
  const formats = [video(137, 1080), video(136, 720), video(135, 480), video(247, 720, 'video/webm; codecs="vp9"'), { ...video(18, 360), has_audio: true }, { itag: 140, mime_type: 'audio/mp4; codecs="mp4a.40.2"', has_audio: true, content_length: 3_000_000 }];
  assertEquals(clipFormat(formats, 720)?.itag, 136);
  assertEquals(clipFormat(formats, 600)?.itag, 135);
  assertEquals(clipFormat([video(137, 1080), video(136, 720)], 480)?.itag, 136);
  assertEquals(clipFormat([video(136, 720, undefined, CLIP_LIMIT + 1)], 720), undefined);
  assertEquals(clipFormat(formats.slice(3), 720), undefined);
});

import { clipHeights } from './clip.ts';
Deno.test('the quality list names each usable height once, tallest first', () => {
  const formats = [video(136, 720), video(298, 720), video(135, 480), video(137, 1080), video(247, 1440, 'video/webm; codecs="vp9"'), { ...video(18, 360), has_audio: true }];
  assertEquals(clipHeights(formats), [1080, 720, 480]);
});
