#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { chromium } from 'playwright';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { XBrowser } from './browser.js';
import { ArtifactStore } from './store.js';
import { XService } from './service.js';
import { createServer } from './server.js';
import { errorInfo } from './errors.js';
import { startDashboard } from './dashboard.js';

async function main() {
  const command = process.argv[2] ?? 'serve';
  if (['--help', '-h', 'help'].includes(command)) {
    process.stdout.write('X Browser MCP\n\nCommands:\n  serve                 Start the stdio MCP server (default)\n  serve --dashboard     Share one session between MCP and the local dashboard\n  dashboard             Start the standalone local dashboard on port 8792\n  login                 Open a visible browser for manual X sign-in\n  doctor                Check local setup without opening X\n  run-search <name>      Run a saved search once, emit JSON, then close\n\nSet X_BROWSER_DASHBOARD_PORT to choose a local port.\nSee README.md for configuration and Codex setup.\n');
    return;
  }
  const config = loadConfig();
  const browser = new XBrowser(command === 'login' ? { ...config, headless: false } : config);
  const service = new XService(browser, new ArtifactStore(config.dataDir), config);
  let dashboard: Awaited<ReturnType<typeof startDashboard>> | undefined;
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await browser.close().catch(() => undefined);
    await dashboard?.close().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (command === 'doctor') {
    const browserInstalled = await access(config.executablePath ?? chromium.executablePath()).then(() => true, () => false);
    process.stdout.write(JSON.stringify({ version: '0.2.0', node: process.version, dataDir: config.dataDir, profileDir: config.profileDir, browser: config.cdpUrl ? 'attached loopback CDP' : config.browserChannel ?? config.executablePath ?? 'chromium', configuredExecutableAvailable: browserInstalled, writesEnabled: config.enableWrites, liveSessionChecked: false, next: 'Run npm run login, then connect this server to your MCP host.' }, null, 2) + '\n');
    return;
  }
  if (command === 'login') {
    try {
      let state = await browser.open();
      process.stderr.write('Complete X sign-in in the opened browser. No credentials are read by the CLI. The window closes after login is detected.\n');
      const deadline = Date.now() + 10 * 60 * 1000;
      while (state.state !== 'logged_in' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        state = await browser.status();
      }
      process.stdout.write(JSON.stringify(state, null, 2) + '\n');
      if (state.state !== 'logged_in') process.exitCode = 1;
    } finally { await browser.close(); }
    if (config.cdpUrl) process.exit(process.exitCode ?? 0);
    return;
  }
  if (command === 'run-search') {
    if (!process.argv[3]) throw new Error('Usage: x-browser-mcp run-search <saved-search-name>');
    try { await service.open(); process.stdout.write(JSON.stringify(await service.runSearch(process.argv[3]), null, 2) + '\n'); }
    finally { await browser.close(); }
    if (config.cdpUrl) process.exit(process.exitCode ?? 0);
    return;
  }
  if (command === 'dashboard' || (command === 'serve' && process.argv.includes('--dashboard'))) {
    dashboard = await startDashboard(service,{port:Number(process.env.X_BROWSER_DASHBOARD_PORT ?? 8792),mode:command === 'serve' ? 'shared' : 'standalone'});
    process.stderr.write(`X Browser dashboard: ${dashboard.url}\n`);
    if (command === 'dashboard') return;
  }
  if (command !== 'serve') throw new Error('Unknown command. Run x-browser-mcp --help.');
  const server = createServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const previousOnClose = transport.onclose;
  transport.onclose = () => { previousOnClose?.(); void shutdown(); };
  process.stderr.write('X Browser MCP ready. Browser opens only when requested.\n');
}
main().catch(error => { process.stderr.write(JSON.stringify(errorInfo(error)) + '\n', () => process.exit(1)); });
