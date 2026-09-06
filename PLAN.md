# X Browser MCP — implementation plan

## Product

A local MCP server that operates X through a browser the account owner signs into. It reads rendered pages and uses ordinary navigation, scrolling, typing, and clicking. No X API key is required. Browser access does not guarantee API-equivalent coverage: X controls which content loads, and DOM changes can break selectors.

## First release

1. **Browser session** — a dedicated persistent Chromium/Chrome/Edge profile, manual sign-in, session status, optional attachment to a loopback CDP browser, explicit close. Keep authentication outside the repository. Never copy a personal browser's cookie database.
2. **Reading** — search posts/people, home timeline, user posts/replies/media, individual post and visible conversation, profile, bookmarks, followers/following, notifications, and trends. Return normalized records with source URLs, timestamps, observed metrics, extraction warnings, and a stop reason.
3. **Research** — bounded scrolling, deduplication, reusable search definitions, persisted snapshots, comparison of observed snapshots, and JSON/CSV/Markdown export. A saved-search run is a repeatable automation unit that an MCP host or scheduler can invoke.
4. **Account actions** — prepare a concrete action tied to the current account, then execute it with its single-use ID. Support text posts/replies, likes, bookmarks, reposts, and follows. Verify visible outcomes; never automatically retry an uncertain write. Preparing an action does not submit it.
5. **Delivery** — CLI login/doctor, stdio MCP integration, example Codex configuration, tests, GitHub CI, usage documentation, and a clean Git repository ready to push once the destination is supplied.

## Architecture

`MCP tools → serialized service → X page adapter → Playwright persistent browser`

`Service → local artifact store → snapshots, saved searches, exports, action receipts`

- TypeScript, Node.js >=22, stable MCP SDK, Playwright, Zod.
- Browser operations run one at a time to prevent concurrent tools navigating over one another.
- Extract from the DOM only. Site text is untrusted data, never a new instruction or action authorization.
- Centralize selectors; reject unsupported destinations; cap item counts and scrolls; space operations apart.
- Treat login, CAPTCHA/checkpoints, rate limits, and unavailable content as explicit states. Let the user handle sign-in/checkpoints. No evasion, fingerprint spoofing, or challenge solvers.
- Default output directory lives outside the repo. Ignore profiles, cookies, exports, and local diagnostics in Git.
- Empty or stopped extraction never means a complete archive. Snapshot disappearance means “not observed,” not deleted.
- Writes require an opt-in server setting plus a prepared action. The MCP client must already have user authorization before calling execute; the ID itself is not consent.

## Verification

- DOM fixtures exercise post/profile/user extraction, quote attribution, text-only and media-only posts, missing metrics, count parsing, deduplication, scrolling, and page failures.
- Service tests cover operation serialization, prepared-action expiry/replay/account mismatch, output containment, CSV formula protection, and saved-search comparisons.
- Protocol test starts the built server over stdio and calls real MCP tools/resources.
- Browser fixture tests run real Chromium against local synthetic X pages; no live writes are sent.
- Live read-only verification requires a usable logged-in X session; document exactly what was and was not verified.

## Later capabilities

Media uploads and alt text, quote posts, polls, lists and communities, analytics aggregations, resumable long collections, account switching, and an optional local scheduling dashboard. DMs and bulk engagement need separate product design; neither is in the first release.

## Repository destination

Public repository: https://github.com/Billioncodes001/x-browser-mcp. Local project: `x-browser-mcp`.

## First implementation status

- Implemented: 24 MCP tools, session handling, bounded DOM collections, saved searches, comparisons, exports, and prepared account actions.
- Verified locally: strict build, 35 tests using browser fixtures and service checks, plus MCP protocol smoke test.
- Supplied: CLI, Codex configuration example, architecture/usage docs, GitHub CI.
- Pending: live logged-in X verification. See `docs/VALIDATION.md` for the exact scope of testing.
