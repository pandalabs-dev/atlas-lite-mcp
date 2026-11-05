# atlas-lite-mcp

A local stdio MCP server for Jira Cloud and Confluence Cloud, designed for fast, focused reads and surgical edits instead of full-document rewrites. It calls the Atlassian REST APIs directly rather than routing through Rovo, preserves untouched Confluence storage XHTML, and uses placeholder tokens to carry macros and other rich content through markdown edits. No Rovo service is used; this is not a performance benchmark or a promise about Atlassian or MCP-client billing.

## Requirements

- Node 20.19 or newer for the server. For source development, use Node 22.12 or newer on the Node 22 line to satisfy the current test toolchain.
- An Atlassian Cloud account with access to the Jira projects and Confluence spaces you intend to use.
- An [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens) owned by that account, and the matching account email. Use a token instead of your password. Tokens can expire; select an appropriate expiration and rotate them before it passes.
- An MCP client that can launch local stdio servers, such as Claude Code, Claude Desktop or Cursor.

## Install

Install the CLI from npm, then configure your Atlassian credentials:

```sh
npm install -g atlas-lite-mcp
atlas-lite-mcp init
```

Installation and `init` do not change your MCP client settings. Choose the client you want to use and register the server yourself.

Claude Code:

```sh
claude mcp add atlas -- atlas-lite-mcp
```

The `--` separates Claude options from the server launch command. Claude Code registers this at local scope by default, private to you in the current project. Add `--scope user` before `atlas` if you want it available across your projects.

Codex:

```sh
codex mcp add atlas -- atlas-lite-mcp
```

Codex saves this in your user MCP configuration. Start a new client session after registration and ask it to call `sites_list` once credentials are configured.

Without a global installation, run `npx -y atlas-lite-mcp init` and use `npx -y atlas-lite-mcp` as the client launch command, for example `claude mcp add atlas -- npx -y atlas-lite-mcp`. To run a source checkout, see Development.

## Quick setup with environment variables

With no config file, set these in the environment of the process that launches the server:

```sh
export ATLASSIAN_URL='https://your-site.atlassian.net'
export ATLASSIAN_EMAIL='you@example.com'
export ATLASSIAN_TOKEN='your-api-token'
export ATLASSIAN_TOKEN_TYPE='classic'
```

The token is a placeholder, not a real credential. Supply the real value through your local secret manager or a private environment, not a shared shell script or repository. The server does not load `.env` files automatically.

`ATLASSIAN_TOKEN_TYPE` accepts `classic` (the default, for tokens without scopes) or `scoped`. The first three variables must all be set. This creates one site named after the URL subdomain, for example `your-site`. Launch Claude Code from that environment; GUI clients may need their own `env` configuration. Ask the client to call `sites_list` to check product reachability. That tool makes read-only network probes.

## Interactive setup

```sh
atlas-lite-mcp init
```

Or, without a global install, use `npx -y atlas-lite-mcp init`.

The wizard asks for a site name, URL, email, token or environment-variable name, token type, and optional default Jira project and Confluence space. An uppercase variable name such as `NORTHSTAR_ATLASSIAN_TOKEN` is saved as an environment reference rather than as a literal token. The token prompt suppresses terminal echo and readline history.

`init` writes `sites.json` with mode `600`, preserving other sites and replacing an existing site with the same name ignoring case. It makes read-only Jira `/myself` and Confluence spaces probes, so it requires network access to verify credentials. A failed probe is reported but does not prevent saving; successful setup is not proof that every tool is permitted. If an environment reference is unset, verification is skipped. Restart the MCP server after changing configuration.

## Multiple sites

Create `~/.config/atlas-lite-mcp/sites.json` with this synthetic example:

