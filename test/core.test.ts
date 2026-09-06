import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../dist/config.js';
import { postUrl, normalizeAction, destination } from '../dist/validation.js';
import { collectBounded } from '../dist/collector.js';
import { ArtifactStore, compareSnapshots, toCsv } from '../dist/store.js';
import { XService } from '../dist/service.js';
import { SerialQueue } from '../dist/queue.js';
import { FakeBrowser, sample, tempConfig } from './helpers.js';

test('restricts targets to canonical X post URLs, not lookalikes, credentials or ports', () => {
  assert.equal(postUrl('https://twitter.com/alice/status/123/photo/1?s=20'), 'https://x.com/alice/status/123');
  for (const url of ['https://x.com.evil.test/alice/status/1','https://x.com@evil.test/alice/status/1','http://x.com/alice/status/1','https://x.com:444/alice/status/1','https://x.com/home','https://example.com/alice/status/1']) assert.throws(() => postUrl(url));
});
test('validates actions and encodes search query as data', () => {
  assert.throws(() => normalizeAction({ action: 'reply', text: 'hello' }));
  assert.throws(() => normalizeAction({ action: 'post', text: ' ' }));
  assert.throws(() => normalizeAction({ action: 'like', target: 'https://x.com/a/status/1', text: 'extra' }));
  assert.equal(normalizeAction({ action: 'follow', target: '@alice' }).target, 'alice');
  const d = destination({ source: 'search', query: 'cats & dogs #fun', limit: 1, maxScrolls: 0 });
  assert.equal(new URL(d.url).searchParams.get('q'), 'cats & dogs #fun');
  assert.throws(() => destination({ source: 'profile_posts', handle: '../settings', limit: 1, maxScrolls: 0 }));
});
test('configuration rejects remote debugging endpoints and conflicting browser choices', () => {
  assert.throws(() => loadConfig({ X_BROWSER_CDP_URL: 'http://example.com:9222' }));
  assert.throws(() => loadConfig({ X_BROWSER_CHANNEL: 'chrome', X_BROWSER_CDP_URL: 'http://localhost:9222' }));
  assert.throws(() => loadConfig({ X_BROWSER_ENABLE_WRITES: 'yes' }));
  assert.equal(loadConfig({}).enableWrites, false);
});
test('collector handles virtualized pages and updates records without duplicates', async () => {
  let page = 0;
  const pages = [[{ id: 'a', text: 'old' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }], [{ id: 'a', text: 'new' }, { id: 'd' }]];
  const result = await collectBounded({ read: async () => pages[page]!, blocked: async () => null, scroll: async () => { page++; } }, { kind: 'posts', sourceUrl: 'https://x.com/home', limit: 4, maxScrolls: 4 });
  assert.deepEqual(result.items.map(v => v.id), ['a','b','c','d']);
  assert.equal(result.items[0]?.text, 'new'); assert.equal(result.stopReason, 'limit'); assert.equal(result.complete, false);
});
test('collector stops on checkpoints and does not scroll or read blocked content', async () => {
  let reads = 0;
  const result = await collectBounded({ read: async () => { reads++; return []; }, blocked: async () => 'checkpoint', scroll: async () => { throw new Error('must not scroll'); } }, { kind: 'posts', sourceUrl: 'https://x.com/home', limit: 40, maxScrolls: 8 });
  assert.equal(result.stopReason, 'blocked'); assert.equal(reads, 0);
});
test('collector stops on no new items and obeys scroll budget', async () => {
  let scrolls = 0;
  const surface = { read: async () => [{ id: 'a' }], blocked: async () => null, scroll: async () => { scrolls++; } };
  const r = await collectBounded(surface, { kind: 'posts', sourceUrl: 'https://x.com/home', limit: 40, maxScrolls: 20 });
  assert.equal(r.stopReason, 'no_new_items'); assert.equal(scrolls, 3);
  const bounded = await collectBounded(surface, { kind: 'posts', sourceUrl: 'https://x.com/home', limit: 40, maxScrolls: 0 });
  assert.equal(bounded.scrolls, 0); assert.equal(bounded.stopReason, 'scroll_limit');
});
test('serial queue prevents overlapping browser tools and recovers after errors', async () => {
  const queue = new SerialQueue(); const events: string[] = [];
  const first = queue.run(async () => { events.push('start'); await new Promise(r => setTimeout(r, 10)); events.push('end'); throw new Error('expected'); });
  const second = queue.run(async () => { events.push('next'); });
  await assert.rejects(first); await second;
  assert.deepEqual(events, ['start', 'end', 'next']);
});
test('exports protect formulas and preserve commas, quotes and multiline text', () => {
  const csv = toCsv([{ id: '1', text: '=HYPERLINK("bad")', other: 'a,b\nc' }, { id: '2', text: '  +SUM(1,2)' }]);
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"')); assert.ok(csv.includes('"\'  +SUM(1,2)"')); assert.ok(csv.includes('"a,b\nc"'));
});
test('store writes usable export files and rejects traversal', async () => {
  const { config, cleanup } = await tempConfig();
  try {
    const store = new ArtifactStore(config.dataDir);
    const s = await store.saveSnapshot(sample());
    const out = await store.export(s.id, 'csv');
    assert.match(await readFile(out.path, 'utf8'), /hello/);
    assert.equal((await store.listSnapshots()).length, 1);
    await assert.rejects(store.snapshot('../secrets'));
    await assert.rejects(store.saveSearch({ name: '../bad', query: 'x', tab: 'latest', limit: 10, maxScrolls: 1 }));
  } finally { await cleanup(); }
});
test('store refuses an exports junction pointing outside the data root', async () => {
  const first = await tempConfig(), second = await tempConfig();
  try {
    const store = new ArtifactStore(first.config.dataDir);
    const s = await store.saveSnapshot(sample());
    await mkdir(second.config.dataDir, { recursive: true });
    await symlink(second.config.dataDir, resolve(first.config.dataDir,'exports'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(store.export(s.id, 'json'), /escapes/);
  } finally { await first.cleanup(); await second.cleanup(); }
});
test('comparisons label missing samples as not observed and reject different sources', () => {
  const before = { id: 'old', data: sample() };
  const after = { id: 'new', data: sample([{ id:'2', text:'new', url:'https://x.com/alice/status/2' }]) };
  const diff = compareSnapshots(before, after);
  assert.equal(diff.added[0]?.id, '2'); assert.equal(diff.notObserved[0]?.id, '1'); assert.match(diff.warning, /not deleted/);
  assert.throws(() => compareSnapshots(before, { ...after, data: { ...after.data, sourceUrl: 'https://x.com/home' } }));
  assert.throws(() => compareSnapshots({ ...before, data: { ...before.data, sourceKey:'Following' } }, { ...after, data: { ...after.data, sourceKey:'For you' } }), /selected tab/);
});
test('prepared actions require the intended account and cannot be replayed', async () => {
  const { config, cleanup } = await tempConfig();
  try {
    const browser = new FakeBrowser(); const service = new XService(browser, new ArtifactStore(config.dataDir), config);
    await assert.rejects(service.prepare({ action:'post', text:'hello' }, 'bob'), /intended account/);
    const p = await service.prepare({ action:'post', text:'hello' }, 'alice');
    assert.equal(browser.executions, 0);
    await service.execute(p.id);
    await assert.rejects(service.execute(p.id), /already attempted/);
    assert.equal(browser.executions, 1);
    assert.equal((await service.store.receipt(p.id) as {status:string}).status, 'verified');
  } finally { await cleanup(); }
});
test('writes cannot execute when disabled, expired or after account changes', async () => {
  const { config, cleanup } = await tempConfig();
  try {
    const b = new FakeBrowser(); const store = new ArtifactStore(config.dataDir);
    const disabled = new XService(b, store, { ...config, enableWrites:false });
    const p = await disabled.prepare({ action:'post', text:'hello' }, 'alice');
    await assert.rejects(disabled.execute(p.id), /ENABLE_WRITES/);
    const expired = new XService(b, store, { ...config, actionTtlMs:-1 });
    const p2 = await expired.prepare({ action:'post', text:'hello' }, 'alice');
    await assert.rejects(expired.execute(p2.id), /expired/);
    const changed = new XService(b, store, config);
    const p3 = await changed.prepare({ action:'post', text:'hello' }, 'alice'); b.account='bob';
    await assert.rejects(changed.execute(p3.id), /no longer matches/); assert.equal(b.executions,0);
  } finally { await cleanup(); }
});
test('uncertain writes persist a receipt and consume the action ID', async () => {
  const { config, cleanup } = await tempConfig();
  try {
    const b = new FakeBrowser(); b.failWrite=true;
    const service = new XService(b, new ArtifactStore(config.dataDir), config);
    const p = await service.prepare({ action:'post', text:'hello' }, 'alice');
    await assert.rejects(service.execute(p.id)); await assert.rejects(service.execute(p.id));
    const receipt = await service.store.receipt(p.id) as { status:string; warning:string };
    assert.equal(receipt.status,'failed_or_uncertain'); assert.match(receipt.warning,/Do not retry/); assert.equal(b.executions,1);
  } finally { await cleanup(); }
});
test('saved-search automation advances successful baseline and preserves it after blocked runs', async () => {
  const { config, cleanup } = await tempConfig();
  try {
    const b = new FakeBrowser(); const service = new XService(b, new ArtifactStore(config.dataDir), config);
    await service.saveSearch({ name:'test',query:'hello',tab:'latest',limit:40,maxScrolls:8 });
    const first = await service.runSearch('test'); assert.equal(first.comparison,null);
    b.result = sample([{id:'2',text:'new',url:'https://x.com/alice/status/2'}]);
    const second = await service.runSearch('test'); assert.equal(second.comparison?.added[0]?.id,'2');
    b.result = { ...sample([]), stopReason:'blocked' };
    const third = await service.runSearch('test'); assert.equal(third.baselineAdvanced,false);
    assert.equal((await service.store.search('test')).lastSnapshotId,second.snapshot.id);
  } finally { await cleanup(); }
});
