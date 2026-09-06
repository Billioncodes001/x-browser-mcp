import type { RecordData, RecordKind } from './types.js';

/** Self-contained: serialized by Playwright and evaluated against rendered DOM only. */
export function extractDom(kind: RecordKind): RecordData[] {
  const main = document.querySelector('main') ?? document;
  const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const text = (e: Element | null | undefined) => e && visible(e) ? (e as HTMLElement).innerText?.trim() || '' : '';
  const unique = <T>(a: T[]) => [...new Set(a)];
  const absolute = (href: string | null) => {
    if (!href) return null;
    try { const u = new URL(href, location.href); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; }
  };
  const hash = (s: string) => {
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0).toString(16);
  };
  const metric = (e: Element | null) => {
    const raw = e && visible(e) ? (e.getAttribute('aria-label') || text(e)).trim() : '';
    const match = raw.replace(/,/g, '').match(/(?:^|\s)(\d+(?:\.\d+)?)\s*([KMB])?(?=\s|$|\.)/i);
    if (!match) return { value: null, raw: raw || null, approximate: false };
    const multiplier: Record<string, number> = { K: 1000, M: 1000000, B: 1000000000 };
    return { value: Math.round(Number(match[1]) * (multiplier[(match[2] || '').toUpperCase()] ?? 1)), raw, approximate: !!match[2] };
  };
  const statusLink = (e: Element | null) => {
    const href = absolute(e?.getAttribute('href') ?? null);
    if (!href) return null;
    const u = new URL(href);
    if (!['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(u.hostname)) return null;
    const m = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/.*)?$/);
    return m ? { id: m[2]!, author: m[1]!, url: `https://x.com/${m[1]}/status/${m[2]}` } : null;
  };
  if (kind === 'posts') {
    return Array.from(main.querySelectorAll('article[data-testid="tweet"]')).filter(visible).flatMap(article => {
      const times = Array.from(article.querySelectorAll('time')).filter(visible);
      const primaryTime = times.find(t => t.closest('article') === article && !t.closest('[data-testid="quoteTweet"], [role="link"]'));
      const source = statusLink(primaryTime?.closest('a') ?? null);
      if (!source) return [];
      const quotedTime = times.find(t => statusLink(t.closest('a'))?.id !== source.id && statusLink(t.closest('a')) !== null);
      const quoteRoot = article.querySelector('[data-testid="quoteTweet"]') ?? quotedTime?.closest('[role="link"]');
      const own = (selector: string) => Array.from(article.querySelectorAll(selector)).find(e => e.closest('article') === article && !quoteRoot?.contains(e) && visible(e)) ?? null;
      const quoteSource = statusLink(quotedTime?.closest('a') ?? null);
      const content = own('[data-testid="tweetText"]');
      const links = content ? unique(Array.from(content.querySelectorAll('a[href]')).map(a => absolute(a.getAttribute('href'))).filter((v): v is string => !!v)) : [];
      const media = Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img, video')).filter(e => visible(e) && !quoteRoot?.contains(e)).map(e => ({
        type: e.tagName.toLowerCase() === 'video' ? 'video' : 'image',
        url: absolute(e.getAttribute('src')),
        poster: absolute(e.getAttribute('poster')),
        alt: e.getAttribute('alt'),
      }));
      return [{
        ...source, authorName: text(own('[data-testid="User-Name"]')).split('\n')[0] || null,
        text: text(content), createdAt: primaryTime?.getAttribute('datetime') ?? null,
        metrics: {
          replies: metric(own('[data-testid="reply"]')),
          reposts: metric(own('[data-testid="retweet"], [data-testid="unretweet"]')),
          likes: metric(own('[data-testid="like"], [data-testid="unlike"]')),
          views: metric(own('a[href$="/analytics"]')),
          bookmarks: metric(own('[data-testid="bookmark"], [data-testid="removeBookmark"]')),
        },
        liked: !!own('[data-testid="unlike"]'),
        reposted: !!own('[data-testid="unretweet"]'),
        bookmarked: !!own('[data-testid="removeBookmark"]'),
        socialContext: text(own('[data-testid="socialContext"]')) || null,
        quote: quoteSource ? { ...quoteSource, text: text(quoteRoot?.querySelector('[data-testid="tweetText"]')) } : null,
        media, links,
      }];
    });
  }
  if (kind === 'users') {
    return Array.from(main.querySelectorAll('[data-testid="UserCell"]')).filter(visible).flatMap(cell => {
      const links = Array.from(cell.querySelectorAll('a[href]')).filter(visible);
      const profile = links.map(a => ({ a, href: absolute(a.getAttribute('href')) })).find(({ href }) => href && /^\/[A-Za-z0-9_]{1,15}$/.test(new URL(href).pathname));
      if (!profile?.href) return [];
      const handle = new URL(profile.href).pathname.slice(1);
      return [{ id: handle.toLowerCase(), handle, url: `https://x.com/${handle}`, text: text(cell), name: text(profile.a).split('\n')[0] || null }];
    });
  }
  const selector = kind === 'trends' ? '[data-testid="trend"]' : '[data-testid="cellInnerDiv"]';
  return Array.from(main.querySelectorAll(selector)).filter(visible).flatMap(cell => {
    const value = text(cell);
    if (!value) return [];
    const links = unique(Array.from(cell.querySelectorAll('a[href]')).filter(visible).map(a => absolute(a.getAttribute('href'))).filter((v): v is string => !!v));
    const timestamp = cell.querySelector('time')?.getAttribute('datetime') ?? null;
    return [{ id: `${kind}-${hash(value + JSON.stringify(links) + timestamp)}`, text: value, links, timestamp }];
  });
}

export function extractProfile(handle: string): RecordData {
  const main = document.querySelector('main');
  const t = (selector: string) => (main?.querySelector(selector) as HTMLElement | null)?.innerText?.trim() || null;
  const linkText = (suffix: string) => {
    const links = Array.from(main?.querySelectorAll('a[href]') ?? []);
    return (links.find(a => new URL(a.getAttribute('href')!, location.href).pathname === `/${handle}/${suffix}`) as HTMLElement | undefined)?.innerText?.trim() || null;
  };
  return {
    id: handle.toLowerCase(), handle, url: `https://x.com/${handle}`,
    name: t('[data-testid="UserName"]')?.split('\n')[0] ?? null,
    bio: t('[data-testid="UserDescription"]'),
    location: t('[data-testid="UserLocation"]'), website: t('[data-testid="UserUrl"]'),
    joined: t('[data-testid="UserJoinDate"]'),
    followersText: linkText('verified_followers') ?? linkText('followers'),
    followingText: linkText('following'),
    capturedAt: new Date().toISOString(),
  };
}