```json
{
  "sites": [
    {
      "name": "northstar",
      "baseUrl": "https://northstar.atlassian.net",
      "email": "you@example.com",
      "apiToken": "${NORTHSTAR_ATLASSIAN_TOKEN}",
      "tokenType": "classic",
      "defaultJiraProject": "DEMO",
      "defaultConfluenceSpace": "DOCS"
    }
  ]
}
```

Names, project keys and space keys here are examples, not built-in defaults. Add more entries to `sites` for other sites or credential profiles. Names must be unique ignoring case. Required fields are `name`, `baseUrl`, `email` and `apiToken`; optional fields are `tokenType`, `defaultJiraProject`, `defaultConfluenceSpace` and `cloudId`.

- `apiToken` can be a literal token or a whole-string `${ENV_VAR}` reference resolved in the server process. Prefer the reference form. An unset reference marks that site unavailable without disabling other sites.
- Set `ATLAS_MCP_CONFIG` to an absolute file path to use a different config file.
- **File wins over env:** when a config file exists, it replaces the single-site environment fallback. The server reports the precedence on stderr; referenced environment variables are still resolved.
- Protect the file, especially if it contains literal credentials:

```sh
chmod 600 ~/.config/atlas-lite-mcp/sites.json
```

The 18 page, table and issue tools accept optional `site`, matched case-insensitively by name or hostname; `sites_list` takes no arguments and lists all configured sites. A page or issue URL selects its configured hostname; a conflicting explicit `site` fails. Bare page IDs and issue keys use the only configured site, or require `site` if several are configured. For profiles sharing a hostname, pass the explicit profile name with either a URL or a bare ID/key. An ambiguous hostname asks for the profile name instead of choosing credentials arbitrarily.

## Scoped tokens

In Atlassian's [token-management screen](https://id.atlassian.com/manage-profile/security/api-tokens), choose the scoped-token creation option, an expiry, the application and permissions needed for your intended operations. See [Atlassian's API-token guide](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/). Token scopes and the account's product, project, space and item permissions both apply. A scope does not grant access the account lacks.

Set `ATLASSIAN_TOKEN_TYPE='scoped'` for env-only setup, or use this site entry:

```json
{
  "name": "your-site",
  "baseUrl": "https://your-site.atlassian.net",
  "email": "you@example.com",
  "apiToken": "${ATLASSIAN_TOKEN}",
  "tokenType": "scoped",
  "cloudId": "your-cloud-id"
}
```

`cloudId` is optional. If absent, the implementation resolves it from `https://your-site.atlassian.net/_edge/tenant_info` and caches a successful result for the process. If discovery fails, set the site's `cloudId` explicitly. There is no environment variable for `cloudId` and no token-type auto-detection or 401 fallback.

Both token types use Basic authentication with email and API token. Scoped requests go through `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...` or `https://api.atlassian.com/ex/confluence/{cloudId}/wiki/...`; classic requests use the configured site origin.

Choose scopes against the REST operations you actually use, not the Rovo `agent-interface` scopes. Jira tools read/search issues, fields, create/edit metadata and transitions; writes create/update/delete issues, transition them or add comments. User resolution and probes also read user profiles. Confluence tools read pages and spaces, search via CQL, create/update/trash pages and add footer comments. Deletion requires `delete:issue:jira` (or the classic `write:jira-work` scope) and `delete:page:confluence`, respectively, plus the account's Jira Delete issues or Confluence page-delete permissions. Consult the scope requirements in the [Jira delete reference](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-delete) and [Confluence delete reference](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/#api-pages-id-delete), along with the [Jira REST reference](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/), [Confluence REST v2 reference](https://developer.atlassian.com/cloud/confluence/rest/v2/intro/) and [CQL search operation](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content/#api-wiki-rest-api-content-search-get). No universal minimal scope set or cross-product token coverage has been live-verified for this release. If a token only covers one product, the other product's reachability probe may fail; use separate named profiles when needed.

## Claude Desktop and Cursor

Merge the following into the client's existing configuration rather than replacing other servers. Values shown are placeholders. Keep real credentials out of version control; alternatively use a private `sites.json` and omit this `env` object when no environment references are needed.

