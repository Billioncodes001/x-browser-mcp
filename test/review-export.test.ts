import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, symlink, mkdir, rm, open, appendFile, rename } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ArtifactStore, csvCell, toCsv } from '../dist/store.js';
import { previewReview, reviewedPacket, reviewedJson, reviewCsvRows, reviewOptionsSchema, REVIEW_SNAPSHOT_MAX_BYTES, REVIEW_CSV_MAX_BYTES, REVIEW_JSON_MAX_BYTES, REVIEW_MAX_DEPTH } from '../dist/review-export.js';
import { sample, tempConfig } from './helpers.js';

const a = { id: 'synthetic-1', text: 'Synthetic evidence, not a live observation.', url: 'https://x.com/fixture/status/501', metrics: { likes: 'unknown' } };
const b = { id: 'synthetic-2', text: 'Excluded synthetic observation.', url: 'https://x.com/fixture/status/502' };
const collection = () => ({ ...sample([a, a, b]), capturedAt: '2026-09-09T12:00:00Z', sourceKey: 'search:latest:synthetic', requestedLimit: 40, maxScrolls: 8, stopReason: 'blocked' as const, warnings: ['Synthetic checkpoint; no live session.'] });
const options = (digest: string) => ({ snapshotDigest: digest, recordIds: [a.id], note: 'Selected the first synthetic observation for manual review.', acknowledgedPartial: true as const, format: 'json' as const });
async function fixture() {
  const f = await tempConfig();
  const store = new ArtifactStore(f.config.dataDir);
  const snapshot = await store.saveSnapshot(collection(), 'Synthetic reviewed handoff');
  const path = resolve(store.root, 'snapshots', snapshot.id + '.json');
  return { ...f, store, snapshot, path };
}

