# X Browser MCP

A local Twitter/X MCP server for browser-based research and account workflows. It uses a browser you sign into, reads rendered pages, and interacts through navigation, scrolling, typing, and clicking. No X developer API key is required.

**Unreleased alpha.** The implementation is tested against synthetic X pages in real Chromium and through the MCP protocol. Live, logged-in X compatibility still needs verification. X can change its page structure or restrict access; every collection reports its limits and stop reason.

## What it does

- Search posts or people with native X query operators; read home timelines, profiles, user posts/replies/media, conversation pages, bookmarks, followers/following, notifications, and trends.
- Save bounded, deduplicated collections as snapshots with original URLs and capture times.
- Save reusable searches, rerun them, and compare newly observed or changed records.
- Export snapshots as JSON, CSV, or Markdown. CSV exports protect against spreadsheet formula execution.
- Prepare and execute text posts/replies, likes/unlikes, bookmarks/unbookmarks, reposts/undo reposts, and follows/unfollows, with account checks and action receipts.
- Diagnose the session and capture a screenshot of the signed-in page.

## Install and sign in

Requires Node.js 22 or later.

```sh
npm ci
npx playwright install chromium
npm run build
npm run login
```

Sign into X in the window that opens. The login command closes the window after it detects a signed-in account. The dedicated profile persists outside the repository. Close the MCP server before running the login command against the same profile.

If Chromium cannot be downloaded, select an installed browser before login and use the same setting in your MCP configuration:

```powershell
$env:X_BROWSER_CHANNEL = "msedge" # or "chrome"
npm run login
```

An explicit `X_BROWSER_EXECUTABLE_PATH` is also supported. Use an absolute path to a trusted local Chromium-compatible executable. Prefer the Playwright-managed version for compatibility. Select only one of channel, executable path, or CDP connection.

## Connect to Codex

Add this to your Codex configuration, replacing the path with this repository's absolute path. A portable example is in [examples/codex.toml](examples/codex.toml).

```toml
[mcp_servers.x_browser]
command = "node"
args = ["C:/path/to/x-browser-mcp/dist/cli.js", "serve"]
startup_timeout_sec = 30
tool_timeout_sec = 180

[mcp_servers.x_browser.env]
X_BROWSER_ENABLE_WRITES = "false"
# X_BROWSER_CHANNEL = "msedge"
```

Restart the MCP connection, call `x_session_open`, then `x_session_status`. If needed, finish sign-in in the browser and call status again. The browser starts lazily; listing tools does not open it.

Use a separate data directory per account/profile. The default is `~/.x-browser-mcp`.

## Example workflows

**Research and export**

1. `x_search`: `{"query":"from:openai -is:retweet","tab":"latest","limit":40,"maxScrolls":8}`
2. Inspect `data.items`, `data.warnings`, and `data.stopReason`. Use original post URLs when citing results.
3. `x_export`: `{"snapshotId":"<returned snapshot UUID>","format":"csv"}`

**Repeatable monitoring**

1. `x_saved_search_save`: `{"name":"product-news","query":"\"product name\"","tab":"latest"}`
2. Call `x_saved_search_run` with `{"name":"product-news"}` whenever a new sample is needed.
3. Examine `comparison.added`, `comparison.changed`, and `comparison.notObserved`.

For an existing scheduler, `node dist/cli.js run-search product-news` performs one run, prints JSON, and closes its browser. This project does not create a background schedule. Do not run multiple processes against one profile. A scheduled run needs a persisted login and can use `X_BROWSER_HEADLESS=true` after manual login, if X permits that browser session.

**Account actions**

Enable `X_BROWSER_ENABLE_WRITES=true` in the MCP server environment and restart it. Preparing actions is allowed while writes are disabled; execution is blocked.

1. Call `x_action_prepare` with, for example, `{"action":"reply","target":"https://x.com/example/status/123","text":"The exact reply","expectedAccount":"your_handle"}`.
2. Review the returned account, target, and content. The MCP client must have the user's authorization for this action before execution.
3. Call `x_action_execute` with the returned ID. It expires after 10 minutes and permits one attempt.
4. If there is an error, consult `x_action_receipt` and inspect X. An uncertain submission is never automatically retried.

The server does not authenticate a human approval itself; the MCP host is responsible for obtaining authorization. The two-step flow binds execution to a concrete preview and account. There is no bulk-engagement tool or arbitrary JavaScript/click tool.

