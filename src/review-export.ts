import { createHash } from 'node:crypto';
import { z } from 'zod';
import { XBrowserError } from './errors.js';
import type { RecordData } from './types.js';

export const REVIEW_SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
export const REVIEW_CSV_MAX_BYTES = 16 * 1024 * 1024;
export const REVIEW_JSON_MAX_BYTES = 16 * 1024 * 1024;
export const REVIEW_MAX_DEPTH = 64;
export function snapshotTooLarge() {
  return new XBrowserError('REVIEW_TOO_LARGE', 'Reviewed export is limited to 8 MiB of saved snapshot data. Original exports remain available.');
}

export const reviewOptionsSchema = z.object({
  snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
  recordIds: z.array(z.string().min(1).max(500)).min(1).max(200)
    .refine(ids => new Set(ids).size === ids.length, 'Select each record only once'),
  note: z.string().trim().min(15).max(2000),
  acknowledgedPartial: z.literal(true),
  format: z.enum(['json', 'csv']).default('json'),
}).strict();
export type ReviewOptions = z.input<typeof reviewOptionsSchema>;

const snapshotSchema = z.object({
  id: z.string().uuid(), label: z.string().optional(),
  data: z.object({
    kind: z.enum(['posts', 'users', 'notifications', 'trends']),
    sourceUrl: z.string().url().max(4000), sourceKey: z.string().max(4000).optional(),
    capturedAt: z.iso.datetime({ offset: true }), complete: z.literal(false),
    requestedLimit: z.number().int().min(1).max(200).optional(),
    maxScrolls: z.number().int().min(0).max(30).optional(),
    stopReason: z.enum(['limit', 'scroll_limit', 'time_limit', 'no_new_items', 'empty', 'blocked']),
    scrolls: z.number().int().min(0).max(30),
    warnings: z.array(z.string().max(4000)).max(100),
    items: z.array(z.object({ id: z.string().min(1).max(500) }).passthrough()).max(200),
  }).passthrough(),
}).passthrough();

function* childValues(value: object): Generator<unknown> {
  for (const key in value) if (Object.hasOwn(value, key)) yield (value as Record<string, unknown>)[key];
}

