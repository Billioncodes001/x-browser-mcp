import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

export type Config = {
  dataDir: string;
  profileDir: string;
  headless: boolean;
  browserChannel?: 'chrome' | 'msedge';
  executablePath?: string;
  cdpUrl?: string;
  enableWrites: boolean;
  delayMs: number;
  actionTtlMs: number;
};
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const bool = (name: string, fallback: boolean) => {
    const v = env[name];
    if (v === undefined) return fallback;
    if (!['true', 'false', '1', '0'].includes(v)) throw new Error(`${name} must be true or false`);
    return v === 'true' || v === '1';
  };
  const absolute = (name: string, fallback: string) => {
    const value = env[name] ?? fallback;
    if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
    return resolve(value);
  };
  const dataDir = absolute('X_BROWSER_DATA_DIR', resolve(homedir(), '.x-browser-mcp'));
  const channel = z.enum(['chrome', 'msedge']).optional().parse(env.X_BROWSER_CHANNEL);
  const cdpUrl = env.X_BROWSER_CDP_URL;
  const executablePath = env.X_BROWSER_EXECUTABLE_PATH ? absolute('X_BROWSER_EXECUTABLE_PATH', '') : undefined;
  if ([!!channel, !!cdpUrl, !!executablePath].filter(Boolean).length > 1) throw new Error('Select only one of X_BROWSER_CHANNEL, X_BROWSER_CDP_URL, or X_BROWSER_EXECUTABLE_PATH');
  if (cdpUrl) {
    const u = new URL(cdpUrl);
    if (!['http:', 'ws:'].includes(u.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password) {
      throw new Error('X_BROWSER_CDP_URL must point to a loopback HTTP/WebSocket browser endpoint without credentials');
    }
  }
  return {
    dataDir,
    profileDir: absolute('X_BROWSER_PROFILE_DIR', resolve(dataDir, 'browser-profile')),
    headless: bool('X_BROWSER_HEADLESS', false),
    browserChannel: channel,
    executablePath,
    cdpUrl,
    enableWrites: bool('X_BROWSER_ENABLE_WRITES', false),
    delayMs: z.coerce.number().int().min(500).max(10000).parse(env.X_BROWSER_DELAY_MS ?? 1250),
    actionTtlMs: 10 * 60 * 1000,
  };
}
