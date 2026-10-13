// Audio only: no signed URLs, cookies or account credentials are persisted.
export const CACHE_LIMIT = 200 * 1024 * 1024;
export const CACHE_LIMITS = [CACHE_LIMIT, 1024 * 1024 * 1024, 5 * 1024 * 1024 * 1024] as const;
export const validCacheLimit = (value: unknown): value is number => typeof value === 'number' && CACHE_LIMITS.some(limit => limit === value);
export const TRACK_LIMIT = 64 * 1024 * 1024;
export const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{11}$/.test(id);
export type Record = { id: string; file: string; size: number; at: number };
const validFile = (name: unknown): name is string => typeof name === 'string' && /^[a-f0-9-]{36}\.audio$/.test(name);
export async function readBytes(path: string, offset: number, length: number) {
  const file = await Deno.open(path, { read: true });
  try {
    await file.seek(offset, Deno.SeekMode.Start);
    const bytes = new Uint8Array(length); let count = 0;
    while (count < length) { const n = await file.read(bytes.subarray(count)); if (n === null) throw Error('Incomplete audio'); count += n; }
    return bytes;
  } finally { file.close(); }
}
export async function writeBytes(file: Deno.FsFile, bytes: Uint8Array) {
  let offset = 0; while (offset < bytes.length) offset += await file.write(bytes.subarray(offset));
}
export function same(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((byte, i) => byte === b[i]); }
export class AudioCache {
  entries: Record[] = [];
  epoch = 0;
  private saves = Promise.resolve();
  private settings = Promise.resolve();
  constructor(readonly root: string, public limit: number = CACHE_LIMIT) {}
  path(file: string) { if (!validFile(file)) throw Error('Invalid cache file'); return `${this.root}/${file}`; }
  async open() {
    await Deno.mkdir(this.root, { recursive: true });
    try {
      const stat = await Deno.stat(`${this.root}/config.json`);
      if (stat.size > 1024) throw Error('Invalid cache configuration');
      const config = JSON.parse(await Deno.readTextFile(`${this.root}/config.json`));
      if (validCacheLimit(config?.limit)) this.limit = config.limit;
    } catch { /* Missing or invalid settings use the default size. */ }
    try {
      const stat = await Deno.stat(`${this.root}/index.json`);
      if (stat.size > 16 * 1024 * 1024) throw Error('Invalid cache index');
      const items = JSON.parse(await Deno.readTextFile(`${this.root}/index.json`));
      if (!Array.isArray(items) || items.length > 65536) throw Error('Invalid cache index');
      for (const entry of items) {
        if (!validId(entry?.id) || !validFile(entry?.file) || !Number.isSafeInteger(entry?.size) || entry.size <= 0 || entry.size > TRACK_LIMIT || !Number.isFinite(entry.at)) continue;
        if (await Deno.stat(this.path(entry.file)).then(s => s.isFile && s.size === entry.size).catch(() => false)) this.entries.push(entry);
      }
    } catch { /* Missing or invalid indexes never expose partial files. */ }
    const retained = new Set(this.entries.map(e => e.file));
    for await (const entry of Deno.readDir(this.root)) if (entry.isFile && validFile(entry.name) && !retained.has(entry.name)) await Deno.remove(this.path(entry.name)).catch(() => {});
    await this.makeSpace(0); await this.save();
  }
  async find(id: string) {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;
    if (!await Deno.stat(this.path(entry.file)).then(s => s.size === entry.size).catch(() => false)) { this.entries = this.entries.filter(e => e !== entry); return; }
    entry.at = Date.now(); void this.save(); return entry;
  }
  async makeSpace(reserved: number, protectedFiles = new Set<string>()) {
    // Refuse before eviction if active audio alone cannot fit.
    if (this.entries.filter(e => protectedFiles.has(e.file)).reduce((n,e) => n+e.size,0)+reserved > this.limit) throw Error('Audio cache is busy');
    for (const entry of [...this.entries].sort((a,b) => a.at-b.at)) {
      if (this.entries.reduce((n,e) => n+e.size,0)+reserved <= this.limit) return;
      if (protectedFiles.has(entry.file)) continue;
      await Deno.remove(this.path(entry.file)).catch(() => {});
      this.entries = this.entries.filter(e => e !== entry);
    }
    if (this.entries.reduce((n,e) => n+e.size,0)+reserved > this.limit) throw Error('Audio cache is busy');
  }
  setLimit(limit: unknown, reserved = 0, protectedFiles = new Set<string>()) {
    const change = this.settings.catch(() => {}).then(async () => {
      if (!validCacheLimit(limit)) throw Error('Invalid audio cache limit');
      const previous = this.limit;
      this.limit = limit;
      try {
        await this.makeSpace(reserved, protectedFiles);
        await this.save();
        await Deno.writeTextFile(`${this.root}/config.tmp`, JSON.stringify({limit}));
        await Deno.rename(`${this.root}/config.tmp`, `${this.root}/config.json`);
      } catch (error) {
        this.limit = previous;
        await Deno.remove(`${this.root}/config.tmp`).catch(() => {});
        throw error;
      }
    });
    this.settings = change;
    return change;
  }
  async commit(entry: Record, epoch: number) {
    if (epoch !== this.epoch) return;
    for(const old of this.entries.filter(e=>e.id===entry.id&&e.file!==entry.file))await Deno.remove(this.path(old.file)).catch(()=>{});
    this.entries = this.entries.filter(e => e.id !== entry.id && e.file !== entry.file);
    this.entries.push(entry); await this.save();
  }
  async clear(protectedFiles = new Set<string>()) {
    this.epoch++;
    for (const entry of this.entries) if (!protectedFiles.has(entry.file)) await Deno.remove(this.path(entry.file)).catch(() => {});
    this.entries = []; await this.save();
  }
  save() {
    this.saves = this.saves.catch(() => {}).then(async () => {
      await Deno.writeTextFile(`${this.root}/index.tmp`, JSON.stringify(this.entries));
      await Deno.rename(`${this.root}/index.tmp`, `${this.root}/index.json`);
    }); return this.saves;
  }
}
export function byteRange(header: string | null, size: number): [number,number] {
  if (!header) return [0,size-1];
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw Error('Range');
  const start = match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size-1,Number(match[2])) : size-1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || end<start || start>=size) throw Error('Range');
  return [start,end];
}
