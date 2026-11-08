export class Ranges {
  private spans: [number, number][] = [];
  get total() { return this.spans.reduce((sum, [start, end]) => sum + end - start, 0); }
  add(start: number, end: number) {
    if (end <= start) return;
    const kept: [number, number][] = [];
    for (const [from, to] of this.spans) {
      if (to < start || from > end) kept.push([from, to]);
      else { start = Math.min(start, from); end = Math.max(end, to); }
    }
    kept.push([start, end]);
    this.spans = kept.sort((a, b) => a[0] - b[0]);
  }
  covers(start: number, end: number) { return end <= start || this.spans.some(([from, to]) => from <= start && to >= end); }
  overlaps(start: number, end: number): [number, number][] {
    return this.spans.filter(([from, to]) => from < end && to > start).map(([from, to]) => [Math.max(from, start), Math.min(to, end)]);
  }
  gap(from: number, size: number) {
    let at = from;
    for (const [start, end] of this.spans) { if (start > at) break; if (end > at) at = end; }
    return at < size ? at : undefined;
  }
}
