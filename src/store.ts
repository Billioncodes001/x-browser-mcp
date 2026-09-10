import { mkdir, readFile, readdir, realpath, rename, writeFile, unlink, open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import { nameSchema } from './validation.js';
import type { Collection, RecordData } from './types.js';
import { previewReview, reviewedPacket, reviewedJson, reviewCsvRows, reviewOptionsSchema, REVIEW_SNAPSHOT_MAX_BYTES, REVIEW_CSV_MAX_BYTES, snapshotTooLarge, type ReviewOptions } from './review-export.js';
import { XBrowserError } from './errors.js';

export type Snapshot = { id: string; label?: string; data: Collection };
export type SavedSearch = { name: string; query: string; tab: 'latest' | 'top' | 'people' | 'photos' | 'videos'; limit: number; maxScrolls: number; lastSnapshotId?: string };
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validId(id: string) {
  if (!idPattern.test(id)) throw new Error('Invalid artifact ID');
  return id;
}
export function csvCell(value: unknown): string {
  let s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Spreadsheet applications can execute cells beginning with a formula prefix, including after whitespace.
  if (/^\s*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function toCsv(items: RecordData[], maxBytes = Infinity): string {
  const columns = items.length ? [...new Set(items.flatMap(v => Object.keys(v)))] : ['id'];
  const lines: string[] = [];
  let bytes = 0;
  const addRow = (values: unknown[]) => {
    const cells: string[] = [];
    let rowBytes = 2;
    for (const value of values) {
      const cell = csvCell(value);
      rowBytes += Buffer.byteLength(cell) + (cells.length ? 1 : 0);
      if (bytes + rowBytes > maxBytes)
        throw new XBrowserError('REVIEW_EXPORT_TOO_LARGE', `CSV exceeds the ${maxBytes}-byte output limit after repeating provenance. Select fewer records or use JSON. No export was written.`);
      cells.push(cell);
    }
    if (bytes + rowBytes > maxBytes)
      throw new XBrowserError('REVIEW_EXPORT_TOO_LARGE', `CSV exceeds the ${maxBytes}-byte output limit. No export was written.`);
    bytes += rowBytes;
    lines.push(cells.join(',') + '\r\n');
  };
  addRow(columns);
  for (const row of items) addRow(columns.map(c => row[c]));
  return lines.join('');
}
export function compareSnapshots(before: Snapshot, after: Snapshot) {
  if (before.data.kind !== after.data.kind || before.data.sourceUrl !== after.data.sourceUrl || before.data.sourceKey !== after.data.sourceKey) throw new Error('Compare snapshots of the same source, selected tab, and record kind');
  const old = new Map(before.data.items.map(v => [v.id, v]));
  const now = new Map(after.data.items.map(v => [v.id, v]));
  return {
    before: before.id, after: after.id,
    added: after.data.items.filter(v => !old.has(v.id)),
    changed: after.data.items.filter(v => old.has(v.id) && JSON.stringify(old.get(v.id)) !== JSON.stringify(v)).map(v => ({ id: v.id, before: old.get(v.id), after: v })),
    notObserved: before.data.items.filter(v => !now.has(v.id)),
    warning: 'Not observed means absent from this bounded sample, not deleted or unfollowed. Compare matching collection limits for more useful results.',
  };
}
export class ArtifactStore {
  constructor(readonly root: string) {}
  private async path(category: string, name: string): Promise<string> {
    if (!['snapshots', 'searches', 'exports', 'receipts'].includes(category) || !/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes('..')) throw new Error('Invalid storage path');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const root = await realpath(this.root);
    const directory = resolve(root, category);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const actualDirectory = await realpath(directory);
    const rel = relative(root, actualDirectory);
    if (rel.startsWith('..' + sep) || rel === '..' || resolve(root, rel) !== actualDirectory) throw new Error('Artifact directory escapes the data root');
    const path = resolve(actualDirectory, name);
    // Existing files may have been replaced with symlinks by another local process.
    try { if (await realpath(path) !== path) throw new Error('Refusing a linked artifact path'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return path;
  }
  private async put(category: string, name: string, data: unknown) {
    const path = await this.path(category, name);
    const temporary = await this.path(category, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
    return path;
  }
  async saveSnapshot(data: Collection, label?: string): Promise<Snapshot> {
    const snapshot: Snapshot = { id: randomUUID(), ...(label ? { label } : {}), data };
    await this.put('snapshots', `${snapshot.id}.json`, snapshot);
    return snapshot;
  }
  async snapshot(id: string): Promise<Snapshot> {
    return JSON.parse(await readFile(await this.path('snapshots', `${validId(id)}.json`), 'utf8'));
  }
  async listSnapshots(limit = 30) {
    const directory = resolve(await this.path('snapshots', 'probe'), '..');
    const results: Array<{ id: string; label?: string; kind: string; sourceUrl: string; capturedAt: string; count: number }> = [];
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.json') || !idPattern.test(file.slice(0,-5))) continue;
      const s = await this.snapshot(file.slice(0,-5));
      results.push({ id: s.id, label: s.label, kind: s.data.kind, sourceUrl: s.data.sourceUrl, capturedAt: s.data.capturedAt, count: s.data.items.length });
    }
    return results.sort((a,b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0,limit);
  }
  async saveSearch(search: SavedSearch) { await this.put('searches', `${nameSchema.parse(search.name)}.json`, search); return search; }
  async search(name: string): Promise<SavedSearch> { return JSON.parse(await readFile(await this.path('searches', `${nameSchema.parse(name)}.json`), 'utf8')); }
  async deleteSearch(name: string) { await unlink(await this.path('searches', `${nameSchema.parse(name)}.json`)); return { deleted: name }; }
  async listReceipts() {
    const directory = resolve(await this.path('receipts', 'probe'), '..');
    const records: Array<Record<string, unknown>> = [];
    for (const file of await readdir(directory)) if (file.endsWith('.json') && idPattern.test(file.slice(0,-5))) records.push(await this.receipt(file.slice(0,-5)) as Record<string, unknown>);
    return records.sort((a,b) => String(b.attemptedAt).localeCompare(String(a.attemptedAt))).slice(0,100);
  }
  async listSearches(): Promise<SavedSearch[]> {
    const directory = resolve(await this.path('searches', 'probe'), '..');
    const result: SavedSearch[] = [];
    for (const file of await readdir(directory)) if (file.endsWith('.json') && nameSchema.safeParse(file.slice(0,-5)).success) result.push(await this.search(file.slice(0,-5)));
    return result;
  }
  async receipt(id: string, data?: unknown) {
    if (data !== undefined) { await this.put('receipts', `${validId(id)}.json`, data); return data; }
    return JSON.parse(await readFile(await this.path('receipts', `${validId(id)}.json`), 'utf8')) as unknown;
  }
  async export(id: string, format: 'json' | 'csv' | 'md') {
    const snapshot = await this.snapshot(id);
    const path = await this.path('exports', `${id}-${randomUUID()}.${format}`);
    const md = (s: unknown) => String(s ?? '').replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
    const body = format === 'json' ? JSON.stringify(snapshot, null, 2) + '\n' : format === 'csv' ? toCsv(snapshot.data.items) : [
      '# X browser collection', '', `Source: ${md(snapshot.data.sourceUrl)}`, `Captured: ${snapshot.data.capturedAt}`, `Stop reason: ${snapshot.data.stopReason}`, '',
      ...snapshot.data.warnings.map(w => `> ${md(w)}`), '',
      ...snapshot.data.items.flatMap(item => [`## ${md(item.id)}`, '', md(item.text ?? JSON.stringify(item, null, 2)), '', md(item.url ?? ''), '']),
    ].join('\n');
    await writeFile(path, body, { mode: 0o600, flag: 'wx' });
    return { path, format, snapshotId: id, count: snapshot.data.items.length, bytes: Buffer.byteLength(body) };
  }
  async reviewPreview(id: string) {
    const path = await this.path('snapshots', `${validId(id)}.json`);
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    let bytes: Buffer;
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new XBrowserError('REVIEW_INVALID_FILE', 'The saved snapshot must be a regular file.');
      const named = await lstat(path);
      if (named.isSymbolicLink() || named.dev !== info.dev || named.ino !== info.ino || await realpath(path) !== path)
        throw new Error('Refusing a linked or replaced artifact path');
      if (info.size > REVIEW_SNAPSHOT_MAX_BYTES) throw snapshotTooLarge();
      const chunks: Buffer[] = [];
      let length = 0;
      // Stat is only an early rejection. The read budget also holds if the file grows.
      while (length <= REVIEW_SNAPSHOT_MAX_BYTES) {
        const chunk = Buffer.allocUnsafe(Math.min(65536, REVIEW_SNAPSHOT_MAX_BYTES + 1 - length));
        const { bytesRead } = await file.read(chunk, 0, chunk.length, length);
        if (!bytesRead) break;
        length += bytesRead;
        if (length > REVIEW_SNAPSHOT_MAX_BYTES) throw snapshotTooLarge();
        chunks.push(chunk.subarray(0, bytesRead));
      }
      bytes = Buffer.concat(chunks, length);
    } finally { await file.close(); }
    return previewReview(bytes, id);
  }
  async reviewedExport(id: string, input: ReviewOptions) {
    const options = reviewOptionsSchema.parse(input);
    const packet = reviewedPacket(await this.reviewPreview(id), options);
    const body = options.format === 'json' ? reviewedJson(packet) : toCsv(reviewCsvRows(packet), REVIEW_CSV_MAX_BYTES);
    const path = await this.path('exports', `${id}-reviewed-${randomUUID()}.${options.format}`);
    const temporary = await this.path('exports', `${randomUUID()}.tmp`);
    let created = false;
    try {
      const file = await open(temporary, 'wx', 0o600);
      created = true;
      try { await file.writeFile(body); } finally { await file.close(); }
      await rename(temporary, path);
    } catch (error) { if (created) await unlink(temporary).catch(() => undefined); throw error; }
    return { path, format: options.format, snapshotId: id, count: packet.records.length,
      bytes: Buffer.byteLength(body), sourceDigest: packet.provenance.snapshotDigest, warnings: packet.warnings };
  }
}
