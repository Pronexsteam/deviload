import type { SabrStream, SabrStreamState } from 'googlevideo/sabr-stream';
import { UMPPartId, type MediaHeader } from 'googlevideo/protos';
import type { SegmentIndex } from './segments.ts';

type Format = { formatKey: string; formatInitializationMetadata: any };
export type Snapshot = {
  durationMs: number; requestNumber: number; formatToDiscard?: string; nextRequestPolicy?: unknown;
  activeSabrContexts: number[]; sabrContextUpdates: [number, unknown][]; formats: Format[];
};

export function onSegment(sabr: SabrStream, listener: (header: MediaHeader, bytes: Uint8Array) => void) {
  const inner = sabr as any, handlers: Map<number, (part: any) => void> = inner.umpPartHandlers, end = handlers?.get(UMPPartId.MEDIA_END);
  if (!end || !(inner.partialSegmentQueue instanceof Map)) throw Error('Unsupported audio stream');
  handlers.set(UMPPartId.MEDIA_END, part => {
    const segment = inner.partialSegmentQueue.get(part.data.getUint8(0));
    const chunks: Uint8Array[] = segment ? [...segment.bufferedChunks] : [];
    end(part);
    if (!segment) return;
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (length !== Number(segment.mediaHeader.contentLength || 0)) return;
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    listener(segment.mediaHeader, bytes);
  });
}

export function snapshot(sabr: SabrStream): Snapshot | undefined {
  const inner = sabr as any;
  if (!(inner.initializedFormatsMap instanceof Map) || !inner.durationMs) return;
  const formats = [...inner.initializedFormatsMap].map(([formatKey, format]: [string, any]) => ({ formatKey, formatInitializationMetadata: format.formatInitializationMetadata }));
  if (!formats.length) return;
  return {
    durationMs: inner.durationMs, requestNumber: inner.requestNumber || 0, formatToDiscard: inner.formatToDiscard, nextRequestPolicy: inner.nextRequestPolicy,
    activeSabrContexts: [...(inner.activeSabrContextTypes || [])], sabrContextUpdates: [...(inner.sabrContexts || [])], formats,
  };
}

export function resumeState(base: Snapshot, index: SegmentIndex, segment: number, itag = 140): SabrStreamState | undefined {
  const playerTimeMs = index.times[segment];
  const audio = base.formats.find(format => format.formatInitializationMetadata?.formatId?.itag === itag);
  if (!audio || !playerTimeMs || segment < 1 || segment >= index.times.length) return;
  const downloaded: [number, unknown][] = [[0, { segmentNumber: 0, durationMs: '0' }]];
  for (let n = 1; n <= segment; n++) downloaded.push([n, { segmentNumber: n, durationMs: String(index.times[n] - index.times[n - 1]) }]);
  const formats = [...base.formats];
  // The discarded video format never initializes, yet a restored session must name it.
  const discarded = base.formatToDiscard;
  if (discarded && !formats.some(format => format.formatKey === discarded)) {
    const [itag, xtags] = discarded.split(/:(.*)/s);
    formats.push({ formatKey: discarded, formatInitializationMetadata: { formatId: { itag: Number(itag), ...(xtags ? { xtags } : {}) } } });
  }
  return {
    durationMs: base.durationMs, requestNumber: base.requestNumber, formatToDiscard: base.formatToDiscard, nextRequestPolicy: base.nextRequestPolicy,
    activeSabrContexts: base.activeSabrContexts, sabrContextUpdates: base.sabrContextUpdates, cachedBufferedRanges: [], playerTimeMs,
    initializedFormats: formats.map(format => format === audio
      ? { ...format, downloadedSegments: downloaded, lastMediaHeaders: [] }
      : { ...format, downloadedSegments: [], lastMediaHeaders: [] }),
  } as SabrStreamState;
}