```json
{
  "mcpServers": {
    "atlas": {
      "command": "npx",
      "args": ["-y", "atlas-lite-mcp"],
      "env": {
        "ATLASSIAN_URL": "https://your-site.atlassian.net",
        "ATLASSIAN_EMAIL": "you@example.com",
        "ATLASSIAN_TOKEN": "your-api-token"
      }
    }
  }
}
```

This example defaults to `classic`. For a scoped token, also set `ATLASSIAN_TOKEN_TYPE` to `scoped` in `env`. If using `${ENV_VAR}` references in `sites.json`, those variables must be available to the launched server; do not assume a GUI inherits your terminal environment.

- Claude Desktop: edit `claude_desktop_config.json` using Settings > Developer > Edit Config. On macOS it is at `~/Library/Application Support/Claude/claude_desktop_config.json`; on Windows, `%APPDATA%\Claude\claude_desktop_config.json`. Restart the app.
- Cursor: use `~/.cursor/mcp.json` for personal global configuration or `.cursor/mcp.json` for project configuration. Never commit a project configuration containing a real token. Reload the client after editing.
- Ensure `npx` and a supported Node are on the client's PATH; use an absolute executable path if necessary.

Setup references: [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Claude Desktop local servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers), [Cursor MCP](https://cursor.com/docs/context/mcp).

## Tools

There are 19 tools: the 18 page, table and issue tools accept optional `site`; `sites_list` takes no arguments and lists all configured sites. Page write tools take `url`, which also accepts a bare page ID. Issue tools take `key`, which also accepts an issue URL. Searches default to 10 pages or 20 issues.

| Tool | Purpose and main inputs |
| --- | --- |
| `page_get` | Read by `url` or `id`; `format` is `markdown`, `storage` or `outline`, with optional `section` heading. |
| `page_edit` | Exact storage XHTML `find` and `replace` at `url`; set `all: true` for multiple matches. |
| `page_update_section` | Replace the content under `heading` with `markdown`, preserving supplied placeholder tokens. |
| `page_append` | Append `markdown` to a page at `url`. |
| `page_create` | Create from `space`, `title` and `markdown`, with optional `parent` URL or ID. |
| `page_delete` | Move the published page at `url` to trash. Does not purge pages or delete drafts. |
| `page_search` | Search by CQL or plain-text `query`, with optional `space` and `limit`. |
| `page_comment` | Add a footer comment using `url` and `markdown`. |
| `table_get` | Read a table at `url`; optional `table` is its 1-based index or preceding heading text. |
| `table_update` | Set `value` at a `row` label and `column` header, with optional `table` selector. |
| `table_add_row` | Add `cells` keyed by column names; optional `position` is `end` or `after:<row label>`. |
| `issue_get` | Read `key`, with optional extra `fields` and `include_comments`. |
| `issue_search` | Search by JQL or plain-text `query`, with optional `limit`; applies the configured default project when appropriate. |
| `issue_create` | Create from `type` and `summary`; optional `project`, `description`, `fields`, `labels` and `assignee`. |
| `issue_update` | Update `key` using `fields` by name or ID, `summary` or markdown `description`. |
| `issue_delete` | Permanently delete `key`; optional `deleteSubtasks: true` also deletes its subtasks. Default false. |
| `issue_transition` | Move `key` using a target status or transition name in `to`. |
| `issue_comment` | Add a comment using `key` and `markdown`. |
| `sites_list` | List names, hosts, default project/space and product reachability via read-only probes. |

To clear an optional Jira field, pass `null` in `issue_update.fields`, for example `{"Assignee": null, "Due date": null}`. Use an empty array to clear labels or other lists. Required fields cannot be cleared; Jira still enforces its field and workflow rules. To clear the description, use the separate `description` parameter with an empty string. When several fields share a display name, the tool lists candidate field IDs; use the intended ID instead of the ambiguous name.

## Placeholder tokens

Markdown reads represent unsupported rich content as `{{atlas:N}} [hint]`, for example `{{atlas:3}} [macro: toc]`. Keep the token in submitted markdown to keep the underlying macro, image, attachment or ADF node; the trailing hint is ignored on restoration. Tokens are scoped to the same site and page or issue, not portable identifiers.

Confluence column layouts appear as an opaque `{{atlas:N}} [layout]` token. Use `page_get` with `format: outline` to find headings, then `section` to read or edit inside a column or panel. Nested content keeps page-wide token numbers, so a view may skip numbers. Restoring an enclosing layout or panel token into its own section is rejected. Jira tables with merged cells or explicit column widths also use an opaque token to preserve their geometry. Re-read content after upgrading the server before reusing any earlier token numbers.

`page_update_section`, `page_append`, `issue_update` descriptions and `issue_comment` restore supported token references. Omitting a token from a replaced section or description removes that content and reports it as `Dropped:`. These four restoration paths omit unknown tokens and report them as `Dropped:`; Jira `issue_create` does the same for unknown description tokens. Confluence `page_create` and `page_comment` do not restore page token references: they treat them as ordinary literal text without a `Dropped:` warning. A changed page or issue causes the map to be rebuilt from current content; re-read before editing if it changed, since token numbers are not a conflict-proof edit handle.

Use `page_get` with `format: storage` and `page_edit` when exact XHTML is needed. Table cell updates refuse macros, images, nested tables and targeted row/column spans instead of flattening them.

## Safety

- `page_delete` moves a published page to Confluence trash, where it can be restored. It does not offer permanent purge, draft deletion or recursive page-tree deletion.
- `issue_delete` permanently deletes a Jira issue. Jira refuses issues with subtasks unless `deleteSubtasks: true` is explicitly supplied. Both delete tools are marked destructive in MCP annotations and run when called; account permissions and token scopes are enforced by Atlassian.
- All writes change live content. Section, description and exact-match edits can also remove content. Delete requests are not retried after a network error or 5xx; inspect remote state before retrying an ambiguous result. Rate-limit responses use the normal bounded 429 retry policy.
- Every successful changed Confluence page PUT increments the page version and sends `atlas-lite-mcp <tool_name>` as its version message. A no-op does not create a new version. Page creation and footer-comment POSTs do not send this message. Jira mutations do not create Confluence-style page versions or carry that message.
- Confluence page history can help recover edits; it does not undo comments, Jira transitions, notifications or workflow automation side effects.
- Tokens are never logged, echoed in errors or returned by tools. Server diagnostics use stderr; stdout is reserved for MCP. Page and issue content is still returned to the MCP client, so use an account with only the access you intend to expose.
- Use HTTPS site URLs, keep credentials private, prefer environment references and protect config files with `chmod 600`. The server warns about group/other file permissions but does not refuse to load that file.
- Page writes validate XHTML and retry one version conflict by re-fetching and re-applying the edit. This is not a general transaction or automatic rollback guarantee.

## Troubleshooting

- **401:** check the matching account email, token value and expiry. Create a new token at [token management](https://id.atlassian.com/manage-profile/security/api-tokens), update the active configuration and restart the server. Verify `classic` versus `scoped` explicitly.
- **403:** check product/item access and the token's REST scopes. A successful login or `init` probe does not establish write permission.
- **404:** confirm the page ID, issue key and selected site. Atlassian may also return 404 when the account lacks permission.
- **429:** the client honors `Retry-After`, caps each wait at 60 seconds and retries at most three times. Persistent throttling is returned as an error, with `RateLimit-Reason` when present; wait before trying again. Requests time out after 30 seconds.
- **Missing site or env:** call `sites_list`, check `ATLAS_MCP_CONFIG` and file precedence, and ensure referenced variables reach the server process. Restart after edits.
- **No find match:** markdown text may differ from storage markup or entity escaping. Read `format: storage` to choose an exact replacement. Ambiguous targets need a unique heading, row, column or table selector.

## Development

From a source checkout with pnpm 9.15.0 and a supported development Node:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run
node dist/index.js --version
```

The version command should print `0.2.0`. Run `node dist/index.js` for the local stdio server. `pnpm test` is the offline unit suite and excludes `test/smoke/**`. Keep `ATLAS_ALLOW_NETWORK` unset for offline checks. The publish hook runs exactly `pnpm run typecheck && pnpm test && pnpm run build`, not smoke tests. `npm pack --dry-run` inspects packaging without publishing; build first because `prepublishOnly` runs on publish, not pack. The package boundary is `package.json`, `README.md`, `LICENSE` and `dist/**` only.

For source development, run `node dist/index.js init` from the repository, then register the built entry point using its absolute path:

```sh
claude mcp add --scope user atlas -- node /absolute/path/to/atlas-lite-mcp/dist/index.js
codex mcp add atlas -- node /absolute/path/to/atlas-lite-mcp/dist/index.js
```

Use an absolute path to a supported Node binary too if the client cannot find `node`. Rebuild after pulling source changes, then start a new MCP client session. Registration and a successful MCP handshake do not verify Atlassian credentials; `sites_list` checks read access to each product.

### Optional live smoke test

**This is not an offline check. Do not run it on normal pages or issues.** The live run for this release has not been performed because owner-supplied scratch IDs are pending.

Before opting in, manually create one disposable scratch Confluence page and one disposable scratch Jira issue reserved exclusively for this run, with no other editors or automation depending on them. Do not reuse business content. The page must have a heading and exactly one ordinary table with a header row and a labelled body row, each with at least two cells; the second body cell must be editable plain content, with no unsupported spans or rich objects. The issue must allow label edits, comments and an unambiguous transition away from its starting status, ideally with a usable reverse transition. Missing fixtures fail rather than silently passing.

Use the normal private credentials/config, replace both placeholders, and set the three ACK guards only after accepting these consequences:

```sh
ATLAS_ALLOW_NETWORK=1 \
ATLAS_SMOKE_PAGE='<disposable-scratch-page-id>' \
ATLAS_SMOKE_ISSUE='<UPPERCASE-SCRATCH-KEY>' \
ATLAS_SMOKE_ACK_EXCLUSIVE_SCRATCH=1 \
ATLAS_SMOKE_ACK_PERMANENT_COMMENT=1 \
ATLAS_SMOKE_ACK_TRANSITION_RISK=1 \
pnpm test:smoke
```

Also set `ATLAS_SMOKE_SITE` to the explicit configured site/profile name when there is not exactly one configured site. Use a bare numeric page ID and uppercase issue key for the selected site. The ACK variables are harness requirements, not a general server authorization feature.

The suite appends/edits/removes its page marker, changes/restores exact table-cell XHTML, reads outline/section content, adds/removes a unique Jira label, **adds a permanent issue comment**, and discovers transitions read-only before attempting a real forward transition and a reverse transition when available. A reverse transition is not guaranteed. Page versions, the comment, transition history, notifications and automation effects can remain even after content/status restoration. It does not create pages or issues, and there is no comment deletion or automatic removal of scratch objects.

The harness waits for tracked handlers before cleanup, but deadlines, network ambiguity or process interruption cannot prove that a remote write did not happen. On any failure or interruption, manually inspect both targets for `atlas-smoke-` markers, table markup, labels, comments and final issue status before retrying. A failed comment request may already have created its permanent comment, so do not blindly rerun. A passing run verifies only these scenarios and observable restoration, not every tool, endpoint, scope, external automation effect or the server factory's metadata wiring.

## License

MIT. Copyright (c) 2026 Andrija Peric. See [LICENSE](LICENSE).
