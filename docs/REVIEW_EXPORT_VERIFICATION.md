# Reviewed Research Export

## Scope

Local one-time improvement, 2026-09-10. The existing saved-search comparison, raw export, X adapter and account-action flow were not redesigned. A saved snapshot can now become an explicitly selected research handoff with retained provenance, exact-duplicate accounting and partial-result warnings. No database migration or external service is involved.

## Implementation References

| Source | Responsibility |
| --- | --- |
| [review-export.ts](../src/review-export.ts) | Strict review input and bounded snapshot validation; exact duplicate comparison; conflict refusal; SHA-256 source fingerprint; selected-record JSON/CSV manifest |
| [store.ts](../src/store.ts) | Re-read and verify source bytes at export, retain snapshot unchanged, existing path containment, temporary-file/rename export and CSV formula protection |
| [dashboard.ts](../src/dashboard.ts) | Token-protected preview/download routes, existing host/origin/fetch metadata guards, stale/conflict HTTP 409 responses |
| [server.ts](../src/server.ts) | `x_review_export` preview/export MCP entry point, separate from live account tools |
| [review-export.tsx](../dashboard/src/review-export.tsx) | Explicit selection, original-field inspection, note, partial acknowledgement, selection counts, downloads and error recovery |
| [main.tsx](../dashboard/src/main.tsx) and [styles.css](../dashboard/src/styles.css) | Small collection-page integration preserving graphite, warm paper and burnt-orange identity |
| [dashboard-fixture.ts](../test/dashboard-fixture.ts) and [playwright.config.ts](../playwright.config.ts) | Synthetic partial/empty/conflicting collections, isolated test port override and installed Chrome support |
| [README.md](../README.md) and [.gitignore](../.gitignore) | Accurate setup/workflow/limits and an allowlist for the two synthetic documentation screenshots below |

## Local Verification

Initial pass used Node 24.19.0 on macOS; the bounded-export follow-up uses Node 22.17.0 on macOS. Playwright 1.63.0 uses installed Google Chrome with fresh temporary profiles. Baseline before editing: 41 adapter/core/HTTP tests passed. Current result: **67 tests passed**, **10 dashboard browser cases passed**, production server/dashboard builds passed, and the shared stdio MCP/dashboard protocol test passed with **25 tools**. These are local results before coordinated publication; hosted verification is recorded in the repository's Actions runs.

```sh
npm ci
TEST_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
PLAYWRIGHT_CHANNEL=chrome X_BROWSER_TEST_PORT=5315 npm run check
```

The dashboard fixture binds 127.0.0.1:5315 during this check and is cleaned up afterward. Backend HTTP tests/protocol use ephemeral loopback listeners. All data is synthetic and stored in isolated temporary directories, never the normal user data directory. No live X account, existing profile/cookie database, login, message, post, delivery, payment, deployment, schedule, commit or push was used. Existing adapter action tests click only intercepted synthetic pages; dashboard account controls operate a `FakeBrowser`.

| Test Source | Verified Behavior |
| --- | --- |
| [review-export.test.ts](../test/review-export.test.ts) | 24 focused tests: existing digest/immutability, duplicate/refusal, stale-source, review validation, CSV/legacy/path coverage plus actual-store inert-key retention/conflicts, exact input limit, growth after stat with at most limit-plus-one bytes read, read/write handle closure, post-open link swaps, source/prior-export preservation on failure, exact CSV/JSON byte accounting, label/warning amplification, 64-container acceptance, 10,000-container refusal and pretty-JSON amplification |
| [dashboard.test.ts](../test/dashboard.test.ts) | 8 HTTP tests total, including token/origin/fetch-metadata-protected preview/download, real JSON/CSV contents, no browser calls, stale/conflict HTTP 409, read/depth/export limits as HTTP 413 without download headers, and unchanged source bytes |
| [protocol.mjs](../test/protocol.mjs) | Real stdio tool discovery, local snapshot preview/export with own `__proto__` evidence preserved, selected/excluded provenance, stale-digest refusal and session remaining closed, alongside existing protocol coverage |
| [review-export.spec.ts](../dashboard/tests/review-export.spec.ts) | 4 new browser cases: 1440/390 px actual JSON/CSV downloads, selection/note reset acknowledgement, raw-filter independence, exclusion/duplicate counts, stale-error recovery with retained note, empty/conflicting evidence refusal at 320 px |
| [workspace.spec.ts](../dashboard/tests/workspace.spec.ts) | All 6 existing workflows still pass, including saved-search comparison, raw CSV export, navigation, synthetic account confirmation and 320/390/768/1024/1440 px layouts |

