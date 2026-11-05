# v0.1.0 release readiness

Verified on 2026-11-05. Implementation: `7485277`, following `507c84e`.

| Gate | State | Evidence |
| --- | --- | --- |
| Implementation and offline checks | Passed | 424 tests in 30 files; typecheck/build; Node 22.21.1 |
| Package installation | Passed | Fresh production-only tarball installation; installed bin and npm exec |
| Real stdio transport | Passed | Installed package initialize, 17 tools, input validation, missing-config response and clean shutdown |
| Runtime floor | Passed | Installed package checked on Node 20.19.0 and 22.21.1 |
| Tool context budget | Passed | tools/list = 8,329 characters, under 12,000 |
| Production dependency audit | Passed | pnpm audit --prod reported no known vulnerabilities |
| GitHub | Published | Public pandalabs-dev/atlas-lite-mcp repository, main branch |
| Local clients | Registered | atlas in Claude Code and Codex user configurations; source build with absolute Node path |
| Independent review | Approved | Four material findings and two residuals fixed; 19 independent probes and 19 parser comparison cases passed |
| Atlassian account validation | Pending owner setup | No sites configured at last check; no live API reads or writes |
| npm publication and release tag | Pending owner login | npm whoami returned ENEEDAUTH; registry name returned E404 |

## Fixes from final review

1. Section reads inside nested macros now traverse partial ancestors and return the requested content. Writes reject a token that would reinsert an enclosing object inside its own section.
2. Confluence layouts use opaque placeholders. Nested content receives stable page-wide numbering for section and table reads. Restoring an ancestor preserves its descendants without false dropped warnings; removing it reports the outermost removed object.
3. Literal entity syntax, tilde fences/strikethrough and HTML characters are escaped. GFM autolinks still work for unescaped input; the redundant post-parse autolink transform is disabled so escaped literal URLs remain text.
4. Duplicate Jira field names now list candidate IDs on reads and writes. Exact IDs remain usable, and ambiguous writes do not send PUT.
5. Placeholder originals are restored atomically, so token-like text already inside a preserved macro is not scanned or substituted again.
6. Jira tables with row/column spans or explicit column widths use an opaque token, preserving their original ADF geometry.

Earlier release fixes in `507c84e` cover profiles sharing an Atlassian hostname, quoted JQL/CQL scope handling, clearing optional Jira fields with null, rejecting non-finite numeric field values and the declared Node engine floor.

The runtime requirement changed from >=20 to >=20.19.0 because production dependencies already require that minimum. Layout token behavior follows the approved design's preservation requirement and supersedes the earlier implementation's transparent layout rendering. The original design and execution plan remain historical records.

## Artifact verification

The final tarball contained 44 files, 56,068 bytes, with SHA-1 `b87dce78b5345896041873b8b154c5fc5be13c7c`. Its boundary is package.json, README.md, LICENSE and dist/**. It contained no source tests, plans, handoff, local configuration or credentials. A temporary production-only installation was exercised, then removed. No public npm artifact is implied by this test.

The disabled live suite skipped all six scenarios with all network/target/acknowledgement variables unset. This validates opt-in behavior only. Existing smoke failure-path and restoration tests remain in the offline suite.

## Remaining release actions

The owner runs `node dist/index.js init` locally and enters credentials in the hidden prompt, then a new MCP session calls sites_list to verify product reachability. Write validation additionally requires designated disposable page/issue targets and informed acceptance of comment and transition effects, as documented in README.

The owner runs npm login personally. After confirmation, verify identity and package availability, publish via the existing prepublishOnly hook, verify the registry version and registry-installed stdio server, then tag and push v0.1.0. No npm login, publication or release tag was attempted in this run.

Live REST acceptance, token scopes, rendered page behavior and workflow side effects remain unverified. Placeholder numbers are not a concurrency guarantee across content changes. Re-read rich content after an upgrade before submitting earlier token numbers.
