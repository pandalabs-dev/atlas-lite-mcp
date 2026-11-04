# SESSION HANDOFF, atlas-lite-mcp

## Current state, 2026-11-04

Paused at the owner's request after Task 18. Task 18 is implemented, independently reviewed and committed. Task 19 is next but has not started. Do not resume automatically or request scratch IDs during this pause.

- Repository: `/Users/andrijaperic/development/atlas-lite-mcp`, branch `v0.1`. Code HEAD before this documentation commit: `5a2debe249d7d046657e56630175409509095a31`, `test: add opt-in live smoke test for scratch page and issue`. `main` remains at `3a3b8d4`; no merge performed.
- No configured Git remote, push, deployment, GitHub publication or npm publication. Work remains local by explicit instruction.
- Fresh final offline verification: 387 unit tests in 29 files passed with `ATLAS_ALLOW_NETWORK` unset and dummy PAGE=1 / ISSUE=GUM-1; the live suite was excluded and the global-fetch-blocked assertion passed. Typecheck, build and diff whitespace checks passed.
- Controller's fresh post-commit disabled-smoke check at 15:21:39 on 2026-11-04: exit 0, one skipped file and six skipped tests, with PAGE, ISSUE, ALLOW_NETWORK and all three ACK variables unset. This is controller-reported evidence, not a live run.
- **Smoke not run, ids pending.** No live network/Atlassian writes occurred. Disabled-suite acceptance is not live validation.
- Version remains `0.1.0`. Earlier Task 16 verification established that built `dist/index.js` answers MCP initialize, exits when stdin closes and prints the version for `--version`; that handshake was not rerun during Task 18.

## Task 18 implementation and review

Six files committed in `5a2debe`: `vitest.smoke.config.ts`, `test/smoke/live.test.ts`, `test/smoke/scenarios.ts`, `test/smoke/settlement.ts`, `test/smoke-safety.test.ts`, `test/smoke-settlement.test.ts`.

- Six opt-in live scenarios cover page append/edit cleanup, exact table-cell XHTML restoration, outline/section read, permanent Jira comment, temporary unique label, and transition/return.
- Failure-path cleanup runs after failed assertions and ambiguous responses. Original and cleanup failures are combined. Readback verifies state; conflicts and incomplete fixtures fail rather than quietly skip or warn.
- Whole local tool handler promises are tracked across SDK timeout, HTTP retries and retry sleeps. Calls, scenarios and shutdown await settlement; a scenario deadline prevents later scenarios from running over abandoned work. Test timeout stays 120000 ms; hook timeout is finite at 120000 ms.
- Read-only transition discovery replaces the old unsafe nonexistent-status probe. Reverse transitions named like their destination, such as Open -> Open while currently Doing, are supported without losing duplicate-name/current-status-no-op protections.
- Independent initial review found I1-I4; fix round 1 addressed all four and `task-18-re-review-1.md` approved removal of the temporary hold. The unconditional throw and its stale comment were removed only after approval. All real network/target/ACK and restoration protections remain.

### Future live smoke prerequisites

A future live run is separate, explicitly authorized work, not a continuation implied by this handoff.

1. Owner designates one disposable scratch Confluence page ID and one disposable **uppercase bare Jira key**, not an issue URL or lower-case key. Never infer targets from ordinary project objects.
2. Select the intended site using `ATLAS_SMOKE_SITE` when more than one is configured; otherwise exactly one site must exist. Configuration comes from `sites.json` or the documented `ATLASSIAN_*` variables. Never print credentials.
3. Obtain actual informed owner permission for a permanent comment and possibly irreversible transition side effects. Require exclusive access/no concurrent writers and a manual recovery plan.
4. Supply `ATLAS_SMOKE_PAGE`, `ATLAS_SMOKE_ISSUE`, `ATLAS_ALLOW_NETWORK=1`, and each explicit acknowledgement: `ATLAS_SMOKE_ACK_EXCLUSIVE_SCRATCH=1`, `ATLAS_SMOKE_ACK_PERMANENT_COMMENT=1`, `ATLAS_SMOKE_ACK_TRANSITION_RISK=1`. Environment flags do not replace real permission.
5. Do not retry after an ambiguous or timed-out write until local settlement and resulting remote state have been inspected. Comments are intentionally not deleted.

Local handler settlement does not prove an unknowable remote commit after an HTTP timeout. A process crash, forced termination, or expired finite teardown hook can prevent cleanup and is a failed/unknown run requiring manual inspection. Jira labels/status lack atomic compare-and-swap; workflow side effects may be irreversible even when status returns. Live permissions, scoped routing, canonicalization and reverse workflow availability remain unverified.

### Deferred Task 18 minors

