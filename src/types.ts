export type RecordData = { id: string; [key: string]: unknown };
export type RecordKind = 'posts' | 'users' | 'notifications' | 'trends';
export type StopReason = 'limit' | 'scroll_limit' | 'time_limit' | 'no_new_items' | 'empty' | 'blocked';
export type Collection = {
  kind: RecordKind;
  sourceUrl: string;
  sourceKey?: string;
  requestedLimit?: number;
  maxScrolls?: number;
  capturedAt: string;
  items: RecordData[];
  stopReason: StopReason;
  scrolls: number;
  warnings: string[];
  complete: false;
};
export type SessionState = {
  state: 'closed' | 'logged_in' | 'login_required' | 'checkpoint' | 'rate_limited' | 'unavailable' | 'unknown';
  account: string | null;
  url: string | null;
  message: string;
};
export type ReadRequest = {
  source: 'search' | 'timeline' | 'profile_posts' | 'thread' | 'bookmarks' | 'connections' | 'notifications' | 'trends';
  query?: string;
  handle?: string;
  url?: string;
  tab?: string;
  limit: number;
  maxScrolls: number;
};
export type ActionInput = {
  action: 'post' | 'reply' | 'like' | 'unlike' | 'bookmark' | 'unbookmark' | 'repost' | 'unrepost' | 'follow' | 'unfollow';
  target?: string;
  text?: string;
};
export type PreparedAction = {
  id: string;
  account: string;
  input: ActionInput;
  preview: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
};
export interface BrowserPort {
  open(): Promise<SessionState>;
  status(): Promise<SessionState>;
  close(): Promise<void>;
  collect(request: ReadRequest): Promise<Collection>;
  profile(handle: string): Promise<RecordData>;
  preview(input: ActionInput): Promise<Record<string, unknown>>;
  execute(input: ActionInput, account: string): Promise<Record<string, unknown>>;
  screenshot(): Promise<Buffer>;
}
