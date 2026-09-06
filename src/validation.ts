import { z } from 'zod';
import type { ActionInput, ReadRequest, RecordKind } from './types.js';

export const handleSchema = z.string().trim().transform(v => v.replace(/^@/, '')).pipe(z.string().regex(/^[A-Za-z0-9_]{1,15}$/, 'Use an X handle, not a URL'));
export const nameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/, 'Use 1–64 letters, numbers, hyphens, or underscores');
export const limitSchema = z.number().int().min(1).max(200).default(40);
export const scrollSchema = z.number().int().min(0).max(30).default(8);
export const actionSchema = z.object({
  action: z.enum(['post', 'reply', 'like', 'unlike', 'bookmark', 'unbookmark', 'repost', 'unrepost', 'follow', 'unfollow']),
  target: z.string().max(300).optional(),
  text: z.string().min(1).max(25000).optional(),
}).strict();
export function postUrl(value: string): string {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(u.hostname) || u.username || u.password || u.port) throw new Error('Use an https://x.com/<handle>/status/<id> post URL');
  const match = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/);
  if (!match) throw new Error('Expected a single X post URL');
  return `https://x.com/${match[1]}/status/${match[2]}`;
}
export function normalizeAction(value: ActionInput): ActionInput {
  const input = actionSchema.parse(value);
  if (input.action === 'post' || input.action === 'reply') {
    if (!input.text?.trim()) throw new Error('Post/reply text cannot be blank');
  } else if (input.text !== undefined) throw new Error('Text is only valid for posts and replies');
  if (input.action === 'post') {
    if (input.target !== undefined) throw new Error('A new post has no target');
    return input;
  }
  if (!input.target) throw new Error('This action needs a target');
  input.target = ['follow', 'unfollow'].includes(input.action) ? handleSchema.parse(input.target) : postUrl(input.target);
  return input;
}
export function destination(r: ReadRequest): { url: string; kind: RecordKind; selectedTab?: string } {
  switch (r.source) {
    case 'search': {
      const query = z.string().trim().min(1).max(1000).parse(r.query);
      const tab = z.enum(['latest', 'top', 'people', 'photos', 'videos']).parse(r.tab ?? 'latest');
      const filters = { latest: 'live', top: '', people: 'user', photos: 'image', videos: 'video' };
      return { url: `https://x.com/search?${new URLSearchParams({ q: query, src: 'typed_query', f: filters[tab] })}`, kind: tab === 'people' ? 'users' : 'posts' };
    }
    case 'timeline': return { url: 'https://x.com/home', kind: 'posts', selectedTab: z.enum(['Following', 'For you']).parse(r.tab ?? 'Following') };
    case 'profile_posts': {
      const h = handleSchema.parse(r.handle);
      const tab = z.enum(['posts', 'replies', 'media']).parse(r.tab ?? 'posts');
      return { url: `https://x.com/${h}${tab === 'replies' ? '/with_replies' : tab === 'media' ? '/media' : ''}`, kind: 'posts' };
    }
    case 'thread': return { url: postUrl(r.url ?? ''), kind: 'posts' };
    case 'bookmarks': return { url: 'https://x.com/i/bookmarks', kind: 'posts' };
    case 'connections': return { url: `https://x.com/${handleSchema.parse(r.handle)}/${z.enum(['followers', 'following']).parse(r.tab ?? 'followers')}`, kind: 'users' };
    case 'notifications': return { url: `https://x.com/notifications${z.enum(['all', 'mentions']).parse(r.tab ?? 'all') === 'mentions' ? '/mentions' : ''}`, kind: 'notifications' };
    case 'trends': return { url: 'https://x.com/explore/tabs/trending', kind: 'trends' };
  }
}
