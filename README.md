# X Browser MCP

[![CI](https://github.com/Billioncodes001/x-browser-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Billioncodes001/x-browser-mcp/actions/workflows/ci.yml)

**Turn the X pages you can access into organized, source-linked research.**

X Browser MCP is a local Model Context Protocol server and web dashboard for researchers, analysts and account owners. Sign in to a dedicated browser, collect rendered posts and profiles, revisit saved searches, and export the records you observed. It navigates, scrolls, types and clicks through the browser; no X developer API key is required. An AI assistant can use its 24 MCP tools, or you can operate the dashboard directly.

**v0.2 local dashboard alpha.** Includes a React/TypeScript dashboard for setup, research, saved searches, collections and reviewed account actions. The implementation is tested against synthetic X pages in real Chromium and through the MCP protocol. Live, logged-in X compatibility still needs verification. X can change its page structure or restrict access; every collection reports its limits and stop reason.

[Use cases](#use-cases) · [Installation](#install-and-sign-in) · [Dashboard](#local-web-dashboard) · [Codex setup](#connect-to-codex) · [Workflows](#example-workflows) · [Configuration](#configuration) · [Troubleshooting](#troubleshooting)

## Use cases

| Use case                           | Practical workflow                                                                                    | Deliverable                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Topic and product research         | Search a term or phrase, inspect original posts, and export the sample                                | A local collection with source URLs, capture times and coverage warnings           |
| Following an announcement          | Read a profile's posts or a conversation page and retain the observed context                         | A snapshot that can be inspected later without rerunning the collection            |
| Repeatable brand or issue tracking | Save a query and rerun it manually or from an existing scheduler                                      | Added, changed and not-observed records compared with the prior successful sample  |
| Personal research organization     | Collect bookmarks, timelines or visible account connections                                           | JSON, CSV or Markdown for a spreadsheet, notebook or downstream analysis           |
| Reviewed account maintenance       | Prepare one post, reply, follow or engagement action; inspect the preview and explicitly authorize it | A single attempted action and a persisted outcome receipt                          |
| AI-assisted research               | Connect an MCP host and request a bounded collection with original source citations                   | Structured records the assistant can summarize while reporting the sample's limits |

This project collects observations; it does not fact-check them or provide a complete X archive. AI summaries are produced by your MCP host, using that host's model and processing settings. Account actions are disabled by default.

## What it does

- Search posts or people with native X query operators; read home timelines, profiles, user posts/replies/media, conversation pages, bookmarks, followers/following, notifications, and trends.
- Save bounded, deduplicated collections as snapshots with original URLs and capture times.
- Save reusable searches, rerun them, and compare newly observed or changed records.
- Export snapshots as JSON, CSV, or Markdown. CSV exports protect against spreadsheet formula execution.
- Prepare and execute text posts/replies, likes/unlikes, bookmarks/unbookmarks, reposts/undo reposts, and follows/unfollows, with account checks and action receipts.
- Diagnose the session and capture a screenshot of the signed-in page.

## Install and sign in

Requires Git, Node.js 22.12 or later with npm, and a Chromium-compatible browser. An X account and an interactive browser session are needed for account-gated pages. Install from this repository; the package is not published to npm.

```sh
git clone https://github.com/Billioncodes001/x-browser-mcp.git
cd x-browser-mcp
npm ci
npx playwright install --no-shell chromium
npm run build
```

On Linux, use `npx playwright install --with-deps --no-shell chromium` if browser system dependencies are missing.

Choose one way to begin:

- **Dashboard:** run `npm run dashboard`, open [127.0.0.1:8792](http://127.0.0.1:8792), then use **Browser setup → Open X browser** and sign in directly.
- **MCP first:** run `npm run login`, sign in in the window that opens, then follow [Connect to Codex](#connect-to-codex). The login command closes the window after detecting a signed-in account.

The dedicated profile persists outside the repository. Close any running dashboard or MCP process before running a separate login command against the same profile.

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

## Local web dashboard

After installation and `npm run build`, start the dashboard:

```sh
npm run dashboard
```

Open **http://127.0.0.1:8792**. Under **Browser setup**, choose Playwright Chromium or installed Chrome / Edge, save the preferences, and open the X browser. Sign in directly in that window. The dashboard never asks for an X password, OTP or cookie file. Use a visible browser for first-time sign-in. Close the browser session before changing preferences; its saved login is retained.

The dashboard includes:

- **Overview:** actual session state, recent collections and saved searches.
- **Research desk:** searches, home timelines, profiles, conversations, bookmarks, followers/following, notifications and trends, with collection bounds.
- **Saved searches:** create, edit, remove and rerun definitions. Editing resets the comparison baseline; removing a definition keeps its collections. Runs are requested manually, not background schedules.
- **Collections:** inspect the latest 100 snapshots, filter captured records, compare two matching samples, and download JSON, CSV or Markdown. All snapshots remain accessible through MCP by ID.
- **Account actions:** exact account/target/content previews, cancellation, explicit confirmation and persisted receipts. Execution requires writes enabled. Failed or uncertain attempts are not retried automatically.
- **Browser setup:** persistent preferences, session controls, local paths, private session screenshots and a generated MCP configuration.

For **MCP and dashboard together**, add `"--dashboard"` after `"serve"` in your MCP arguments, or copy the configuration from Browser setup. Both then share the same service and serialized browser queue:

```toml
args = ["C:/path/to/x-browser-mcp/dist/cli.js", "serve", "--dashboard"]
```

Stop the standalone dashboard before starting this shared configuration. Do not launch two processes against the same browser profile. `serve` without the flag keeps its original stdio-only behavior. The dashboard address is written to stderr so it does not interfere with the MCP protocol. Change the local port with `X_BROWSER_DASHBOARD_PORT`.

Preferences are stored in `<data root>/dashboard-settings.json`, outside the repository. Explicit environment variables take precedence and their fields are locked in the interface. The default remains visible browsing with account actions disabled. An environment setting of `X_BROWSER_ENABLE_WRITES=false` keeps that restriction even if preferences previously enabled writes.

The dashboard binds **only to 127.0.0.1** and expects that exact origin. Each server process issues an in-memory request token through its local HTML page; API requests require that token. Host, Origin and browser fetch metadata checks reject cross-site requests and rebinding attempts. Frames are blocked, responses containing local data are not cached, request bodies are bounded, and downloads accept validated snapshot IDs rather than arbitrary paths. This is a single-user local interface, not a remote or multi-user authenticated service; other trusted processes on the computer can access its local page. Do not expose it through a public proxy.

The interface uses React 19, strict TypeScript, Tailwind CSS 4 and Motion. Its graphite masthead, warm paper surfaces and burnt-orange accents give it a research-workspace identity. Fonts and imagery are local, navigation supports keyboards and phones, and transitions respect reduced-motion settings. See [image and font provenance](docs/DASHBOARD-ASSETS.md).

## Example workflows

### Research and export

In the dashboard, open **Research desk**, select search, enter a query, set the item/scroll bounds, and choose **Collect records**. Open the resulting collection to inspect records or download an export.

The equivalent MCP calls use these arguments after `x_session_open` and `x_session_status`:

1. `x_search`: `{"query":"from:openai -is:retweet","tab":"latest","limit":40,"maxScrolls":8}`
2. Retain the returned `id`. Inspect `data.items`, `data.sourceUrl`, `data.capturedAt`, `data.warnings`, and `data.stopReason`. Use original post URLs when citing results.
3. `x_export`: `{"snapshotId":"<returned snapshot UUID>","format":"csv"}`. The tool returns an absolute local export path; the dashboard downloads the file directly.

Use `format: "json"` for downstream processing or `format: "md"` for a research note. Exporting a saved snapshot does not recollect X.

### Repeat a saved search

1. `x_saved_search_save`: `{"name":"product-news","query":"\"product name\"","tab":"latest"}`
2. Call `x_saved_search_run` with `{"name":"product-news"}` whenever a new sample is needed.
3. Examine `comparison.added`, `comparison.changed`, and `comparison.notObserved`.

The first successful sample has no prior comparison. Empty or blocked runs are saved for inspection but leave the prior baseline unchanged. A record absent from a later sample is not proof that its author deleted it.

For an existing scheduler, `node dist/cli.js run-search product-news` performs one run, prints JSON, and closes its browser. This project does not create a background schedule. Do not run multiple processes against one profile. A scheduled run needs a persisted login and can use `X_BROWSER_HEADLESS=true` after manual login, if X permits that browser session.

### Inspect an account or conversation

Use `x_profile` with `{"handle":"openai"}` for the visible profile header, or `x_user_posts` with `{"handle":"openai","tab":"posts","limit":20,"maxScrolls":4}` for a sample of posts. `x_thread` accepts a single `https://x.com/<handle>/status/<id>` URL. Select the equivalent source in **Research desk** to use these workflows without an MCP client.

The returned conversation page can include recommendations and promoted content. Inspect each original source before treating records as replies in a thread.

### Ask your AI assistant

After connecting the MCP server, an example request is:

> Search X for discussions of our product using a maximum of 40 posts and 8 scrolls. Summarize recurring themes, cite original posts, explain what the sample may miss, and export the collection as CSV. Do not perform account actions.

Replace the product description with a concrete query. The server supplies records; your host supplies the AI analysis. Retrieved page text must be treated as untrusted content, including any instructions embedded in a post.

### Prepare and review an account action

Enable `X_BROWSER_ENABLE_WRITES=true` in the MCP server environment and restart it. Preparing actions is allowed while writes are disabled; execution is blocked.

1. Call `x_action_prepare` with, for example, `{"action":"reply","target":"https://x.com/example/status/123","text":"The exact reply","expectedAccount":"your_handle"}`.
2. Review the returned account, target, and content. The MCP client must have the user's authorization for this action before execution.
3. Call `x_action_execute` with `{"id":"<prepared action UUID>"}`. It expires after 10 minutes and permits one attempt. Use the same argument with `x_action_cancel` to discard it.
4. If there is an error, consult `x_action_receipt` and inspect X. An uncertain submission is never automatically retried.

The server does not authenticate a human approval itself; the MCP host is responsible for obtaining authorization. The two-step flow binds execution to a concrete preview and account. There is no bulk-engagement tool or arbitrary JavaScript/click tool.

### Use research with Claim Verifier

For evidence-backed assessments, copy an observed post's text and original URL into the [Claim Verifier](https://github.com/Billioncodes001/social-claim-verifier) Demo lab, then provide evidence URLs or authorize configured search. The projects currently run independently; there is no automatic bridge, shared account connection or automatic publishing of findings.

## Tools

| Group          | Tools                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Session        | `x_session_open`, `x_session_status`, `x_session_close`, `x_screenshot`                                                          |
| Read           | `x_search`, `x_timeline`, `x_profile`, `x_user_posts`, `x_thread`, `x_bookmarks`, `x_connections`, `x_notifications`, `x_trends` |
| Saved searches | `x_saved_search_save`, `x_saved_search_list`, `x_saved_search_run`                                                               |
| Artifacts      | `x_snapshot_list`, `x_snapshot_read`, `x_snapshot_compare`, `x_export`                                                           |
| Actions        | `x_action_prepare`, `x_action_execute`, `x_action_cancel`, `x_action_receipt`                                                    |

There is also a `research-x` prompt and the `x-browser://guide` resource.

## Configuration

Environment variables are read when the process starts and override saved dashboard preferences. `.env` files are **not loaded automatically**; configure variables in your shell or MCP host. See [.env.example](.env.example).

| Variable                    | Default                       | Purpose                                                                               |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `X_BROWSER_DATA_DIR`        | `~/.x-browser-mcp`            | Absolute root for snapshots, searches, exports, receipts, and default browser profile |
| `X_BROWSER_PROFILE_DIR`     | `<data root>/browser-profile` | Absolute path to a dedicated persistent browser profile                               |
| `X_BROWSER_CHANNEL`         | unset                         | Installed `chrome` or `msedge`                                                        |
| `X_BROWSER_EXECUTABLE_PATH` | unset                         | Explicit absolute path to a Chromium-compatible executable                            |
| `X_BROWSER_CDP_URL`         | unset                         | Attach to an already configured loopback debugging endpoint                           |
| `X_BROWSER_HEADLESS`        | `false`                       | Use a hidden browser after manual sign-in                                             |
| `X_BROWSER_ENABLE_WRITES`   | `false`                       | Enable execution of prepared account actions                                          |
| `X_BROWSER_DELAY_MS`        | `1250`                        | Delay between page operations; range 500–10000 ms                                     |
| `X_BROWSER_DASHBOARD_PORT`  | `8792`                        | Local port for `dashboard` or `serve --dashboard`                                     |

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

Authentication lives in the local browser profile. Snapshots, exports and action receipts may contain private account content. Their files stay local and are ignored by Git. When an MCP host calls a tool, its returned records are supplied to that host; a hosted assistant may process them according to its own settings. Local storage does not mean that using a hosted assistant is offline processing.

The default MCP server is stdio-only; the optional dashboard adds the loopback-only listener described above. Back up or move the data directory only while its browser is closed. Use a separate data/profile directory for each account, and keep profiles, exports and receipts out of public repositories.

## Troubleshooting

| Symptom                                        | What to check                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Browser executable is missing                  | Install managed Chromium with the command above, or select installed Chrome/Edge consistently in the dashboard and MCP environment |
| Profile is already in use                      | Stop the other process using that profile; use `serve --dashboard` for one shared MCP/dashboard session                            |
| Dashboard asks to reload after a restart       | Choose **Reload workspace**; the local API token changes each time the server starts                                               |
| Dashboard does not load after frontend changes | Run `npm run build:dashboard`, restart the dashboard process, then reload the page                                                 |
| Port 8792 is occupied                          | Set `X_BROWSER_DASHBOARD_PORT` to an available local port before starting                                                          |
| Preferences cannot be edited                   | Close the X browser; fields controlled by explicit environment variables remain locked                                             |
| Login, checkpoint or rate-limit status appears | Complete sign-in/checkpoints manually or wait for X to allow access, then check session status again                               |
| Empty or unexpectedly small collection         | Inspect `warnings` and `stopReason`; access restrictions, loading failures and selector changes can all limit results              |
| Action is refused or its outcome is uncertain  | Check writes opt-in, account identity and expiry. Read the receipt and inspect X before considering another attempt                |

`npm run doctor` helps inspect configuration; it does not verify a live sign-in or guarantee that current X selectors work.

## Development and verification

```sh
npm ci
npx playwright install --no-shell chromium
npm run check
```

The X adapter tests use synthetic fixtures in real Chromium and intercept their X requests. The dashboard browser suite starts an isolated temporary backend with a simulated X browser adapter and exercises real dashboard HTTP routes and storage. Neither suite posts to a real X account. To use another installed Chromium binary for the adapter tests, set `TEST_BROWSER_EXECUTABLE` to its absolute path.

`npm run check` runs both builds, 41 adapter/core/HTTP tests, a shared MCP/dashboard protocol test and six dashboard browser workflows. The browser suite checks five widths (320, 390, 768, 1024 and 1440 px), desktop/phone automated accessibility, keyboard navigation, saved setup, collections, downloads and action confirmation. Use `npm run build:dashboard` after frontend edits, then restart the dashboard to load the new asset manifest. Vite source is in `dashboard/src/`; generated assets in `dashboard-dist/` are excluded from Git.

## Project structure and contribution

| Location                                           | Responsibility                                              |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `src/server.ts`, `src/service.ts`                  | MCP tools, shared operations and action lifecycle           |
| `src/browser.ts`, `src/dom.ts`, `src/collector.ts` | Browser ownership, extraction and bounded collection        |
| `src/store.ts`, `src/config.ts`                    | Local artifacts and configuration                           |
| `src/dashboard.ts`, `dashboard/src/`               | Local HTTP API and React dashboard                          |
| `test/`, `dashboard/tests/`                        | Adapter, service, protocol, HTTP and interface verification |
| `examples/codex.toml`                              | Copyable MCP configuration                                  |

For a bug report, include the version, OS, browser channel, affected tool and sanitized warnings/stop reason. Do not include login profiles, tokens or private post content. Changes to browser behavior should include a synthetic fixture; new write operations must use the existing prepared-action lifecycle. Run `npm run check` before submitting a pull request.

See [the architecture](docs/ARCHITECTURE.md), [validation scope and results](docs/VALIDATION.md), and [the original plan](PLAN.md). GitHub CI runs the full check on Linux and Windows. The README and current tool schemas describe implemented behavior; planned items are not released capabilities.

Planned extensions include media/alt text, quote posts, polls, lists, communities, resumable collections, and richer analysis. DMs and bulk engagement are outside this first release.

## Source references

- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server)
- [Playwright persistent browser contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp/)

This project is independent of X and OpenAI.
