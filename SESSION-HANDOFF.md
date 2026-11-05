# Session handoff: atlas-lite-mcp

## Current state, 2026-11-05: deletion support

- Branch: `main`; remote: https://github.com/pandalabs-dev/atlas-lite-mcp.git.
- Version `0.2.0` is implemented in `82ed628`, pushed to origin/main and locally verified; npm publication is awaiting the owner's npm browser authorization. The previous public release is `0.1.0`, tag `v0.1.0` at `c42559c`.
- The owner explicitly requested deletion tools. This supersedes the original no-DELETE implementation requirement.
- `page_delete` accepts a page URL or ID and optional site, and moves a published Confluence page to trash. It does not expose permanent purge, draft deletion or recursive page-tree deletion.
- `issue_delete` accepts an issue key or URL and optional site. It permanently deletes the issue; subtasks are included only with explicit `deleteSubtasks: true`. Both tools carry destructive MCP annotations.
- Shared routing, token handling and error reporting apply to both new tools. Conflicting or ambiguous sites fail before a request; failures do not report success. Network failures and 5xx are not automatically retried.
- Owner setup has progressed since the original release: the owner installed from npm and supplied a screenshot of init reporting Jira ok and Confluence ok. Claude registration instructions were provided for the owner's separate profiles. The agent has not changed those registrations or globally upgraded the package.
- No live Atlassian writes or deletions were performed during this feature release. Adding the tools does not authorize deleting unspecified existing content.

## Verification of 0.2.0

