# Session handoff: atlas-lite-mcp

## Current state, 2026-11-05

The owner resumed work on 2026-11-05. The old pause after Task 18 is over.

- Branch: `main`, fast-forwarded from `v0.1`; the merged short-lived branch was deleted. Implementation HEAD: `7485277`.
- Public repository: https://github.com/pandalabs-dev/atlas-lite-mcp
- Remote: `origin`, https://github.com/pandalabs-dev/atlas-lite-mcp.git. Main was pushed and its remote SHA verified.
- Package version: `0.1.0`. The npm package is not published and no release tag exists yet.
- Local deployment: built `dist/index.js`, registered as `atlas` in the owner's Claude Code user configuration and Codex user configuration. Both use the existing Node 22.21.1 binary by absolute path. Claude Code reports Connected. Existing sessions were not restarted.
- Atlassian access: not configured at verification time. No private sites.json or ATLASSIAN_* process variables were found. No live Atlassian reads or writes were made.
- npm authentication: `npm whoami` returned ENEEDAUTH. The owner was asked to run `npm login` personally and confirm completion; no login was attempted by the agent.

## Work completed

- Task 19 had already been completed after the old handoff: README/license/package metadata in `91c7e90`, public examples/fixtures in `7b855bd`, documentation corrections in `f62fe1f`.
- `507c84e`: fixed explicit profile selection for URLs when profiles share a hostname; ambiguous hosts now request a profile name instead of silently choosing credentials.
- `507c84e`: fixed ORDER BY handling inside single-quoted strings, scope detection inside quoted search text, quoted field names and Confluence `space.key` scope clauses.
- `507c84e`: preserved null when clearing optional Jira fields, rejected clearing required fields, and rejected non-finite numeric field values before JSON serialization could turn them into null.
- `507c84e`: corrected the runtime engine floor to Node >=20.19.0, matching installed production dependencies and the README. Added Codex and local source setup instructions.
- `7485277`: preserved nested Confluence panels and column layouts, atomic placeholder restoration, literal markdown text and Jira table geometry; rejected ambiguous Jira custom-field names on reads and writes. Added regression coverage and updated token documentation.
- Created the public GitHub repository and pushed main. Publication to GitHub does not mean the npm release or live Atlassian validation is complete.

## Verified

- Node 22.21.1: 424 offline unit tests in 30 files, typecheck and build passed. Initial routing/field regressions failed before their fixes; review reproductions also failed before the preservation fixes. Tests include real tool read/write no-op checks and no-PUT guards.
- Built tarball: 44 files, limited to package.json, README.md, LICENSE and dist/**. Installed into a fresh temporary directory with production dependencies only and scripts disabled.
- Installed bin and local npm exec: --version returned 0.1.0; --help passed.
- Actual stdio MCP client against the installed package: initialize, tools/list (17 tools, 8,329 characters), missing-config guidance, invalid-input handling and close all passed; stderr was empty.
- Installed final package on Node 20.19.0 and Node 22.21.1: version, initialize, all 17 tool definitions, missing-config guidance, invalid-input handling and clean stderr passed.
- `pnpm audit --prod`: no known vulnerabilities at verification time.
- Disabled smoke suite: six skipped tests, with all network, target and acknowledgement variables unset. This is not live validation.
- Git history: checked 36 earlier commits for common credential/private-key patterns with no hits. This is a bounded scan, not a universal guarantee.

## Next steps requiring the owner

1. Configure Atlassian access locally: from this checkout run `node dist/index.js init`. Enter the token only in the hidden local prompt or use a private environment reference. Then verify `sites_list` through a new client session; inspect product reachability rather than treating the MCP connection as proof of Atlassian access.
2. Complete npm login in the owner's terminal and confirm it. Recheck `npm whoami` and that the package name/version are still available, publish with the established hook, verify registry installation and handshake, then create/push tag `v0.1.0`. Do not claim npm availability before those checks pass.
3. For live write verification, the owner must designate a disposable Confluence page and uppercase Jira issue key plus a site/profile, accept the permanent comment and transition side effects, and reserve the targets for exclusive use. Never infer scratch targets from business content. See README for fixture and acknowledgement requirements.
4. On a failed/ambiguous write, inspect resulting remote state before retrying. No delete calls or cleanup of remote objects are authorized by this handoff.

## Review and evidence

The original plan and spec remain in `docs/superpowers/`. The ignored `.superpowers/sdd/2026-11-03-atlas-lite-mcp/` directory contains the original progress log, rulings R1-R29, per-task reviews and smoke safety evidence. Keep it until release and live validation are finished. Independent review of `507c84e` found four material issues plus two preservation residuals. All six were fixed in `7485277`; the scoped re-review approved release with no remaining material findings. The reviewer independently ran 19 preservation/field probes and 19 parser comparison cases against fresh dist. Preserve the release-review-red.log reproduction evidence in the ignored execution directory.

## Standing gotchas

- Commits belong to Andrija Peric only; no co-author trailers or attribution. No em/en dashes in source, tests or documentation.
- Stdout is MCP only; diagnostics go to stderr. Never print tokens or Basic credentials.
- Unit tests are offline; do not set ATLAS_ALLOW_NETWORK=1 for `pnpm test`.
- No DELETE tools or HTTP requests. No pattern-based process kills. Do not restart unrelated live daemons or client sessions.
- Rebuild after changing source. Local client registrations point at this checkout, not an npm installation.
- File configuration wins over env fallback. Scoped token routing and live write permissions still need actual account verification.
- Placeholder numbers refer to current page/issue content, not a durable concurrency handle; re-read changed content before editing.