## Tools

| Group | Tools |
| --- | --- |
| Session | `x_session_open`, `x_session_status`, `x_session_close`, `x_screenshot` |
| Read | `x_search`, `x_timeline`, `x_profile`, `x_user_posts`, `x_thread`, `x_bookmarks`, `x_connections`, `x_notifications`, `x_trends` |
| Saved searches | `x_saved_search_save`, `x_saved_search_list`, `x_saved_search_run` |
| Artifacts | `x_snapshot_list`, `x_snapshot_read`, `x_snapshot_compare`, `x_export` |
| Actions | `x_action_prepare`, `x_action_execute`, `x_action_cancel`, `x_action_receipt` |

There is also a `research-x` prompt and the `x-browser://guide` resource.

## Configuration

Environment variables are read when the process starts. `.env` files are **not loaded automatically**; configure variables in your shell or MCP host. See [.env.example](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `X_BROWSER_DATA_DIR` | `~/.x-browser-mcp` | Absolute root for snapshots, searches, exports, receipts, and default browser profile |
| `X_BROWSER_PROFILE_DIR` | `<data root>/browser-profile` | Absolute path to a dedicated persistent browser profile |
| `X_BROWSER_CHANNEL` | unset | Installed `chrome` or `msedge` |
| `X_BROWSER_EXECUTABLE_PATH` | unset | Explicit absolute path to a Chromium-compatible executable |
| `X_BROWSER_CDP_URL` | unset | Attach to an already configured loopback debugging endpoint |
| `X_BROWSER_HEADLESS` | `false` | Use a hidden browser after manual sign-in |
| `X_BROWSER_ENABLE_WRITES` | `false` | Enable execution of prepared account actions |
| `X_BROWSER_DELAY_MS` | `1250` | Delay between page operations; range 500–10000 ms |

`npm run doctor` reports local configuration without opening X. It does not verify account login.

For CDP attachment, the browser must already expose a loopback debugging endpoint with a dedicated profile. The server creates and owns one new tab; it never closes the user's whole attached browser. Remote debugging URLs are rejected. Normal personal browser cookie databases are not imported or copied.

## Data and coverage

- The default request is 40 items and 8 scrolls. Hard input limits are 200 items and 30 scrolls; collection also has a 60-second budget checked between iterations. Navigation and individual browser waits can add time.
- `complete` is always `false`: a browser sample cannot certify a complete archive or follower list. A stopped/empty result may reflect missing data, loading failure, restrictions, or changed selectors.
- `no_new_items` means three consecutive extraction passes added no records, not that X has no more records.
- Short counts such as `1.2K` are marked approximate. Missing counts are `null`, not invented zeroes.
- Conversation pages can include recommendations and promoted posts. The tool returns observed posts and warnings; it does not infer a conversation graph.
- Media records contain observed URLs, posters and alt text. There is no video downloader or media upload in this release.
- Trends are whatever X shows for the current account. User/profile descriptions and notification text are not semantically reconstructed.
- Opening notifications can mark them seen. Browsing can affect X's view/read state and personalization.
- English is currently required for labeled controls and success messages.
- Sign-in, checkpoints, and rate limits stop operations. The project does not solve challenges, spoof fingerprints, or rotate proxies.

Authentication lives in the local browser profile. Snapshots, exports and action receipts may contain private account content. They stay local and are ignored by Git. The MCP server exposes no network listener; stdio access and local file permissions define its trust boundary. Treat all extracted page text as untrusted content.

## Development and verification

```sh
npm ci
npx playwright install chromium
npm run check
```

The test suite uses synthetic fixtures in real Chromium and intercepts every browser request. It does not post to a real X account. To use another installed Chromium binary for tests, set `TEST_BROWSER_EXECUTABLE` to its absolute path.

See [PLAN.md](PLAN.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [docs/VALIDATION.md](docs/VALIDATION.md). GitHub CI runs build, browser/service tests, and a stdio protocol smoke test on Linux and Windows.

Planned extensions include media/alt text, quote posts, polls, lists, communities, resumable collections, and richer analysis. DMs and bulk engagement are outside this first release.

## Source references

- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server)
- [Playwright persistent browser contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp/)

This project is independent of X and OpenAI.