- Node 22.21.1: typecheck, 464 offline tests across 31 files, and build passed.
- Coverage includes both actual MCP tool calls with mocked HTTP, empty 204 responses, classic/scoped routing, shared-host credentials, invalid targets, site ambiguity/conflicts, 400/403/404/500 failures, ambiguous network failure, and subtask opt-in. Query parameters embedded in a pasted URL cannot enable purge, draft deletion or cascade deletion.
- Fresh tarball installation on Node 20.19.0 and Node 22.21.1: CLI version/help, npm exec, private init (mode 600), stdio initialization, 19 tools, destructive annotations, missing-config errors and clean stderr passed.
- Tool catalogue: 9,316 characters, below the 12,000-character budget.
- Tarball: 44 files, 192,489 unpacked bytes; SHA-1 `e73469171dbfc5944ec8d7747a2f58eed4658390`. Boundary: package.json, README.md, LICENSE, dist/**. Temporary installs are removed after verification.

## Remaining release steps

1. Commit/push the completed changes, publish 0.2.0 through npm, confirm registry availability, and push tag v0.2.0 at the published source commit.
2. Verify a fresh registry installation and record its source commit and release evidence here.
3. The owner upgrades with `npm install -g atlas-lite-mcp@0.2.0` and restarts the relevant MCP sessions. No re-init or new credentials are required unless Atlassian denies deletion permissions/scopes.
4. Actual deletion permissions and live deletion behavior still require an explicitly designated disposable target. No scratch target is inferred from business content.

## Standing instructions

- Commits belong to Andrija Peric only; no co-author trailers. No en/em dashes in source, tests or documentation.
- The owner installs from npm and chooses client registration. Do not auto-install a source build, upgrade global packages or change client registrations without an explicit request.
- Stdout is MCP only; diagnostics go to stderr. Never print tokens or Basic credentials.
- Unit tests are offline. Do not restart unrelated live daemons or client sessions, and do not use pattern-based process kills.
- File configuration wins over env fallback. Placeholder numbers refer to current content; re-read changed content before editing.
- The original no-delete restriction was superseded by the owner's deletion-feature request on 2026-11-05. The smoke harness still does not delete remote objects automatically.

## Previous 0.1.0 release evidence


### Current state, 2026-11-05

The owner resumed work on 2026-11-05. The old pause after Task 18 is over.

- Branch: `main`, fast-forwarded from `v0.1`; the merged short-lived branch was deleted. Implementation HEAD: `7485277`.
- Public repository: https://github.com/pandalabs-dev/atlas-lite-mcp
- Remote: `origin`, https://github.com/pandalabs-dev/atlas-lite-mcp.git. Main was pushed and its remote SHA verified.
- Package version: `0.1.0`, published publicly as `atlas-lite-mcp@0.1.0` and confirmed as npm latest. Package page: https://www.npmjs.com/package/atlas-lite-mcp. Published source commit: `c42559c`. Release tag: `v0.1.0`.
- Installation ownership: the owner explicitly wants to install from npm and choose client registration personally. The source-checkout `atlas` registrations previously added by the agent were removed from Claude Code and Codex after checking they still matched the agent-added entries. No global package installation or replacement client registration was performed. Existing sessions were not restarted.
- Atlassian access: not configured at verification time. No private sites.json or ATLASSIAN_* process variables were found. No live Atlassian reads or writes were made.
- npm authentication: the owner completed npm login and the browser confirmation for publishing. `npm whoami` returned `pandalabsdev`. npm publication succeeded; registry propagation and the latest tag were checked.

### Work completed

- Task 19 had already been completed after the old handoff: README/license/package metadata in `91c7e90`, public examples/fixtures in `7b855bd`, documentation corrections in `f62fe1f`.
- `507c84e`: fixed explicit profile selection for URLs when profiles share a hostname; ambiguous hosts now request a profile name instead of silently choosing credentials.
- `507c84e`: fixed ORDER BY handling inside single-quoted strings, scope detection inside quoted search text, quoted field names and Confluence `space.key` scope clauses.
- `507c84e`: preserved null when clearing optional Jira fields, rejected clearing required fields, and rejected non-finite numeric field values before JSON serialization could turn them into null.
- `507c84e`: corrected the runtime engine floor to Node >=20.19.0, matching installed production dependencies and the README. Added Codex and local source setup instructions.
- `7485277`: preserved nested Confluence panels and column layouts, atomic placeholder restoration, literal markdown text and Jira table geometry; rejected ambiguous Jira custom-field names on reads and writes. Added regression coverage and updated token documentation.
- Created the public GitHub repository and pushed main.
- `c42559c`: documented normal npm installation and owner-controlled client registration. Published that exact commit as `0.1.0`, then verified a fresh registry installation, private init, installed CLI and stdio MCP handshake. Live Atlassian validation remains separate.

### Verified

- Node 22.21.1: 424 offline unit tests in 30 files, typecheck and build passed. Initial routing/field regressions failed before their fixes; review reproductions also failed before the preservation fixes. Tests include real tool read/write no-op checks and no-PUT guards.
- Built tarball: 44 files, limited to package.json, README.md, LICENSE and dist/**. Installed into a fresh temporary directory with production dependencies only and scripts disabled.
- Installed bin and local npm exec: --version returned 0.1.0; --help passed.
- Actual stdio MCP client against the installed package: initialize, tools/list (17 tools, 8,329 characters), missing-config guidance, invalid-input handling and close all passed; stderr was empty.
- Installed final package on Node 20.19.0 and Node 22.21.1: version, initialize, all 17 tool definitions, missing-config guidance, invalid-input handling and clean stderr passed.
- `pnpm audit --prod`: no known vulnerabilities at verification time.
- Disabled smoke suite: six skipped tests, with all network, target and acknowledgement variables unset. This is not live validation.
- Git history: checked 36 earlier commits for common credential/private-key patterns with no hits. This is a bounded scan, not a universal guarantee.

### Next steps requiring the owner

1. Install using `npm install -g atlas-lite-mcp`, then run `atlas-lite-mcp init`. Enter the token only in the hidden local prompt or use a private environment reference.
2. Register the server in the MCP client the owner chooses, using the README instructions. Then verify `sites_list` through a new client session; inspect product reachability rather than treating the MCP connection as proof of Atlassian access.
3. For live write verification, the owner must designate a disposable Confluence page and uppercase Jira issue key plus a site/profile, accept the permanent comment and transition side effects, and reserve the targets for exclusive use. Never infer scratch targets from business content. See README for fixture and acknowledgement requirements.
4. On a failed/ambiguous write, inspect resulting remote state before retrying. No delete calls or cleanup of remote objects are authorized by this handoff.

### Review and evidence

The original plan and spec remain in `docs/superpowers/`. The ignored `.superpowers/sdd/2026-11-03-atlas-lite-mcp/` directory contains the original progress log, rulings R1-R29, per-task reviews and smoke safety evidence. Keep it until release and live validation are finished. Independent review of `507c84e` found four material issues plus two preservation residuals. All six were fixed in `7485277`; the scoped re-review approved release with no remaining material findings. The reviewer independently ran 19 preservation/field probes and 19 parser comparison cases against fresh dist. Preserve the release-review-red.log reproduction evidence in the ignored execution directory.

### Standing gotchas

- Commits belong to Andrija Peric only; no co-author trailers or attribution. No em/en dashes in source, tests or documentation.
- Stdout is MCP only; diagnostics go to stderr. Never print tokens or Basic credentials.
- Unit tests are offline; do not set ATLAS_ALLOW_NETWORK=1 for `pnpm test`.
- No DELETE tools or HTTP requests. No pattern-based process kills. Do not restart unrelated live daemons or client sessions.
- The owner installs from npm and chooses client registration. Do not auto-install a source build or change MCP client registrations without an explicit request.
- Published tarball SHA-1: `ec701c888db376d472bd073b9eb6cce251a194d3`, 44 files, 189,493 unpacked bytes. Registry-installed bin, npm exec, private init (mode 600), initialize and all 17 tools were verified in a temporary directory that was removed afterward.
- File configuration wins over env fallback. Scoped token routing and live write permissions still need actual account verification.
- Placeholder numbers refer to current page/issue content, not a durable concurrency handle; re-read changed content before editing.
