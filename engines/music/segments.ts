export type SegmentIndex = { starts: number[]; times: number[]; end: number };

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
  let first: number;
  if (version === 0) { if (at + 12 > end) return; first = view.getUint32(at + 4); at += 8; }
  else { if (at + 20 > end) return; first = Number(view.getBigUint64(at + 8)); at += 16; }
  const count = view.getUint16(at + 2);
  at += 4;
  if (!timescale || !count || at + count * 12 > end) return;
  const starts: number[] = [], times: number[] = [];
  let offset = end + first, ticks = 0;
  for (let i = 0; i < count; i++, at += 12) {
    const reference = view.getUint32(at);
    if (reference >>> 31) return;
    starts.push(offset); times.push(Math.round(ticks * 1000 / timescale));
    offset += reference & 0x7fffffff; ticks += view.getUint32(at + 4);
  }
  return { starts, times, end: offset };
}

export function segmentAt(index: SegmentIndex, offset: number) {
  let found = -1;
  for (let i = 0; i < index.starts.length && index.starts[i] <= offset; i++) found = i;
  return found;
}
