# Validation record

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
