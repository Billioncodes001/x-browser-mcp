# Validation record

## v0.2 dashboard — 2026-09-06

Validated on Windows using Node.js 24.16.0 and Playwright 1.63.0's managed Chromium. The adapter now selects the full Chromium channel for headless operation; a separate headless-shell download is unnecessary.

- Strict server and React/TypeScript production builds pass.
- **41 tests pass:** 20 real Chromium tests using intercepted synthetic X pages, 15 core/service/storage tests, and 6 local HTTP/security/persistence tests.
- **Six dashboard browser scenarios pass:** every route, saved setup and session controls, saved-search execution, record inspection and CSV download, direct collection and comparisons, action preview/confirmation/receipts, mobile keyboard focus and Escape dismissal.
- Five viewport widths checked: 320, 390, 768, 1024 and 1440 pixels. Final desktop and phone screenshots were visually inspected after animations settled.
- Automated axe checks report zero WCAG A/AA violations on the overview at desktop and phone widths. This is a bounded automated check, not a complete accessibility certification.
- The protocol test starts **MCP and dashboard in one process**, discovers 24 tools, accesses the guide/prompt, exercises validation and writes-disabled behavior, and verifies that an MCP-saved search appears in the dashboard API.
- HTTP tests cover request-token, Origin, Host and fetch-metadata guards; payload limits; private/traversal path rejection; persistent settings and environment precedence; safe CSV exports; action confirmation, replay prevention and uncertain receipts.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities at validation time.
- The actual standalone dashboard starts on `127.0.0.1:8792` without opening or modifying an X account.

Dashboard browser scenarios use a temporary backend with a **simulated X adapter**. Existing adapter tests use real Chromium with intercepted synthetic X pages. No real posts, replies, likes or follows were sent. Test data, profiles and session tokens are excluded from the source repository.

Live signed-in X extraction and desired write workflows still require acceptance testing with a designated account and explicitly authorized actions. This remains an alpha, and collections remain bounded samples. CI independently runs the complete suite on Windows and Linux; browser reports and screenshots are attached to each run.

## Historical v0.1 validation

Date: 2026-09-05 (America/Los_Angeles)

## Completed locally

- Node.js 24.16.0 on Windows.
- Strict TypeScript build passes.
- 35 tests pass: 20 browser fixture tests and 15 core/service/storage tests.
- Real Chromium runs synthetic X pages with all requests intercepted. Tests cover post/quote/media extraction, profile/users, notification/trend records, session failures, exact-target likes, bookmarks, reposts, follows/unfollows, posts/replies, and draft preservation.
- Core tests cover input validation, endpoint restrictions, collection budgets, deduplication, serialization, export containment/formula protection, snapshot semantics, action identity/expiry/replay, uncertain receipts, and saved-search baselines.
- A stdio client starts the built server and verifies 24 advertised tools, resource/prompt access, local saved-search persistence, validation failures, and writes-disabled errors.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities at validation time.
- CLI help and doctor execute successfully.
- No real posts, replies, likes, follows, or other live account writes were sent during testing.

## Browser runtime

The download of the Playwright 1.63.0 Chromium build timed out. Browser tests used an already installed Playwright Chromium build 1223 via `TEST_BROWSER_EXECUTABLE`. Its use is explicit; no personal profile or cookies were imported. The default Playwright executable for this project still requires a successful browser installation, or an explicit channel/executable setting.

Test command when using an existing Chromium executable:

```powershell
$env:TEST_BROWSER_EXECUTABLE = "C:/absolute/path/to/chrome.exe"
npm run check
```

## Pending

- Live, logged-in X extraction and selector verification. The available Edge X page was signed out.
- Live write verification against a designated test account and specific authorized content. Fixture success is not a claim that every current X UI action works.
- Linux/Windows GitHub CI is separate from this local validation record; see the repository's [Actions page](https://github.com/Billioncodes001/x-browser-mcp/actions) for current results.

The current release should be treated as an alpha until live read verification and the desired account workflows are exercised.
