import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SerialQueue } from './queue.js';
import { ArtifactStore, compareSnapshots, type SavedSearch } from './store.js';
import { errorInfo, XBrowserError } from './errors.js';
import { destination, handleSchema, limitSchema, normalizeAction, scrollSchema } from './validation.js';
import type { Config } from './config.js';
import type { ActionInput, BrowserPort, PreparedAction, ReadRequest } from './types.js';

export class XService {
  readonly queue = new SerialQueue();
  private pending = new Map<string, PreparedAction>();
  constructor(readonly browser: BrowserPort, readonly store: ArtifactStore, readonly config: Config) {}
  open() { return this.queue.run(() => this.browser.open()); }
  status() { return this.queue.run(() => this.browser.status()); }
  close() { return this.queue.run(async () => { this.pending.clear(); await this.browser.close(); return { state: 'closed' }; }); }
  screenshot() { return this.queue.run(() => this.browser.screenshot()); }
  profile(handle: string) { return this.queue.run(() => this.browser.profile(handleSchema.parse(handle))); }
  read(request: ReadRequest) {
    return this.queue.run(async () => {
      const r = { ...request, limit: limitSchema.parse(request.limit), maxScrolls: scrollSchema.parse(request.maxScrolls) };
      destination(r);
      return this.store.saveSnapshot(await this.browser.collect(r));
    });
  }
  saveSearch(search: SavedSearch) {
    return this.queue.run(() => {
      const checked: SavedSearch = { name: search.name, query: z.string().trim().min(1).max(1000).parse(search.query), tab: z.enum(['latest','top','people','photos','videos']).parse(search.tab), limit: limitSchema.parse(search.limit), maxScrolls: scrollSchema.parse(search.maxScrolls) };
      return this.store.saveSearch(checked);
    });
  }
  runSearch(name: string) {
    return this.queue.run(async () => {
      const search = await this.store.search(name);
      const request: ReadRequest = { source: 'search', query: search.query, tab: search.tab, limit: limitSchema.parse(search.limit), maxScrolls: scrollSchema.parse(search.maxScrolls) };
      destination(request);
      const snapshot = await this.store.saveSnapshot(await this.browser.collect(request), name);
      // Interrupted/empty collection cannot advance the baseline and make a later run look new.
      if (snapshot.data.stopReason === 'blocked' || !snapshot.data.items.length) return { snapshot, comparison: null, baselineAdvanced: false };
      const comparison = search.lastSnapshotId ? compareSnapshots(await this.store.snapshot(search.lastSnapshotId), snapshot) : null;
      await this.store.saveSearch({ ...search, lastSnapshotId: snapshot.id });
      return { snapshot, comparison, baselineAdvanced: true };
    });
  }
  prepare(input: ActionInput, expectedAccount: string) {
    return this.queue.run(async () => {
      const normalized = normalizeAction(input);
      const expected = handleSchema.parse(expectedAccount);
      const before = await this.browser.status();
      if (before.state !== 'logged_in' || before.account?.toLowerCase() !== expected.toLowerCase()) throw new XBrowserError('ACCOUNT_MISMATCH', 'Open the session and verify the intended account before preparing this action.');
      const preview = await this.browser.preview(normalized);
      const after = await this.browser.status();
      if (after.state !== 'logged_in' || after.account?.toLowerCase() !== expected.toLowerCase()) throw new XBrowserError('ACCOUNT_CHANGED', 'The account changed during preparation. No action was submitted.');
      const now = Date.now();
      for (const [id, value] of this.pending) if (Date.parse(value.expiresAt) <= now) this.pending.delete(id);
      if (this.pending.size >= 50) throw new XBrowserError('TOO_MANY_DRAFTS', 'Cancel or let existing prepared actions expire before creating more.');
      const prepared: PreparedAction = { id: randomUUID(), account: after.account!, input: normalized, preview, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + this.config.actionTtlMs).toISOString() };
      this.pending.set(prepared.id, prepared);
      return { ...prepared, writesEnabled: this.config.enableWrites, submitted: false, instruction: 'Show the exact account, target, and content to the user. Execute only if the user has authorized this action; this ID is not authorization.' };
    });
  }
  execute(id: string) {
    return this.queue.run(async () => {
      if (!this.config.enableWrites) throw new XBrowserError('WRITES_DISABLED', 'Set X_BROWSER_ENABLE_WRITES=true and restart to enable account actions.');
      const prepared = this.pending.get(id);
      if (!prepared) throw new XBrowserError('UNKNOWN_ACTION', 'This action is unknown, already attempted, cancelled, or the server restarted. Read its receipt before preparing a replacement.');
      this.pending.delete(id);
      if (Date.parse(prepared.expiresAt) <= Date.now()) throw new XBrowserError('EXPIRED_ACTION', 'The prepared action expired. Prepare a new preview.');
      const s = await this.browser.status();
      if (s.state !== 'logged_in' || s.account?.toLowerCase() !== prepared.account.toLowerCase()) throw new XBrowserError('ACCOUNT_CHANGED', 'The signed-in account no longer matches the prepared action. No action was submitted.');
      const base = { id, account: prepared.account, action: prepared.input.action, target: prepared.input.target, attemptedAt: new Date().toISOString() };
      // Persist before the browser action. A crash leaves an explicit uncertain receipt.
      await this.store.receipt(id, { ...base, status: 'started', warning: 'If no final receipt exists, inspect X before retrying.' });
      try {
        const result = await this.browser.execute(prepared.input, prepared.account);
        const receipt = { ...base, ...result, completedAt: new Date().toISOString() };
        await this.store.receipt(id, receipt);
        return receipt;
      } catch (e) {
        await this.store.receipt(id, { ...base, status: 'failed_or_uncertain', error: errorInfo(e), warning: 'Do not retry automatically. Inspect X and this receipt first.' });
        throw e;
      }
    });
  }
  cancel(id: string) { return this.queue.run(async () => ({ cancelled: this.pending.delete(id), id })); }
}
