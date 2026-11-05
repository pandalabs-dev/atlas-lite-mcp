# v0.2.0 release readiness

Deletion support requested by the owner on 2026-11-05. Published and registry-verified on 2026-11-05. Implementation: `82ed628`; published source and tag `v0.2.0`: `6767175ba8cbfa55459ce52fd33981e4987f6f79`. Package: https://www.npmjs.com/package/atlas-lite-mcp.

| Gate | State | Evidence |
| --- | --- | --- |
| Implementation and offline checks | Passed | Typecheck, 464 tests in 31 files, build on Node 22.21.1 |
| Delete semantics | Passed offline | Confluence trash only; Jira subtasks opt in; destructive MCP annotations |
| Routing and failure checks | Passed offline | Classic/scoped, explicit shared-host profiles, ambiguity/conflict rejection, HTTP and network errors |
| Package installation | Passed | Fresh production-only public-registry install with empty npm cache; CLI, npm exec, private init |
| Real stdio transport | Passed | 19 tools, destructive annotations, no-config errors, clean shutdown |
| Runtime floor | Passed | Fresh tarball installation and stdio on Node 20.19.0 and 22.21.1 |
| Tool context budget | Passed | 9,316 characters, under 12,000 |
| GitHub | Pushed | Implementation commit 82ed628 on origin/main |
| npm publication and tag | Published | npm latest 0.2.0; registry gitHead and v0.2.0 both point to 6767175 |
| Live Atlassian deletion | Not performed | No disposable target was designated for this feature release |
| Client installation | Owner-controlled | Existing global packages and MCP registrations unchanged |

The release adds `page_delete` and `issue_delete`. It supersedes the original no-DELETE requirement. `page_delete` uses Confluence REST v2 without purge or draft flags; `issue_delete` uses Jira REST v3 with `deleteSubtasks=false` unless the caller explicitly sets the boolean to true. Both tools accept the existing site selection conventions. See the README for account permissions and token scopes.

The tarball contains 44 files, 192,489 unpacked bytes, SHA-1 `e73469171dbfc5944ec8d7747a2f58eed4658390`. Package content is limited to package.json, README.md, LICENSE and dist/**. Testing did not use live credentials or mutate Atlassian content.

The owner upgrades using `npm install -g atlas-lite-mcp@0.2.0 --prefer-online`, then restarts the MCP sessions. Existing sites.json remains usable. Actual deletion permissions remain unverified until a designated disposable target is used.

The first npm browser authorization expired. The second was completed by the owner. npm accepted publication, then the version became available after registry processing. A fresh installation from npm verified all 19 tool definitions, destructive annotations and clean stdio shutdown. No global package upgrade or client configuration change was performed by the agent.

## Previous release record

### v0.1.0 release readiness

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

### Fixes from final review

1. Section reads inside nested macros now traverse partial ancestors and return the requested content. Writes reject a token that would reinsert an enclosing object inside its own section.
2. Confluence layouts use opaque placeholders. Nested content receives stable page-wide numbering for section and table reads. Restoring an ancestor preserves its descendants without false dropped warnings; removing it reports the outermost removed object.
3. Literal entity syntax, tilde fences/strikethrough and HTML characters are escaped. GFM autolinks still work for unescaped input; the redundant post-parse autolink transform is disabled so escaped literal URLs remain text.
4. Duplicate Jira field names now list candidate IDs on reads and writes. Exact IDs remain usable, and ambiguous writes do not send PUT.
5. Placeholder originals are restored atomically, so token-like text already inside a preserved macro is not scanned or substituted again.
6. Jira tables with row/column spans or explicit column widths use an opaque token, preserving their original ADF geometry.

Earlier release fixes in `507c84e` cover profiles sharing an Atlassian hostname, quoted JQL/CQL scope handling, clearing optional Jira fields with null, rejecting non-finite numeric field values and the declared Node engine floor.

The runtime requirement changed from >=20 to >=20.19.0 because production dependencies already require that minimum. Layout token behavior follows the approved design's preservation requirement and supersedes the earlier implementation's transparent layout rendering. The original design and execution plan remain historical records.

### Artifact verification

The published tarball contains 44 files, 189,493 unpacked bytes, with SHA-1 `ec701c888db376d472bd073b9eb6cce251a194d3`. Its boundary is package.json, README.md, LICENSE and dist/**. It contained no source tests, plans, handoff, local configuration or credentials. A fresh production-only installation from the public npm registry was exercised on Node 22.21.1, then removed. The installed CLI and npm exec both returned 0.1.0. The init command wrote a temporary mode-600 configuration using an unset synthetic environment reference, without making live Atlassian calls. The installed stdio server returned all 17 tools and clean stderr. No global installation or client registration was made during verification.

The disabled live suite skipped all six scenarios with all network/target/acknowledgement variables unset. This validates opt-in behavior only. Existing smoke failure-path and restoration tests remain in the offline suite.

### Owner installation and remaining live validation

The owner installs with `npm install -g atlas-lite-mcp` and runs `atlas-lite-mcp init` locally and enters credentials in the hidden prompt, then a new MCP session calls sites_list to verify product reachability. Write validation additionally requires designated disposable page/issue targets and informed acceptance of comment and transition effects, as documented in README.

The owner completed npm login and npm's additional browser confirmation. The prepublishOnly hook passed typecheck, all 424 tests and build. npm accepted the publication, and registry availability was verified after propagation. The source checkout registrations added earlier were removed at the owner's request; the owner chooses and configures the MCP client.

Live REST acceptance, token scopes, rendered page behavior and workflow side effects remain unverified. Placeholder numbers are not a concurrency guarantee across content changes. Re-read rich content after an upgrade before submitting earlier token numbers.
