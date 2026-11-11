// starts: byte offset of each segment; times: its start in ms; ticks: its decode time as written in the
// fragment (tfdt), which is how a fragment received from anywhere is matched to its place in the file.
export type SegmentIndex = { starts: number[]; times: number[]; ticks: number[]; end: number };

export function segmentIndex(bytes: Uint8Array): SegmentIndex | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at + 8 <= bytes.length) {
    let size = view.getUint32(at), header = 8;
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (size === 1) {
      if (at + 16 > bytes.length) return;
      size = Number(view.getBigUint64(at + 8)); header = 16;
    }
    if (size < header) return;
    if (type === 'sidx') return at + size <= bytes.length ? references(view, at + header, at + size) : undefined;
    at += size;
  }
}

function references(view: DataView, at: number, end: number): SegmentIndex | undefined {
  if (at + 12 > end) return;
  const version = view.getUint8(at), timescale = view.getUint32(at + 8);
  at += 12;
  let first: number, earliest: number;
  if (version === 0) { if (at + 12 > end) return; earliest = view.getUint32(at); first = view.getUint32(at + 4); at += 8; }
  else { if (at + 20 > end) return; earliest = Number(view.getBigUint64(at)); first = Number(view.getBigUint64(at + 8)); at += 16; }
  const count = view.getUint16(at + 2);
  at += 4;
  if (!timescale || !count || at + count * 12 > end) return;
  const starts: number[] = [], times: number[] = [], decode: number[] = [];
  let offset = end + first, ticks = 0;
  for (let i = 0; i < count; i++, at += 12) {
    const reference = view.getUint32(at);
    if (reference >>> 31) return;
    starts.push(offset); times.push(ticks * 1000 / timescale); decode.push(earliest + ticks);
    offset += reference & 0x7fffffff; ticks += view.getUint32(at + 4);
  }
  return { starts, times, ticks: decode, end: offset };
}

// A SABR session for the first missing byte starts at the segment that holds it. Its output is the
// initialization segment followed by the media from that segment on; without an index it starts at 0.
export type SessionStart = { startTimeMs: number; begin: number; init: number };
export function sessionStart(index: SegmentIndex | undefined, from: number): SessionStart {
  const segment = index ? segmentAt(index, from) : -1;
  return segment > 0 ? { startTimeMs: Math.ceil(index!.times[segment]), begin: index!.starts[segment], init: index!.starts[0] } : { startTimeMs: 0, begin: 0, init: 0 };
}
// Places SABR output by what it contains, never by what was asked for. The output is the initialization
// segment, then whole fragments (moof + mdat). Each fragment carries its decode time (tfdt), which names its
// segment, so bytes land where they belong even when the server starts elsewhere than requested (it sends
// the song from the start while its token check is pending). Without an index the output is the file itself.
export class SegmentPlacer {
  private at = 0;
  private left: number;
  private head = new Uint8Array(0);
  constructor(private readonly index?: SegmentIndex) { this.left = index ? index.starts[0] : Infinity; }
  push(bytes: Uint8Array): [number, Uint8Array][] {
    const parts: [number, Uint8Array][] = [];
    while (bytes.length) {
      if (this.left > 0) {
        const take = bytes.subarray(0, Math.min(bytes.length, this.left));
        parts.push([this.at, take]);
        this.at += take.length; this.left -= take.length; bytes = bytes.subarray(take.length);
        continue;
      }
      // At a fragment boundary: gather its whole moof box to learn which segment follows.
      const joined = new Uint8Array(this.head.length + bytes.length);
      joined.set(this.head); joined.set(bytes, this.head.length);
      if (joined.length < 8) { this.head = joined; return parts; }
      const size = new DataView(joined.buffer, joined.byteOffset).getUint32(0);
      if (boxType(joined, 0) !== 'moof' || size < 16 || size > 1048576) throw Error('Audio streams differ');
      if (joined.length < size) { this.head = joined; return parts; }
      const segment = this.index!.ticks.indexOf(fragmentTime(joined.subarray(0, size)));
      if (segment < 0) throw Error('Audio streams differ');
      this.at = this.index!.starts[segment];
      this.left = (this.index!.starts[segment + 1] ?? this.index!.end) - this.at;
      this.head = new Uint8Array(0);
      bytes = joined;
    }
    return parts;
  }
}
const boxType = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at + 4, at + 8));
// The tfdt decode time inside moof > traf, or -1.
function fragmentTime(moof: Uint8Array) {
  const view = new DataView(moof.buffer, moof.byteOffset, moof.byteLength);
  for (let at = 8; at + 8 <= moof.length;) {
    const size = view.getUint32(at);
    if (size < 8 || at + size > moof.length) return -1;
    if (boxType(moof, at) === 'traf')
      for (let inner = at + 8; inner + 8 <= at + size;) {
        const length = view.getUint32(inner);
        if (length < 8) return -1;
        if (boxType(moof, inner) === 'tfdt' && inner + 16 <= at + size)
          return view.getUint8(inner + 8) === 1 ? (inner + 20 <= at + size ? Number(view.getBigUint64(inner + 12)) : -1) : view.getUint32(inner + 12);
        inner += length;
      }
    at += size;
  }
  return -1;
}

export function segmentAt(index: SegmentIndex, offset: number) {
  let found = -1;
  for (let i = 0; i < index.starts.length && index.starts[i] <= offset; i++) found = i;
  return found;
}