test('reviewed handoff preserves selected evidence and source bytes with explicit duplicate and exclusion accounting', async () => {
  const f = await fixture(); try {
    const bytes = await readFile(f.path);
    const p = await f.store.reviewPreview(f.snapshot.id);
    assert.equal(p.snapshotDigest, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual([p.rawCount, p.uniqueCount, p.duplicateCopies], [3, 2, 1]);
    assert.deepEqual(p.records[0], { record: a, originalIndices: [0, 1] });
    const result = await f.store.reviewedExport(f.snapshot.id, options(p.snapshotDigest));
    const packet = JSON.parse(await readFile(result.path, 'utf8'));
    assert.equal(packet.schema, 'x-browser-reviewed-export/v1');
    assert.deepEqual(packet.records, [{ record: a, originalIndices: [0, 1] }]);
    assert.equal(packet.selection.selectedCount, 1);
    assert.equal(packet.selection.excludedUniqueCount, 1);
    assert.equal(packet.provenance.complete, false);
    assert.equal(packet.provenance.sourceKey, collection().sourceKey);
    assert.equal(packet.provenance.capturedAt, collection().capturedAt);
    assert.equal(packet.review.acknowledgedPartial, true);
    assert.ok(Number.isFinite(Date.parse(packet.review.reviewedAt)));
    assert.match(packet.warnings.join(' '), /Synthetic checkpoint.*partial browser sample.*not fact-checking.*Collection was blocked/);
    assert.deepEqual(await readFile(f.path), bytes);
    assert.equal(result.bytes, (await readFile(result.path)).length);
    assert.deepEqual(await new ArtifactStore(f.store.root).reviewPreview(f.snapshot.id), p);
    const raw = await f.store.export(f.snapshot.id, 'json');
    assert.deepEqual(JSON.parse(await readFile(raw.path, 'utf8')), f.snapshot);
    assert.equal((await readdir(resolve(f.store.root, 'exports'))).some(name => name.endsWith('.tmp')), false);
  } finally { await f.cleanup(); }
});

test('selection uses original capture order, not client order; exact duplicates ignore object key order', () => {
  const id = randomUUID();
  const raw = Buffer.from(JSON.stringify({ id, data: { ...collection(), items: [a, { url: a.url, metrics: { likes: 'unknown' }, text: a.text, id: a.id }, b] } }));
  const preview = previewReview(raw, id);
  const packet = reviewedPacket(preview, { ...options(preview.snapshotDigest), recordIds: [b.id, a.id] });
  assert.deepEqual(packet.records.map(r => r.record.id), [a.id, b.id]);
  assert.equal(packet.selection.duplicateCopies, 1);
});

test('conflicting duplicate IDs fail closed without writing an export or changing the source', async () => {
  const f = await fixture(); try {
    const snapshot = await f.store.saveSnapshot({ ...collection(), items: [a, { ...a, text: 'Conflicting copy' }] });
    await assert.rejects(f.store.reviewPreview(snapshot.id), { code: 'CONFLICTING_DUPLICATE' });
    await assert.rejects(f.store.reviewedExport(snapshot.id, options('0'.repeat(64))), { code: 'CONFLICTING_DUPLICATE' });
    assert.deepEqual((await f.store.snapshot(snapshot.id)).data.items, [a, { ...a, text: 'Conflicting copy' }]);
    await assert.rejects(readdir(resolve(f.store.root, 'exports')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('stale fingerprints reject even whitespace-only source edits; fresh previews recover', async () => {
  const f = await fixture(); try {
    const p = await f.store.reviewPreview(f.snapshot.id);
    await writeFile(f.path, (await readFile(f.path, 'utf8')) + '\n');
    await assert.rejects(f.store.reviewedExport(f.snapshot.id, options(p.snapshotDigest)), { code: 'REVIEW_STALE' });
    await assert.rejects(readdir(resolve(f.store.root, 'exports')), { code: 'ENOENT' });
    const fresh = await f.store.reviewPreview(f.snapshot.id);
    assert.notEqual(fresh.snapshotDigest, p.snapshotDigest);
    assert.equal((await f.store.reviewedExport(f.snapshot.id, options(fresh.snapshotDigest))).count, 1);
  } finally { await f.cleanup(); }
});

test('review requires a nonempty unique bounded selection, explicit partial acknowledgement and useful note', () => {
  const valid = options('a'.repeat(64));
  for (const change of [
    { recordIds: [] }, { recordIds: [a.id, a.id] }, { recordIds: Array.from({ length: 201 }, (_, i) => String(i)) },
    { recordIds: ['x'.repeat(501)] }, { note: '   short   ' }, { note: 'x'.repeat(2001) },
    { acknowledgedPartial: false }, { acknowledgedPartial: undefined }, { snapshotDigest: '../snapshot' },
    { format: 'md' }, { unexpected: true },
  ]) assert.equal(reviewOptionsSchema.safeParse({ ...valid, ...change }).success, false, JSON.stringify(change));
  assert.equal(reviewOptionsSchema.parse({ ...valid, note: '  a useful synthetic selection note  ' }).note, 'a useful synthetic selection note');
});

test('unknown IDs and empty snapshots never create a reviewed export', async () => {
  const f = await fixture(); try {
    const p = await f.store.reviewPreview(f.snapshot.id);
    await assert.rejects(f.store.reviewedExport(f.snapshot.id, { ...options(p.snapshotDigest), recordIds: ['not-saved'] }), { code: 'UNKNOWN_RECORD' });
    const empty = await f.store.saveSnapshot({ ...collection(), items: [], stopReason: 'empty' });
    const preview = await f.store.reviewPreview(empty.id);
    assert.equal(preview.uniqueCount, 0);
    assert.match(preview.warnings.join(' '), /No records are available/);
    await assert.rejects(f.store.reviewedExport(empty.id, options(preview.snapshotDigest)), { code: 'UNKNOWN_RECORD' });
    await assert.rejects(readdir(resolve(f.store.root, 'exports')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('every collection stop reason remains partial and appears in JSON and every CSV row', () => {
  for (const stopReason of ['limit', 'scroll_limit', 'time_limit', 'no_new_items', 'empty', 'blocked']) {
    const id = randomUUID();
    const p = previewReview(Buffer.from(JSON.stringify({ id, data: { ...collection(), stopReason } })), id);
    const packet = reviewedPacket(p, { ...options(p.snapshotDigest), recordIds: [a.id, b.id] });
    assert.equal(packet.provenance.stopReason, stopReason);
    assert.equal(packet.provenance.complete, false);
    for (const row of reviewCsvRows(packet)) {
      assert.equal(row.stop_reason, stopReason);
      assert.equal(row.complete, false);
      assert.equal(row.snapshot_sha256, p.snapshotDigest);
      assert.equal(row.snapshot_label, packet.provenance.label);
      assert.equal(row.digest_scope, packet.provenance.digestScope);
      assert.deepEqual(row.warnings, packet.warnings);
      assert.equal(row.requested_limit, 40);
      assert.equal(row.max_scrolls, 8);
      assert.deepEqual(row.selection, packet.selection);
      assert.equal(row.review_note, packet.review.note);
    }
  }
});

test('reviewed CSV safely carries nested evidence, quoted newlines and formula-like notes without excluded content', async () => {
  const f = await fixture(); try {
    const p = await f.store.reviewPreview(f.snapshot.id);
    const note = '=SUM(1,2) is synthetic, "quoted"\nand must stay text.';
    const result = await f.store.reviewedExport(f.snapshot.id, { ...options(p.snapshotDigest), note, format: 'csv' });
    const csv = await readFile(result.path, 'utf8');
    assert.ok(csv.includes(csvCell(note)));
    assert.ok(csv.includes(csvCell(a)));
    assert.ok(csv.includes(csvCell([0, 1])));
    assert.match(csv, /"snapshot_sha256"/);
    assert.match(csv, /"acknowledged_partial"/);
    assert.match(csv, /"'\=SUM/);
    assert.equal(csv.includes(b.text), false);
  } finally { await f.cleanup(); }
});

test('missing legacy bounds and individual URL stay unknown; no citation or capture date is invented', () => {
  const id = randomUUID();
  const p = previewReview(Buffer.from(JSON.stringify({ id, data: { ...sample([]), items: [{ id: 'legacy' }] } })), id);
  assert.equal(p.source.requestedLimit, null);
  assert.equal(p.source.maxScrolls, null);
  assert.equal(p.source.sourceKey, null);
  assert.match(p.warnings.join(' '), /no captured HTTP\(S\) record URL/);
  const packet = reviewedPacket(p, { ...options(p.snapshotDigest), recordIds: ['legacy'] });
  assert.deepEqual(packet.records[0].record, { id: 'legacy' });
  assert.equal(reviewCsvRows(packet)[0].record_url, null);
});

test('malformed, over-bound and mismatched snapshots are rejected rather than certified', () => {
  const id = randomUUID();
  assert.throws(() => previewReview(Buffer.alloc(8 * 1024 * 1024 + 1), id), { code: 'REVIEW_TOO_LARGE' });
  assert.throws(() => previewReview(Buffer.from('{'), id));
  assert.throws(() => previewReview(Buffer.concat([Buffer.from('{"invalid":"'), Buffer.from([0xff]), Buffer.from('"}')]), id), /encoded data/);
  assert.throws(() => previewReview(Buffer.from(JSON.stringify({ id: randomUUID(), data: collection() })), id), { code: 'SNAPSHOT_MISMATCH' });
  for (const change of [{ capturedAt: 'unknown' }, { complete: true }, { requestedLimit: 201 }, { maxScrolls: 31 }, { items: Array.from({ length: 201 }, () => a) }, { warnings: ['w'.repeat(4001)] }]) {
    assert.throws(() => previewReview(Buffer.from(JSON.stringify({ id, data: { ...collection(), ...change } })), id));
  }
});

test('review exports preserve local path boundaries and refuse linked snapshot or export paths', async () => {
  const f = await fixture(); try {
    const p = await f.store.reviewPreview(f.snapshot.id);
    await assert.rejects(f.store.reviewPreview('../private'));
    const outside = resolve(f.store.root, '..', 'outside-' + randomUUID());
    await mkdir(outside);
    try {
      await symlink(outside, resolve(f.store.root, 'exports'), process.platform === 'win32' ? 'junction' : 'dir');
      await assert.rejects(f.store.reviewedExport(f.snapshot.id, options(p.snapshotDigest)), /escapes the data root/);
      assert.deepEqual(await readdir(outside), []);
      const linkedId = randomUUID();
      await symlink(process.platform === 'win32' ? outside : f.path, resolve(f.store.root, 'snapshots', linkedId + '.json'), process.platform === 'win32' ? 'junction' : 'file');
      await assert.rejects(f.store.reviewPreview(linkedId), /linked artifact/);
    } finally { await rm(outside, { recursive: true, force: true }); }
    await rm(f.path);
    await assert.rejects(f.store.reviewedExport(f.snapshot.id, options(p.snapshotDigest)), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('store review preserves inert prototype-looking fields in JSON and CSV and deduplicates original values', async () => {
  const f = await fixture(); try {
    const record = JSON.parse('{"id":"inert","__proto__":{"observed":"keep me"},"constructor":{"prototype":"also data"},"nested":{"__proto__":"nested data"}}');
    const reordered = JSON.parse('{"nested":{"__proto__":"nested data"},"constructor":{"prototype":"also data"},"__proto__":{"observed":"keep me"},"id":"inert"}');
    const snapshot = await f.store.saveSnapshot({ ...collection(), items: [record, reordered] });
    const source = resolve(f.store.root, 'snapshots', snapshot.id + '.json');
    const original = await readFile(source);
    const preview = await f.store.reviewPreview(snapshot.id);
    assert.equal(preview.duplicateCopies, 1);
    assert.deepEqual(preview.records, [{ record, originalIndices: [0, 1] }]);
    assert.equal(Object.getPrototypeOf(preview.records[0].record), Object.prototype);
    assert.equal(Object.hasOwn(preview.records[0].record, '__proto__'), true);
    assert.equal(Object.hasOwn(Object.prototype, 'observed'), false);
    const input = { ...options(preview.snapshotDigest), recordIds: ['inert'] };
    const json = await f.store.reviewedExport(snapshot.id, input);
    assert.deepEqual(JSON.parse(await readFile(json.path, 'utf8')).records[0].record, record);
    const csv = await f.store.reviewedExport(snapshot.id, { ...input, format: 'csv' });
    assert.ok((await readFile(csv.path, 'utf8')).includes(csvCell(record)));
    assert.deepEqual(await readFile(source), original);
    assert.equal(Object.hasOwn(Object.prototype, 'observed'), false);
  } finally { await f.cleanup(); }
});

test('store refuses duplicates differing only in an own __proto__ field, with no source or export changes', async () => {
  const f = await fixture(); try {
    const records = ['first', 'second'].map(value => JSON.parse(`{"id":"inert","__proto__":{"observed":"${value}"}}`));
    const snapshot = await f.store.saveSnapshot({ ...collection(), items: records });
    const source = resolve(f.store.root, 'snapshots', snapshot.id + '.json');
    const before = await readFile(source);
    await assert.rejects(f.store.reviewPreview(snapshot.id), { code: 'CONFLICTING_DUPLICATE' });
    await assert.rejects(f.store.reviewedExport(snapshot.id, options(createHash('sha256').update(before).digest('hex'))), { code: 'CONFLICTING_DUPLICATE' });
    assert.deepEqual(await readFile(source), before);
    await assert.rejects(readdir(resolve(f.store.root, 'exports')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('actual store path accepts exactly 8 MiB and rejects larger files before exporting', async () => {
  const f = await fixture(); try {
    const source = await readFile(f.path);
    const atLimit = Buffer.concat([source, Buffer.alloc(REVIEW_SNAPSHOT_MAX_BYTES - source.length, 32)]);
    await writeFile(f.path, atLimit);
    const preview = await f.store.reviewPreview(f.snapshot.id);
    assert.equal(preview.snapshotDigest, createHash('sha256').update(atLimit).digest('hex'));
    await appendFile(f.path, ' ');
    for (const operation of [() => f.store.reviewPreview(f.snapshot.id), () => f.store.reviewedExport(f.snapshot.id, options(preview.snapshotDigest))])
      await assert.rejects(operation(), { code: 'REVIEW_TOO_LARGE' });
    assert.deepEqual(await readFile(f.path), Buffer.concat([atLimit, Buffer.from(' ')]));
    await assert.rejects(readdir(resolve(f.store.root, 'exports')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('store read budget remains limit-plus-one if the file grows after stat, and closes the handle', async (t) => {
  const f = await fixture(); try {
    const source = await readFile(f.path);
    const atLimit = Buffer.concat([source, Buffer.alloc(REVIEW_SNAPSHOT_MAX_BYTES - source.length, 32)]);
    await writeFile(f.path, atLimit);
    const probe = await open(f.path, 'r');
    const prototype = Object.getPrototypeOf(probe);
    const read = prototype.read;
    await probe.close();
    let handle: FileHandle | undefined;
    let total = 0;
    const intercepted = t.mock.method(prototype, 'read', async function(this: FileHandle, ...args: unknown[]) {
      if (!handle) { handle = this; await appendFile(f.path, ' '.repeat(200000)); }
      const result = await read.apply(this, args);
      total += result.bytesRead;
      return result;
    });
    await assert.rejects(f.store.reviewedExport(f.snapshot.id, options('0'.repeat(64))), { code: 'REVIEW_TOO_LARGE' });
    intercepted.mock.restore();
    assert.equal(total, REVIEW_SNAPSHOT_MAX_BYTES + 1);
    assert.ok(handle);
    await assert.rejects(handle.stat(), { code: 'EBADF' });
    assert.deepEqual(await readFile(f.path), Buffer.concat([atLimit, Buffer.alloc(200000, 32)]));
    await assert.rejects(readdir(resolve(f.store.root, 'exports')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('failed snapshot reads close their handle and preserve source and previous exports', async (t) => {
  const f = await fixture(); try {
    const preview = await f.store.reviewPreview(f.snapshot.id);
    const prior = await f.store.reviewedExport(f.snapshot.id, options(preview.snapshotDigest));
    const priorBytes = await readFile(prior.path), source = await readFile(f.path);
    const probe = await open(f.path, 'r'), prototype = Object.getPrototypeOf(probe);
    await probe.close();
    let handle: FileHandle | undefined;
    const intercepted = t.mock.method(prototype, 'read', async function(this: FileHandle) {
      handle = this;
      throw Object.assign(new Error('Synthetic read failure'), { code: 'EIO' });
    });
    await assert.rejects(f.store.reviewedExport(f.snapshot.id, options(preview.snapshotDigest)), { code: 'EIO' });
    intercepted.mock.restore();
    assert.ok(handle);
    await assert.rejects(handle.stat(), { code: 'EBADF' });
    assert.deepEqual(await readFile(f.path), source);
    assert.deepEqual(await readFile(prior.path), priorBytes);
    assert.equal((await readdir(resolve(f.store.root, 'exports'))).length, 1);
  } finally { await f.cleanup(); }
});

test('a snapshot swapped for a link after open is refused and its handle is closed', async (t) => {
  const f = await fixture(); try {
    const source = await readFile(f.path);
    const outsideDirectory = resolve(f.store.root, 'unrelated-fixture');
    await mkdir(outsideDirectory);
    const outside = resolve(outsideDirectory, 'unrelated.json');
    await writeFile(outside, 'unrelated fixture; never imported');
    const probe = await open(f.path, 'r'), prototype = Object.getPrototypeOf(probe), stat = prototype.stat;
    await probe.close();
    let handle: FileHandle | undefined;
    const intercepted = t.mock.method(prototype, 'stat', async function(this: FileHandle, ...args: unknown[]) {
      const info = await stat.apply(this, args);
      if (!handle) {
        handle = this;
        await rename(f.path, f.path + '.original');
        await symlink(process.platform === 'win32' ? outsideDirectory : outside, f.path, process.platform === 'win32' ? 'junction' : 'file');
      }
      return info;
    });
    await assert.rejects(f.store.reviewPreview(f.snapshot.id), /linked or replaced/);
    intercepted.mock.restore();
    assert.ok(handle);
    await assert.rejects(handle.stat(), { code: 'EBADF' });
    assert.deepEqual(await readFile(f.path + '.original'), source);
    assert.equal(await readFile(outside, 'utf8'), 'unrelated fixture; never imported');
  } finally { await f.cleanup(); }
});

test('CSV budget counts actual UTF-8, quoting, formula prefixes, separators and record endings', () => {
  const rows = [{ id: 'quoted', note: '=1,"two"\r\n\u00e9\ud83d\ude00' }, { id: 'empty', note: '' }];
  const original = toCsv(rows), bytes = Buffer.byteLength(original);
  assert.equal(toCsv(rows, bytes), original);
  assert.throws(() => toCsv(rows, bytes - 1), { code: 'REVIEW_EXPORT_TOO_LARGE' });
  assert.equal(toCsv([], 6), '"id"\r\n');
  assert.throws(() => toCsv([], 5), { code: 'REVIEW_EXPORT_TOO_LARGE' });
});

test('large-label CSV amplification is refused before writing; JSON and smaller selections preserve originals', async () => {
  const f = await fixture(); try {
    const label = 'L'.repeat(3 * 1024 * 1024);
    const snapshot = await f.store.saveSnapshot({ ...collection(), items: Array.from({ length: 200 }, (_, i) => ({ id: `bounded-${i}`, text: 'Synthetic bounded fixture' })) }, label);
    const source = resolve(f.store.root, 'snapshots', snapshot.id + '.json'), before = await readFile(source);
    assert.ok(before.length < REVIEW_SNAPSHOT_MAX_BYTES);
    const preview = await f.store.reviewPreview(snapshot.id);
    assert.equal(preview.label, label);
    const input = { ...options(preview.snapshotDigest), recordIds: preview.records.map(r => r.record.id) };
    await assert.rejects(f.store.reviewedExport(snapshot.id, { ...input, format: 'csv' }), { code: 'REVIEW_EXPORT_TOO_LARGE' });
    await assert.rejects(readdir(resolve(f.store.root, 'exports')), { code: 'ENOENT' });
    assert.deepEqual(await readFile(source), before);
    const json = await f.store.reviewedExport(snapshot.id, input);
    assert.equal(JSON.parse(await readFile(json.path, 'utf8')).provenance.label, label);
    const csv = await f.store.reviewedExport(snapshot.id, { ...input, recordIds: ['bounded-0'], format: 'csv' });
    assert.ok(csv.bytes < REVIEW_CSV_MAX_BYTES);
    assert.ok((await readFile(csv.path, 'utf8')).includes(csvCell(label)));
    assert.deepEqual(await readFile(source), before);
  } finally { await f.cleanup(); }
});

test('warning amplification also respects CSV limit without truncating evidence or leaving temporary exports', async () => {
  const f = await fixture(); try {
    const warnings = Array.from({ length: 100 }, (_, i) => `${i}:` + 'warning'.repeat(570));
    const snapshot = await f.store.saveSnapshot({ ...collection(), warnings, items: Array.from({ length: 200 }, (_, i) => ({ id: `warning-${i}` })) });
    const source = resolve(f.store.root, 'snapshots', snapshot.id + '.json'), before = await readFile(source);
    const preview = await f.store.reviewPreview(snapshot.id);
    await assert.rejects(f.store.reviewedExport(snapshot.id, { ...options(preview.snapshotDigest), recordIds: preview.records.map(r => r.record.id), format: 'csv' }), { code: 'REVIEW_EXPORT_TOO_LARGE' });
    assert.deepEqual(await readFile(source), before);
    assert.deepEqual(preview.warnings.slice(0, warnings.length), warnings);
    await assert.rejects(readdir(resolve(f.store.root, 'exports')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('store depth preflight accepts 64 containers and refuses deeply nested inert fields without changing files', async () => {
  const f = await fixture(); try {
    const nestedSource = (depth: number) => {
      // Snapshot, data, items and record account for the first four containers.
      const nested = '{"__proto__":'.repeat(depth - 4) + '"inert leaf"' + '}'.repeat(depth - 4);
      const record = `{"id":"nested","evidence":${nested}}`;
      return Buffer.from(JSON.stringify({ id: f.snapshot.id, data: { ...collection(), items: [] } })
        .replace('"items":[]', `"items":[${record},${record}]`));
    };
    const atLimit = nestedSource(REVIEW_MAX_DEPTH);
    await writeFile(f.path, atLimit);
    const preview = await f.store.reviewPreview(f.snapshot.id);
    assert.equal(preview.duplicateCopies, 1);
    const prior = await f.store.reviewedExport(f.snapshot.id, { ...options(preview.snapshotDigest), recordIds: ['nested'] });
    const priorBytes = await readFile(prior.path);
    assert.deepEqual(JSON.parse(priorBytes.toString()).records[0].record, JSON.parse(atLimit.toString()).data.items[0]);
    assert.deepEqual(await readFile(f.path), atLimit);
    for (const depth of [REVIEW_MAX_DEPTH + 1, 10000]) {
      const source = nestedSource(depth);
      assert.ok(source.length < REVIEW_SNAPSHOT_MAX_BYTES);
      await writeFile(f.path, source);
      await assert.rejects(f.store.reviewPreview(f.snapshot.id), { code: 'REVIEW_TOO_DEEP' });
      await assert.rejects(f.store.reviewedExport(f.snapshot.id, { ...options(createHash('sha256').update(source).digest('hex')), recordIds: ['nested'] }), { code: 'REVIEW_TOO_DEEP' });
      assert.deepEqual(await readFile(f.path), source);
      assert.deepEqual(await readFile(prior.path), priorBytes);
      assert.equal((await readdir(resolve(f.store.root, 'exports'))).length, 1);
    }
  } finally { await f.cleanup(); }
});

test('JSON budget counts actual UTF-8, escaped keys and values, containers, indentation and final newline', () => {
  const id = randomUUID();
  const record = JSON.parse('{"id":"encoding","__proto__":{"empty":{}},"quoted\\\"key":"\\u0001\\n\\\"\\\\","nested":[[],{},null,true,false,0,-12.5,"\\u00e9\\ud83d\\ude00","\\ud800"]}');
  const preview = previewReview(Buffer.from(JSON.stringify({ id, data: { ...collection(), items: [record] } })), id);
  const packet = reviewedPacket(preview, { ...options(preview.snapshotDigest), recordIds: ['encoding'] });
  const original = JSON.stringify(packet, null, 2) + '\n', bytes = Buffer.byteLength(original);
  assert.equal(reviewedJson(packet, bytes), original);
  assert.throws(() => reviewedJson(packet, bytes - 1), { code: 'REVIEW_EXPORT_TOO_LARGE' });
});

test('store rejects pretty JSON amplification before creating output and preserves source and earlier exports', async () => {
  const f = await fixture(); try {
    const initial = await f.store.reviewPreview(f.snapshot.id);
    const prior = await f.store.reviewedExport(f.snapshot.id, options(initial.snapshotDigest));
    const priorBytes = await readFile(prior.path);
    const containers = REVIEW_MAX_DEPTH - 4;
    const nested = '['.repeat(containers) + Array(140000).fill('0').join(',') + ']'.repeat(containers);
    const record = `{"id":"amplified","evidence":${nested}}`;
    const source = Buffer.from(JSON.stringify({ id: f.snapshot.id, data: { ...collection(), items: [] } })
      .replace('"items":[]', `"items":[${JSON.stringify(a)},${record}]`));
    assert.ok(source.length < REVIEW_SNAPSHOT_MAX_BYTES);
    assert.ok(140000 * (2 * REVIEW_MAX_DEPTH + 2) > REVIEW_JSON_MAX_BYTES);
    await writeFile(f.path, source);
    const preview = await f.store.reviewPreview(f.snapshot.id);
    const input = { ...options(preview.snapshotDigest), recordIds: [a.id, 'amplified'] };
    await assert.rejects(f.store.reviewedExport(f.snapshot.id, input), { code: 'REVIEW_EXPORT_TOO_LARGE', message: /JSON.*including indentation/ });
    assert.deepEqual(await readFile(f.path), source);
    assert.deepEqual(await readFile(prior.path), priorBytes);
    assert.equal((await readdir(resolve(f.store.root, 'exports'))).length, 1);
    const smaller = await f.store.reviewedExport(f.snapshot.id, options(preview.snapshotDigest));
    assert.deepEqual(JSON.parse(await readFile(smaller.path, 'utf8')).records[0].record, a);
    const csv = await f.store.reviewedExport(f.snapshot.id, { ...input, format: 'csv' });
    assert.ok((await readFile(csv.path, 'utf8')).includes(csvCell(JSON.parse(record))));
    assert.deepEqual(await readFile(f.path), source);
  } finally { await f.cleanup(); }
});

test('partial export write failures close and remove only their temporary file', async (t) => {
  const f = await fixture(); try {
    const preview = await f.store.reviewPreview(f.snapshot.id);
    const prior = await f.store.reviewedExport(f.snapshot.id, options(preview.snapshotDigest));
    const before = await readFile(f.path), priorBytes = await readFile(prior.path);
    const probe = await open(f.path, 'r'), prototype = Object.getPrototypeOf(probe), write = prototype.writeFile;
    await probe.close();
    let handle: FileHandle | undefined;
    const intercepted = t.mock.method(prototype, 'writeFile', async function(this: FileHandle) {
      handle = this;
      await write.call(this, 'partial synthetic export');
      throw Object.assign(new Error('Synthetic write failure'), { code: 'ENOSPC' });
    });
    await assert.rejects(f.store.reviewedExport(f.snapshot.id, options(preview.snapshotDigest)), { code: 'ENOSPC' });
    intercepted.mock.restore();
    assert.ok(handle);
    await assert.rejects(handle.stat(), { code: 'EBADF' });
    assert.deepEqual(await readFile(f.path), before);
    assert.deepEqual(await readFile(prior.path), priorBytes);
    assert.equal((await readdir(resolve(f.store.root, 'exports'))).length, 1);
  } finally { await f.cleanup(); }
});
