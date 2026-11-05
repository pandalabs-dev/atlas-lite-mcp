# v0.1.0 release readiness

Published and verified on 2026-11-05. Implementation: `7485277`, following `507c84e`; published source and release tag `v0.1.0`: `c42559c`. Package: https://www.npmjs.com/package/atlas-lite-mcp.

| Gate | State | Evidence |
| --- | --- | --- |
| Implementation and offline checks | Passed | 424 tests in 30 files; typecheck/build; Node 22.21.1 |
| Package installation | Passed | Fresh installation from npm registry; installed bin, npm exec and private init |
| Real stdio transport | Passed | Installed package initialize, 17 tools, input validation, missing-config response and clean shutdown |
| Runtime floor | Passed | Installed package checked on Node 20.19.0 and 22.21.1 |
| Tool context budget | Passed | tools/list = 8,329 characters, under 12,000 |
| Production dependency audit | Passed | pnpm audit --prod reported no known vulnerabilities |
| GitHub | Published | Public pandalabs-dev/atlas-lite-mcp repository, main branch |
| Client installation | Owner-controlled | Agent-added source registrations removed from Claude Code and Codex; owner installs/registers from npm |
| Independent review | Approved | Four material findings and two residuals fixed; 19 independent probes and 19 parser comparison cases passed |
| Atlassian account validation | Pending owner setup | No sites configured at last check; no live API reads or writes |
| npm publication and release tag | Published | 0.1.0 confirmed as latest; registry gitHead c42559c; tag v0.1.0 |

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

The published tarball contains 44 files, 189,493 unpacked bytes, with SHA-1 `ec701c888db376d472bd073b9eb6cce251a194d3`. Its boundary is package.json, README.md, LICENSE and dist/**. It contained no source tests, plans, handoff, local configuration or credentials. A fresh production-only installation from the public npm registry was exercised on Node 22.21.1, then removed. The installed CLI and npm exec both returned 0.1.0. The init command wrote a temporary mode-600 configuration using an unset synthetic environment reference, without making live Atlassian calls. The installed stdio server returned all 17 tools and clean stderr. No global installation or client registration was made during verification.

The disabled live suite skipped all six scenarios with all network/target/acknowledgement variables unset. This validates opt-in behavior only. Existing smoke failure-path and restoration tests remain in the offline suite.

## Owner installation and remaining live validation

The owner installs with `npm install -g atlas-lite-mcp` and runs `atlas-lite-mcp init` locally and enters credentials in the hidden prompt, then a new MCP session calls sites_list to verify product reachability. Write validation additionally requires designated disposable page/issue targets and informed acceptance of comment and transition effects, as documented in README.

The owner completed npm login and npm's additional browser confirmation. The prepublishOnly hook passed typecheck, all 424 tests and build. npm accepted the publication, and registry availability was verified after propagation. The source checkout registrations added earlier were removed at the owner's request; the owner chooses and configures the MCP client.

Live REST acceptance, token scopes, rendered page behavior and workflow side effects remain unverified. Placeholder numbers are not a concurrency guarantee across content changes. Re-read rich content after an upgrade before submitting earlier token numbers.
