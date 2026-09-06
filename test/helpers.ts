import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Config } from '../dist/config.js';
import type { BrowserPort, Collection, SessionState, ActionInput } from '../dist/types.js';

export async function tempConfig(): Promise<{ config: Config; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(resolve(tmpdir(), 'x-browser-mcp-test-'));
  return { config: { dataDir: dir, profileDir: resolve(dir, 'browser-profile'), headless: true, enableWrites: true, delayMs: 0, actionTtlMs: 600000, executablePath: process.env.TEST_BROWSER_EXECUTABLE }, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
export const sample = (items = [{ id: '1', text: 'hello', url: 'https://x.com/alice/status/1' }]): Collection => ({ kind: 'posts', sourceUrl: 'https://x.com/search?q=hello', capturedAt: new Date().toISOString(), items, stopReason: 'limit', scrolls: 0, warnings: [], complete: false });
export class FakeBrowser implements BrowserPort {
  account: string | null = 'alice';
  state: SessionState['state'] = 'logged_in';
  executions = 0;
  failWrite = false;
  result = sample();
  async open() { return this.status(); }
  async status(): Promise<SessionState> { return { state: this.state, account: this.account, url: 'https://x.com/home', message: 'fixture' }; }
  async close() {}
  async collect() { return this.result; }
  async profile(handle: string) { return { id: handle, handle }; }
  async preview(input: ActionInput) { return { ...input }; }
  async execute() { this.executions++; if (this.failWrite) throw new Error('write timed out'); return { status: 'verified' }; }
  async screenshot() { return Buffer.alloc(0); }
}
export function post(id = '1', text = 'Hello world', extra = '') {
  return `<article data-testid="tweet"><div data-testid="User-Name">Alice\n@alice</div><a href="/alice/status/${id}"><time datetime="2026-09-05T12:00:00Z">12h</time></a>${text ? `<div data-testid="tweetText">${text}</div>` : ''}${extra}<div role="group"><button data-testid="reply" aria-label="12 Replies">12</button><button data-testid="retweet" aria-label="2 Reposts">2</button><button data-testid="like" aria-label="1.2K Likes">1.2K</button><button data-testid="bookmark" aria-label="Bookmark"></button><a href="/alice/status/${id}/analytics" aria-label="4,500 Views">4,500</a></div></article>`;
}
export function shell(body: string, script = '') {
  return `<!doctype html><html lang="en"><head><style>body{font:16px sans-serif}article{padding:20px;margin:10px;border:1px solid}button{padding:8px}main{min-height:1000px}</style></head><body><nav><a data-testid="AppTabBar_Profile_Link" href="/alice">Profile</a><button data-testid="SideNav_AccountSwitcher_Button">Account</button></nav><main>${body}</main><script>${script}</script></body></html>`;
}