function validateDepth(value: unknown) {
  const stack = [{ values: [value].values() as Iterator<unknown>, depth: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    const next = frame.values.next();
    if (next.done) { stack.pop(); continue; }
    if (next.value === null || typeof next.value !== 'object') continue;
    const depth = frame.depth + 1;
    if (depth > REVIEW_MAX_DEPTH)
      throw new XBrowserError('REVIEW_TOO_DEEP', `Reviewed snapshots support at most ${REVIEW_MAX_DEPTH} nested JSON containers, counting the root as one. No fields were flattened or removed; original exports remain available.`);
    stack.push({ values: childValues(next.value), depth });
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}

export function previewReview(raw: Buffer, id: string) {
  if (raw.length > REVIEW_SNAPSHOT_MAX_BYTES) throw snapshotTooLarge();
  const original: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  validateDepth(original);
  snapshotSchema.parse(original);
  // Zod strips own __proto__ keys from its output. JSON.parse keeps them inert;
  // validate without substituting the clone so dedup/export retain every saved field.
  const snapshot = original as z.infer<typeof snapshotSchema>;
  if (snapshot.id !== id) throw new XBrowserError('SNAPSHOT_MISMATCH', 'The saved snapshot ID does not match its file.');
  const records: Array<{ record: RecordData; originalIndices: number[] }> = [];
  const seen = new Map<string, typeof records[number]>();
  snapshot.data.items.forEach((record, index) => {
    const previous = seen.get(record.id);
    if (previous) {
      if (canonical(previous.record) !== canonical(record))
        throw new XBrowserError('CONFLICTING_DUPLICATE', `Record ${record.id} has conflicting saved copies. Inspect the original export; no copy was silently chosen.`);
      previous.originalIndices.push(index);
    } else {
      const entry = { record, originalIndices: [index] };
      seen.set(record.id, entry); records.push(entry);
    }
  });
  return {
    snapshotId: id, snapshotDigest: createHash('sha256').update(raw).digest('hex'),
    label: snapshot.label ?? null,
    source: { kind: snapshot.data.kind, sourceUrl: snapshot.data.sourceUrl, sourceKey: snapshot.data.sourceKey ?? null,
      capturedAt: snapshot.data.capturedAt, requestedLimit: snapshot.data.requestedLimit ?? null,
      maxScrolls: snapshot.data.maxScrolls ?? null, scrolls: snapshot.data.scrolls,
      stopReason: snapshot.data.stopReason, complete: false as const },
    rawCount: snapshot.data.items.length, uniqueCount: records.length,
    duplicateCopies: snapshot.data.items.length - records.length, records,
    warnings: [...new Set([...snapshot.data.warnings,
      'This is a partial browser sample, never a complete archive. Missing records do not establish deletion.',
      'A reviewed selection records a local operator declaration, not fact-checking, authenticity or proof of human approval.',
      ...(snapshot.data.stopReason === 'blocked' ? ['Collection was blocked. Only observations captured before the stop are available.'] : []),
      ...(!records.length ? ['No records are available for selection; a reviewed export cannot be created.'] : []),
      ...(records.some(({record}) => typeof record.url !== 'string' || !/^https?:\/\//.test(record.url)) ?
        ['Some records have no captured HTTP(S) record URL. Collection provenance is retained; no individual citation URL is invented.'] : []),
    ])],
  };
}
export type ReviewPreview = ReturnType<typeof previewReview>;

export function reviewedPacket(preview: ReviewPreview, input: ReviewOptions) {
  const review = reviewOptionsSchema.parse(input);
  if (review.snapshotDigest !== preview.snapshotDigest)
    throw new XBrowserError('REVIEW_STALE', 'The saved snapshot changed. Reload the preview and review the selection again.');
  const selected = new Set(review.recordIds);
  const records = preview.records.filter(r => selected.has(r.record.id));
  if (records.length !== selected.size) throw new XBrowserError('UNKNOWN_RECORD', 'The selection includes a record not in this snapshot.');
  return {
    schema: 'x-browser-reviewed-export/v1',
    provenance: { snapshotId: preview.snapshotId, snapshotDigest: preview.snapshotDigest,
      digestScope: 'SHA-256 of the original saved snapshot file bytes; not a signature', label: preview.label, ...preview.source },
    selection: { rawCount: preview.rawCount, uniqueCount: preview.uniqueCount, selectedCount: records.length,
      excludedUniqueCount: preview.uniqueCount - records.length, duplicateCopies: preview.duplicateCopies,
      rule: 'Selected IDs in original capture order; exact duplicate IDs collapsed, conflicting copies refused. originalIndices are zero-based snapshot item positions.' },
    review: { note: review.note, reviewedAt: new Date().toISOString(), acknowledgedPartial: true },
    warnings: preview.warnings, records,
  };
}

export function reviewedJson(packet: ReturnType<typeof reviewedPacket>, maxBytes = REVIEW_JSON_MAX_BYTES): string {
  validateDepth(packet);
  let bytes = 1; // Trailing newline is part of the download.
  const add = (length: number) => {
    bytes += length;
    if (bytes > maxBytes)
      throw new XBrowserError('REVIEW_EXPORT_TOO_LARGE', `JSON exceeds the ${maxBytes}-byte output limit including indentation. Select fewer records or use CSV. No export was written.`);
  };
  // Count the exact two-space JSON encoding before allocating the full result.
  // Recursion here is safe only after the iterative container-depth preflight.
  const count = (value: unknown, depth: number) => {
    if (value === null || typeof value !== 'object') { add(Buffer.byteLength(JSON.stringify(value))); return; }
    add(2);
    let entries = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      add((entries++ ? 2 : 1) + 2 * (depth + 1));
      if (!Array.isArray(value)) add(Buffer.byteLength(JSON.stringify(key)) + 2);
      count((value as Record<string, unknown>)[key], depth + 1);
    }
    if (entries) add(1 + 2 * depth);
  };
  count(packet, 0);
  return JSON.stringify(packet, null, 2) + '\n';
}

export function reviewCsvRows(packet: ReturnType<typeof reviewedPacket>): RecordData[] {
  return packet.records.map(({record, originalIndices}) => ({
    id: record.id, record_url: record.url ?? null, record_json: record,
    original_indices: originalIndices, snapshot_id: packet.provenance.snapshotId,
    snapshot_sha256: packet.provenance.snapshotDigest, snapshot_label: packet.provenance.label,
    digest_scope: packet.provenance.digestScope, collection_source_url: packet.provenance.sourceUrl,
    source_key: packet.provenance.sourceKey, captured_at: packet.provenance.capturedAt,
    kind: packet.provenance.kind, stop_reason: packet.provenance.stopReason, complete: false,
    requested_limit: packet.provenance.requestedLimit, max_scrolls: packet.provenance.maxScrolls,
    scrolls: packet.provenance.scrolls, selection: packet.selection,
    review_note: packet.review.note, reviewed_at: packet.review.reviewedAt,
    acknowledged_partial: true, warnings: packet.warnings, schema: packet.schema,
  }));
}
