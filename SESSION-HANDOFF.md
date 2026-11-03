# SESSION HANDOFF, atlas-lite-mcp

Written 2026-11-03 at the owner's request ("pause the work and write a handoff to continue later").

## Current state

- Repo: `/Users/andrijaperic/development/atlas-lite-mcp`, branch `v0.1` (29 commits ahead of `main`, `main` is at `3a3b8d4`). Nothing pushed anywhere yet: no GitHub remote, no npm package.
- Build: `pnpm typecheck`, `pnpm test` (363 tests, 27 files) and `pnpm build` are green at `5f615e3`.
- The server already works from a build: `dist/index.js` answers the MCP `initialize` handshake and exits when stdin closes. `node dist/index.js --version` prints `0.1.0`.
- Plan: `docs/superpowers/plans/2026-11-03-atlas-lite-mcp.md` (20 tasks). Spec: `docs/superpowers/specs/2026-11-03-atlas-lite-mcp-design.md`.
- Execution method: superpowers `subagent-driven-development`, every subagent on model `opus` (owner's standing rule). Its workspace is `.superpowers/sdd/2026-11-03-atlas-lite-mcp/` (git-ignored, inside the repo, so it survives). Key files there:
  - `progress.md`: the ledger. Tasks 1 to 17 have a `complete` line. Resume at the first task without one.
  - `rulings.md`: R1 to R27, every controller decision. They must be listed under "Rulings I made" when the plan finishes.
  - `global-constraints.md`, `task-N-brief.md` (all 20 extracted), `task-N-report.md` (1 to 17), `review-<base>..<head>.diff` packages.

## What was done this session (after the last compaction)

| Task | Commits | Review |
| --- | --- | --- |
| 13 table_get / table_update / table_add_row | `a63c3b8` | approved |
| 14 issue_get / issue_search / issue_transition / issue_comment | `2609287` | approved, ruling R24 |
| 15 issue_create / issue_update + field resolution | `9018198`, fix `7f28310` | approved after fix round 1 (description inside `fields` rejected, names de-duplicated by id, project key upper-cased), ruling R25 |
| 16 server wiring, sites_list, index.ts, description budget | `2523db4`, fix `16590c2` | approved after fix round 1 (probe failure labels, configError as isError), ruling R26; tools/list payload 8,329 chars of the 12,000 budget |
| 17 `atlas-lite-mcp init` | `e8a0083` | see "Task 17 status" below, ruling R27 |

## Task 17 status

Complete. Commits `e8a0083` (feature) and `5f615e3` (fix round 1). The task review found that the secret token answer stayed in readline history and came back on the Up arrow; fixed with `historySize: 0`, injectable prompter streams and a TTY-driven test. The catch-all in the prompt loop was narrowed to a dedicated `InputEndedError`; other faults print `init failed: <message>`. Re-review clean. `src/cli/init.ts` is 222 lines (accepted). Suite after Task 17: 363 tests, 27 files, typecheck and build clean.

## Next steps, in order

1. **Task 18, live smoke test**: brief `.superpowers/sdd/2026-11-03-atlas-lite-mcp/task-18-brief.md`. Creates `vitest.smoke.config.ts` and `test/smoke/live.test.ts`; runs only via `pnpm test:smoke` with `ATLAS_ALLOW_NETWORK=1 ATLAS_SMOKE_PAGE=<id> ATLAS_SMOKE_ISSUE=<KEY>` (ruling R2). The owner agreed it edits only one scratch Confluence page and one scratch Jira issue in gumperr; the owner has to create those two and give the id and key. The implementer writes the file without network; the controller runs the live pass once the ids exist (needs a gumperr `sites.json` or the three `ATLASSIAN_*` variables).
2. **Task 19, README + LICENSE + packaging**: brief `task-19-brief.md`. `bin`, `files`, `prepublishOnly` in package.json; MIT "Copyright (c) 2026 Andrija Peric"; README sections listed in the brief; `npm pack --dry-run` must show only package.json, README.md, LICENSE, dist/**. Consider whether `SESSION-HANDOFF.md` should stay out of the public repo (it is not in `files`, so npm never ships it).
3. **Final whole-branch review** on Opus (template: `superpowers/requesting-code-review/code-reviewer.md`), range `3a3b8d4..HEAD`. Point it at the deferred minors listed in `progress.md` (grep `deferred`). One fix dispatch, one scoped re-review, adjudicate residuals, record rulings.
4. **Finishing**: merge `v0.1` into `main` fast-forward (ruling R17), delete `v0.1` (owner rule: `main` is the only long-lived branch).
5. **Task 20, release** (brief `task-20-brief.md`), on `main`:
   - `gh repo create pandalabs-dev/atlas-lite-mcp --public --source . --push --description "..."` (checked 2026-11-03: `gh` is logged in as pandalabs-dev, the repo does not exist yet).
   - OWNER STEP: `npm login` in their own terminal (`! npm login` in the Claude session). Checked 2026-11-03: not logged in; `atlas-lite-mcp` is unclaimed on npm.
   - `npm publish --access public`, verify with `npx -y atlas-lite-mcp@0.1.0 --version`, tag `v0.1.0`, push the tag.
6. Delete the SDD workspace only after the final review is clean, present the full "Rulings I made" list (R1 to R27 plus any new ones) to the owner, update the memory file `~/.claude/projects/-Users-andrijaperic-development/memory/atlas_lite_mcp_project.md`.

## Gotchas worth knowing cold

- Never use `pkill -f`; stop the server by closing stdin.
- No DELETE tool anywhere, not even in tests. No em or en dashes in source, tests, descriptions or docs (a hygiene test enforces it in the repo).
- Secrets only via env or `sites.json`; the HTTP client redacts the token and the base64 credentials from every message. Never print a token in init output.
- Owner rules: no AI attribution in commits; commit messages exactly as the briefs give them; `main` only long-lived branch; every subagent on `opus`.
- The Task 17 brief's 401 text was stale; the real client text is `Token or email for site <name> rejected (401). ...` (R27).
- `splitOrderBy` ignores single-quoted literals (deferred, R-noted in Task 12).
- Scoped tokens use `https://api.atlassian.com/ex/{jira|confluence}/{cloudId}`; the cloudId comes from `_edge/tenant_info` and is cached per process.
- Verified Atlassian facts: API-token traffic sits under burst limits only (Jira GET 100/s, PUT 50/s per tenant), Rovo MCP bills credits (overage billing from 2026-12-03), tokens expire after at most 365 days.