New desktop/mobile review pages report no runtime errors, no horizontal overflow and zero automated axe WCAG A/AA violations. Their tests abort and fail on non-loopback requests; none occurred. Automated accessibility checks are not a comprehensive certification or a manual assistive-technology trial.

Actual screenshots, taken after successful CSV downloads and visually inspected:

- [1440 px full page](review-export-1440.png)
- [390 px full page](review-export-390.png)

Both screenshots use explicitly labeled synthetic blocked collections. Synthetic success does not establish live extraction quality or factual accuracy.

## Limits And Semantics

- A local operator declares that they reviewed the selection. There is no independent identity, verified approval, fact-check, source authentication or authorization grant. Account tools are unchanged and separate.
- Fingerprints are SHA-256 over original saved JSON file bytes, not canonical record hashes or signatures. Even whitespace changes require re-review. A trusted local process able to replace both source and export can defeat integrity expectations; this is not tamper-proof storage.
- Identical record IDs collapse only when all saved fields match (object key order ignored, array order retained). Validation uses the original parsed JSON records, retaining inert own `__proto__`, `constructor` and nested fields rather than a schema clone that may omit them. Differences in these fields are conflicts. Different IDs are never merged, even with identical text. There is no fuzzy or cross-snapshot deduplication and no automatic incremental feed.
- Original record fields and capture positions remain available. Requested limits and source keys missing from old data remain `null`; a missing per-record URL is warned about, never invented. Every stop reason retains `complete: false`; missing observations do not prove deletion.
- Review validation accepts at most 200 saved records and 8 MiB of snapshot JSON, 1-200 unique selected IDs, a trimmed 15-2000 character note and explicit `acknowledgedPartial: true`. Snapshot file reads use a closed-on-every-path regular-file handle and a limit-plus-one read budget, not an unbounded read followed by a size check. Path identity/link checks remain enforced; invalid UTF-8 is refused. An iterative preflight limits all JSON containers to depth 64 (root is one), including unknown and inert keys, before recursive duplicate comparison or pretty-printing. Excessive depth is explicitly refused, never flattened. The dashboard additionally caps requests at 64 KiB. Raw workflows are unchanged, not newly resource-bounded.
- Reviewed JSON and CSV each have a 16 MiB serialized UTF-8 limit. JSON preflights exact byte size including two-space indentation and the trailing newline before constructing output. CSV counts escaping, formula prefixes, separators, line endings and repeated provenance before joining output. Neither encoder creates an export file or silently trims labels/warnings/records on a size failure. Select fewer records or try the other format: JSON avoids repeated provenance; CSV avoids pretty-print indentation. Input/depth/output limits return explicit `REVIEW_TOO_LARGE` / `REVIEW_TOO_DEEP` / `REVIEW_EXPORT_TOO_LARGE` errors (HTTP 413). These caps do not change raw export semantics.
- JSON and CSV preserve selected record fields plus collection context. This is not a privacy redactor: labels, queries, warnings and nested selected data can contain sensitive context. Previews include unselected records, including when returned to a hosted MCP client.
- Review drafts exist only in the current UI component. Errors retain the note; refreshing the whole page clears it. Source re-preview resets selection/acknowledgement. Separate exports receive different timestamps and filenames; retries can create another identical-content handoff, not an X action.
- Local artifact files have existing filesystem access boundaries and atomic write visibility, not encryption, distributed backup, signatures or recall. The dashboard remains single-operator loopback software; no new multi-user roles or public access were added.

Suggested portfolio description: **A local research workspace that turns saved X observations into selected evidence packets with source fingerprints, duplicate accounting and explicit partial-result review, without reopening X.** Live X compatibility remains unverified.
