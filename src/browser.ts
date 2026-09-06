import { mkdir } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import type { Config } from './config.js';
import { extractDom, extractProfile } from './dom.js';
import { collectBounded } from './collector.js';
import { destination, handleSchema, normalizeAction, postUrl } from './validation.js';
import { XBrowserError } from './errors.js';
import type { ActionInput, BrowserPort, Collection, ReadRequest, RecordData, SessionState } from './types.js';

export class XBrowser implements BrowserPort {
  private context?: BrowserContext;
  private page?: Page;
  private attachedBrowser?: Browser;
  constructor(private config: Config, private launch: typeof chromium.launchPersistentContext = (...args) => chromium.launchPersistentContext(...args)) {}

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (this.config.cdpUrl) {
      if (!this.attachedBrowser?.isConnected()) this.attachedBrowser = await chromium.connectOverCDP(this.config.cdpUrl);
      this.context = this.attachedBrowser.contexts()[0];
      if (!this.context) throw new XBrowserError('NO_BROWSER_CONTEXT', 'The attached browser has no context. Open its profile window first.');
      this.page = await this.context.newPage();
    } else {
      await mkdir(this.config.profileDir, { recursive: true, mode: 0o700 });
      try {
        this.context = await this.launch(this.config.profileDir, {
          headless: this.config.headless, channel: this.config.browserChannel ?? 'chromium', executablePath: this.config.executablePath,
          viewport: { width: 1440, height: 1000 }, locale: 'en-US',
          args: ['--lang=en-US'],
        });
      } catch {
        throw new XBrowserError('BROWSER_START_FAILED', 'Could not start the dedicated browser. Run npx playwright install chromium, or select an installed Chrome/Edge channel. Close another MCP/login process using this profile before retrying.');
      }
      this.context.on('close', () => { this.context = undefined; this.page = undefined; });
      this.page = this.context.pages()[0] ?? await this.context.newPage();
    }
    this.page.setDefaultTimeout(10000);
    this.page.setDefaultNavigationTimeout(30000);
    return this.page;
  }

  async open(): Promise<SessionState> {
    const page = await this.ensurePage();
    if (page.url() === 'about:blank') await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    await this.waitForShell(page);
    return this.status();
  }
  private async waitForShell(page: Page) {
    await page.locator('main, input[autocomplete="username"], [data-testid="loginButton"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
  }
  async status(): Promise<SessionState> {
    if (!this.page || this.page.isClosed()) return { state: 'closed', account: null, url: null, message: 'Use x_session_open or the login CLI to open the dedicated browser.' };
    const page = this.page;
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(new URL(page.url()).hostname)) {
      return { state: 'unknown', account: null, url: null, message: 'The dedicated tab is not currently on X.' };
    }
    const observed = await page.evaluate(() => {
      const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      const has = (selector: string) => Array.from(document.querySelectorAll(selector)).some(visible);
      const profile = Array.from(document.querySelectorAll('a[data-testid="AppTabBar_Profile_Link"]')).find(visible);
      const href = profile?.getAttribute('href');
      const match = href?.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      const account = match?.[1] ?? null;
      const authed = has('[data-testid="SideNav_AccountSwitcher_Button"]') || !!account;
      const errors = Array.from(document.querySelectorAll('[role="alert"], [data-testid="error-detail"], [data-testid="emptyState"]')).filter(e => !e.closest('article') && visible(e)).map(e => (e as HTMLElement).innerText || '').join('\n');
      return {
        account, authed, errors,
        login: !authed && (has('input[autocomplete="username"], input[name="text"], [data-testid="loginButton"]') || /\/i\/flow\/(login|signup)/.test(location.pathname) || (!has('main') && /Happening now/i.test(document.body.innerText))),
        checkpoint: /\/account\/(access|login_challenge)/.test(location.pathname) || has('iframe[src*="arkoselabs"], iframe[src*="captcha"], [data-testid="ocfEnterTextTextInput"]'),
      };
    });
    const base = { account: observed.account, url: page.url() };
    if (observed.checkpoint) return { ...base, state: 'checkpoint', message: 'X requires a verification step. Complete it manually in the browser, then retry.' };
    if (/rate limit|too many requests|usage limit/i.test(observed.errors)) return { ...base, state: 'rate_limited', message: 'X reports a rate limit. Stop collection and retry later; no automatic bypass or retry is performed.' };
    if (observed.login) return { ...base, state: 'login_required', message: 'Sign in manually in the browser. Passwords, OTPs, and cookies are not MCP tool inputs.' };
    if (/doesn.t exist|account suspended|not available|something went wrong|try reloading/i.test(observed.errors)) return { ...base, state: 'unavailable', message: 'X shows an unavailable-content or loading error on this page.' };
    if (observed.authed) return { ...base, state: 'logged_in', message: observed.account ? `Signed in as @${observed.account}.` : 'Signed in, but account identity could not be read; writes are blocked.' };
    return { ...base, state: 'unknown', message: 'Could not establish session state. Inspect the browser; the page may still be loading or the selectors may have changed.' };
  }
  private async requireSession() {
    const s = await this.status();
    if (s.state !== 'logged_in') throw new XBrowserError(s.state.toUpperCase(), s.message);
    return s;
  }
  private async go(url: string) {
    const u = new URL(url);
    if (u.origin !== 'https://x.com') throw new XBrowserError('INVALID_DESTINATION', 'Browser navigation is limited to X.');
    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.waitForShell(page);
    await page.waitForTimeout(this.config.delayMs);
    await this.requireSession();
    return page;
  }
  async collect(request: ReadRequest): Promise<Collection> {
    const dest = destination(request);
    const page = await this.go(dest.url);
    if (dest.selectedTab) {
      const tab = page.getByRole('tab', { name: dest.selectedTab, exact: true });
      if (await tab.count() !== 1) throw new XBrowserError('TAB_NOT_FOUND', `Could not locate the ${dest.selectedTab} timeline tab. Check that X uses English and that its layout has not changed.`);
      if (await tab.getAttribute('aria-selected') !== 'true') {
        await tab.click();
        await page.waitForTimeout(this.config.delayMs);
        if (await tab.getAttribute('aria-selected') !== 'true') throw new XBrowserError('TAB_NOT_SELECTED', 'The requested timeline did not become selected.');
      }
    }
    await page.locator('[data-testid="tweet"], [data-testid="UserCell"], [data-testid="trend"], [data-testid="cellInnerDiv"], [data-testid="emptyState"]').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
    const result = await collectBounded({
      read: () => page.evaluate(extractDom, dest.kind),
      scroll: async () => { await page.mouse.wheel(0, 800); await page.waitForTimeout(this.config.delayMs); },
      blocked: async () => { const s = await this.status(); return s.state === 'logged_in' ? null : `${s.state}: ${s.message}`; },
    }, { ...dest, sourceUrl: page.url(), limit: request.limit, maxScrolls: request.maxScrolls });
    result.sourceKey = JSON.stringify({ source: request.source, url: dest.url, selectedTab: dest.selectedTab ?? null });
    if (request.source === 'thread') {
      const id = postUrl(request.url!).split('/').at(-1);
      if (!result.items.some(p => p.id === id)) result.warnings.push('The requested root post was not observed. The page may contain only replies or recommendations.');
      result.warnings.push('The conversation page can mix replies, recommendations, and promoted posts. Conversation membership is not inferred from proximity.');
    }
    return result;
  }
  async profile(handle: string): Promise<RecordData> {
    const h = handleSchema.parse(handle);
    const page = await this.go(`https://x.com/${h}`);
    await page.locator('[data-testid="UserName"]').waitFor({ state: 'visible' }).catch(() => { throw new XBrowserError('PROFILE_NOT_FOUND', 'The requested profile did not load or its selectors changed.'); });
    return page.evaluate(extractProfile, h);
  }
  private async targetArticle(url: string): Promise<Locator> {
    const canonical = postUrl(url);
    const id = canonical.split('/').at(-1)!;
    const page = await this.go(canonical);
    await page.locator('article[data-testid="tweet"]').first().waitFor({ state: 'visible' });
    const articles = page.locator('article[data-testid="tweet"]');
    for (let i = 0; i < await articles.count(); i++) {
      const article = articles.nth(i);
      const firstTimeHref = await article.evaluate(el => Array.from(el.querySelectorAll('time')).find(t => t.closest('article') === el && !t.closest('[data-testid="quoteTweet"], [role="link"]'))?.closest('a')?.getAttribute('href') ?? null);
      if (firstTimeHref && new URL(firstTimeHref, 'https://x.com').pathname.match(/\/status\/(\d+)/)?.[1] === id) return article;
    }
    throw new XBrowserError('TARGET_NOT_FOUND', 'The exact requested post was not found. No action was submitted.');
  }
  async preview(raw: ActionInput): Promise<Record<string, unknown>> {
    const input = normalizeAction(raw);
    if (input.action === 'post') { await this.go('https://x.com/home'); return { action: input.action, text: input.text }; }
    if (['follow', 'unfollow'].includes(input.action)) return { action: input.action, profile: await this.profile(input.target!) };
    await this.targetArticle(input.target!);
    const posts = await this.page!.evaluate(extractDom, 'posts' as const);
    const target = posts.find(p => p.url === input.target);
    if (!target) throw new XBrowserError('TARGET_NOT_FOUND', 'Could not extract the target post for review.');
    return { action: input.action, target, ...(input.text ? { text: input.text } : {}) };
  }
  private async verifyAccount(expected: string) {
    const s = await this.requireSession();
    if (s.account?.toLowerCase() !== expected.toLowerCase()) throw new XBrowserError('ACCOUNT_CHANGED', 'The signed-in account differs from the prepared action. Prepare a new action.');
  }
  async execute(raw: ActionInput, account: string): Promise<Record<string, unknown>> {
    const input = normalizeAction(raw);
    // Service validates again; this guard also protects direct adapter consumers.
    if (!this.config.enableWrites) throw new XBrowserError('WRITES_DISABLED', 'Set X_BROWSER_ENABLE_WRITES=true to enable account actions.');
    if (input.action === 'post' || input.action === 'reply') return this.publish(input, account);
    if (input.action === 'follow' || input.action === 'unfollow') {
      await this.profile(input.target!);
      await this.verifyAccount(account);
      const main = this.page!.locator('main');
      const follow = main.locator('[data-testid$="-follow"]').filter({ visible: true });
      const unfollow = main.locator('[data-testid$="-unfollow"]').filter({ visible: true });
      // Scope to the profile header, excluding recommendations and posts.
      const headerButton = (button: Locator) => button.filter({ hasNot: this.page!.locator('article') });
      const desired = input.action === 'follow' ? headerButton(unfollow) : headerButton(follow);
      const current = input.action === 'follow' ? headerButton(follow) : headerButton(unfollow);
      const targetButtons = await current.all();
      const eligible: Locator[] = [];
      for (const b of targetButtons) if (!await b.evaluate(el => !!el.closest('article, [data-testid="UserCell"]'))) eligible.push(b);
      if (!eligible.length) {
        for (const b of await desired.all()) if (!await b.evaluate(el => !!el.closest('article, [data-testid="UserCell"]'))) return { status: 'already_in_desired_state', action: input.action };
        throw new XBrowserError('CONTROL_NOT_FOUND', 'Could not identify the profile follow control.');
      }
      if (eligible.length !== 1) throw new XBrowserError('AMBIGUOUS_CONTROL', 'Multiple profile controls matched. No action was submitted.');
      await this.verifyAccount(account);
      await eligible[0]!.click();
      if (input.action === 'unfollow') await this.page!.getByTestId('confirmationSheetConfirm').click();
      await this.page!.waitForTimeout(this.config.delayMs);
      for (const b of await desired.all()) if (await b.isVisible() && !await b.evaluate(el => !!el.closest('article, [data-testid="UserCell"]'))) return { status: 'verified', action: input.action, target: input.target };
      throw new XBrowserError('WRITE_UNCERTAIN', 'The profile action was attempted but its final state was not verified. Inspect X before retrying.');
    }
    const article = await this.targetArticle(input.target!);
    await this.verifyAccount(account);
    const pairs: Record<string, [string, string]> = {
      like: ['like', 'unlike'], unlike: ['unlike', 'like'], bookmark: ['bookmark', 'removeBookmark'], unbookmark: ['removeBookmark', 'bookmark'], repost: ['retweet', 'unretweet'], unrepost: ['unretweet', 'retweet'],
    };
    const [before, after] = pairs[input.action]!;
    if (await article.getByTestId(after).isVisible()) return { status: 'already_in_desired_state', action: input.action, target: input.target };
    if (!await article.getByTestId(before).isVisible()) throw new XBrowserError('CONTROL_NOT_FOUND', 'The requested post control is not visible. No action was submitted.');
    await article.getByTestId(before).click();
    if (input.action === 'repost' || input.action === 'unrepost') {
      await this.page!.getByTestId(input.action === 'repost' ? 'retweetConfirm' : 'unretweetConfirm').click();
    }
    await article.getByTestId(after).waitFor({ state: 'visible', timeout: 10000 }).catch(() => { throw new XBrowserError('WRITE_UNCERTAIN', 'The action was attempted but its final state was not verified. Inspect the post before retrying.'); });
    return { status: 'verified', action: input.action, target: input.target };
  }
  private async publish(input: ActionInput, account: string): Promise<Record<string, unknown>> {
    const page = input.action === 'post' ? await this.go('https://x.com/compose/post') : (await this.targetArticle(input.target!), this.page!);
    await this.verifyAccount(account);
    if (input.action === 'reply') {
      const article = await this.targetArticle(input.target!);
      await article.getByTestId('reply').click();
    }
    const dialog = page.getByRole('dialog');
    const scope = await dialog.count() === 1 ? dialog : page.locator('main');
    const editor = scope.getByTestId('tweetTextarea_0');
    if (await editor.count() !== 1) throw new XBrowserError('COMPOSER_NOT_FOUND', 'Could not identify one composer. No post was submitted.');
    if ((await editor.innerText()).trim()) throw new XBrowserError('EXISTING_DRAFT', 'The composer already contains a draft. Clear or save it manually before preparing another action.');
    await editor.fill(input.text!);
    if ((await editor.innerText()).replace(/\r\n/g, '\n') !== input.text!.replace(/\r\n/g, '\n')) throw new XBrowserError('DRAFT_MISMATCH', 'The composer text did not match the prepared action. Nothing was submitted.');
    const submit = scope.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').filter({ visible: true });
    if (await submit.count() !== 1 || !await submit.isEnabled()) throw new XBrowserError('POST_NOT_READY', 'X has disabled submission or the submit control is ambiguous. Check length, permissions, and the composer.');
    await this.verifyAccount(account);
    await submit.click();
    // A closed editor alone is not proof of publication. Require an explicit X success toast.
    const toast = page.getByTestId('toast');
    await toast.filter({ hasText: /(?:your (?:post|reply) was sent|(?:post|reply) sent)/i }).waitFor({ state: 'visible', timeout: 15000 }).catch(() => { throw new XBrowserError('WRITE_UNCERTAIN', 'Submission was attempted, but no success receipt was observed. Check your profile/replies before trying again.'); });
    const links = await toast.locator('a[href]').evaluateAll(es => es.map(e => e.getAttribute('href')));
    const link = links.find(v => v?.includes('/status/'));
    return { status: 'verified', action: input.action, evidence: 'X success toast', url: link ? new URL(link, 'https://x.com').href : null };
  }
  async screenshot(): Promise<Buffer> {
    if (!this.page || this.page.isClosed()) throw new XBrowserError('SESSION_CLOSED', 'Open the session first.');
    // Avoid capturing credentials in login/challenge inputs.
    await this.requireSession();
    return this.page.screenshot({ fullPage: false });
  }
  async close(): Promise<void> {
    if (this.config.cdpUrl) {
      if (this.page && !this.page.isClosed()) await this.page.close();
      // Never close a browser owned by the user. Reuse its connection if reopened.
    } else await this.context?.close();
    this.page = undefined;
    this.context = undefined;
  }
}
