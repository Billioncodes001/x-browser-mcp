import type { Collection, RecordData, RecordKind, StopReason } from './types.js';
export interface CollectionSurface {
  read(): Promise<RecordData[]>;
  scroll(): Promise<void>;
  blocked(): Promise<string | null>;
}
export async function collectBounded(surface: CollectionSurface, options: {
  kind: RecordKind; sourceUrl: string; limit: number; maxScrolls: number; timeBudgetMs?: number;
}): Promise<Collection> {
  const items = new Map<string, RecordData>();
  const warnings: string[] = [];
  const started = Date.now();
  let stale = 0, scrolls = 0;
  let stopReason: StopReason = 'scroll_limit';
  while (true) {
    const blocked = await surface.blocked();
    if (blocked) { stopReason = 'blocked'; warnings.push(blocked); break; }
    const previous = items.size;
    for (const record of await surface.read()) {
      if (items.has(record.id) || items.size < options.limit) items.set(record.id, record);
    }
    stale = items.size === previous ? stale + 1 : 0;
    if (items.size >= options.limit) { stopReason = 'limit'; break; }
    if (Date.now() - started >= (options.timeBudgetMs ?? 60000)) { stopReason = 'time_limit'; break; }
    if (stale >= 3) { stopReason = items.size ? 'no_new_items' : 'empty'; break; }
    if (scrolls >= options.maxScrolls) break;
    await surface.scroll();
    scrolls++;
  }
  if (!items.size && stopReason !== 'blocked') warnings.push('No records were extracted. The page may be empty, not fully loaded, restricted, or its selectors may have changed.');
  warnings.push('This is an observed browser sample, not a complete archive. Missing records do not establish deletion.');
  return { kind: options.kind, sourceUrl: options.sourceUrl, requestedLimit: options.limit, maxScrolls: options.maxScrolls, capturedAt: new Date().toISOString(), items: [...items.values()], stopReason, scrolls, warnings, complete: false };
}