- Test-only instrumented McpServer uses the same `registerModules` and product modules as the thin `createServer` factory, but factory metadata/package-version loading is not smoke-covered; future factory wiring could drift.
- A queued scenario rejected by the poisoned-state check can retain its early abort listener until context collection.
- Transition acknowledgement formatting uses unnormalized issue input; the supported smoke setup should use an uppercase bare key.
- ACK negative tests do not independently omit every required flag combination.

## Evidence and execution workspace

Plan: `docs/superpowers/plans/2026-11-03-atlas-lite-mcp.md` (20 tasks). Binding spec: `docs/superpowers/specs/2026-11-03-atlas-lite-mcp-design.md`.

Existing ignored workspace: `/Users/andrijaperic/development/atlas-lite-mcp/.superpowers/sdd/2026-11-03-atlas-lite-mcp/`. Preserve it until final review/release is complete.

- `progress.md`: append-only task history; Tasks 1 to 18 have completion records. Task 18 live run remains pending per brief Step 3.
- `rulings.md`: R1 to R29, controller decisions to include in the final plan report.
- `task-18-continuation-report.md`: implementation, red/green evidence, risks, fix round and final outcome.
- `task-18-safety-review.md`, `task-18-re-review-1.md`, `task-18-fix-round-1.diff`: independent findings, scoped approval and fix diff.
- `task-18-fix-i2-red.log`, `task-18-fix-i3-red.log`, `task-18-fix-focused-green.log`: timeout/late-write and realistic transition regression evidence.
- `task-18-final-unit.log`, `task-18-final-typecheck.log`, `task-18-final-build.log`, `task-18-final-whitespace.log`: actual final implementer command outputs. The controller's final disabled-smoke result is recorded above and in the ledger/report, not misrepresented as an implementer log.
- `global-constraints.md`, `task-N-brief.md`, earlier reports/review packages remain available.

## Useful earlier task references

| Task | Commits | Review/result |
| --- | --- | --- |
| 13 table tools | `a63c3b8` | approved |
| 14 issue read/transition/comment | `2609287` | approved, R24 |
| 15 issue create/update | `9018198`, fix `7f28310` | approved after fixes, R25 |
| 16 server wiring/sites_list/index | `2523db4`, fix `16590c2` | approved; tools/list 8,329 chars under 12,000 budget, R26 |
| 17 interactive init | `e8a0083`, fix `5f615e3` | approved; secret history fixed with historySize 0 and TTY regression, R27 |
| 17 handoff | `b00ca01` | baseline for Task 18 |
| 18 smoke harness and safety | `5a2debe` | independent re-review approved; 387 tests green; no live run |

Task 17 also narrowed early-input handling to `InputEndedError`; other prompter faults report `init failed: <message>`. Its brief's older 401 wording is superseded by the real client message `Token or email for site <name> rejected (401). ...` (R27).

## Remaining work after the owner resumes

1. Task 19, README + LICENSE + packaging, `task-19-brief.md`: not started. Add the planned bin/files/prepublishOnly metadata and MIT copyright, then verify `npm pack --dry-run` includes only package.json, README.md, LICENSE and dist/**. Consider whether the handoff should remain out of the public repository.
2. Whole-branch independent review of `3a3b8d4..HEAD`, including earlier deferred minors in `progress.md`, then the scoped fix/review process. No whole-branch review occurred during Task 18.
3. Merge `v0.1` fast-forward into `main`, then delete the short-lived branch (R17). Not authorized/executed during this pause.
4. Task 20 release on main: remote creation, push and npm publication remain pending. Earlier 2026-11-03 observations were that the repo/package name was unclaimed and npm login was needed; recheck when authorized rather than assume they remain current. Owner performs npm login in their own terminal. No publication is authorized by this handoff.
5. Only after final review is clean and records are preserved, finish the plan's ruling/deferred-minor report and workspace cleanup. Update project memory as appropriate at that later boundary.

## Standing gotchas

- No pattern kills; close stdin to stop the server. Never delete remote pages/issues or add DELETE tools/HTTP calls, including in tests.
- No em/en dashes or attribution in source, tests, docs or commits. Commit messages follow the task brief. Main is the only long-lived branch.
- Unit tests must stay offline; do not set `ATLAS_ALLOW_NETWORK=1` for `pnpm test`. `pnpm test` excludes test/smoke/**; the live suite uses its separate config and narrowed **/*.test.ts discovery.
- Secrets only via env or private sites.json. HTTP errors redact token and Basic credentials; never print them.
- `splitOrderBy` ignores single-quoted literals, deferred from Task 12.
- Scoped tokens use `https://api.atlassian.com/ex/{jira|confluence}/{cloudId}`; cloudId is resolved from `_edge/tenant_info` and cached. Those routes have not been live-tested here.
