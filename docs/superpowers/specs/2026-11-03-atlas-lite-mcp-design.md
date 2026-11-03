# atlas-lite-mcp design

Date: 2026-11-03
Owner: Andrija Peric
Status: approved for build
Repository: github.com/pandalabs-dev/atlas-lite-mcp (public, MIT)

Decision labels: (owner) marks Andrija's decisions, (assistant) marks calls proposed by the assistant in the brainstorming session and accepted by the owner. Both are binding for v1. The builder may challenge an (assistant) call with evidence but should not silently change it.

## 1. Intent and why

atlas-lite-mcp is an open-source local MCP server, stdio transport, that talks directly to the Jira Cloud and Confluence Cloud REST APIs with an email address and an Atlassian API token. The primary user is the owner inside Claude Code. The secondary audience is anyone who installs it from npm or GitHub (npm publication is part of v1, section 6.10), so the README, env-based configuration and the one-line install are first-class features (owner).

Why (owner): the official Atlassian Rovo remote MCP is slow, rate limited and expensive in tokens. "When I tell you to change one page, it should be fast and easy instead of struggling." Rovo requires `getConfluencePage`, which returns the full body, then `updateConfluencePage` with the full body, so every small change pulls and pushes the whole page through the model. That is slow, costs tokens both ways, and lets the model damage formatting it was never asked to touch. Rovo calls also consume Rovo credits (section 5), the likely cause of the pausing the owner sees.

The bet: a local server with a handful of smart tools, using the owner's own token, doing edits server-side and answering in a few lines.

## 2. Goals

1. One call per common intent: "change X to Y on this page URL", "create a bug report for X for gumperr", "move KEY-123 to Done". No lookup call first (owner).
2. Surgical edits: unchanged content never passes through the model (assistant).
3. Lossless edits: macros, panels, lozenges and layouts survive any edit that does not target them, including a section rewrite that keeps their placeholders (6.7).
4. Compact output: a few lines or a small table, under roughly 20 lines by default (assistant).
5. Small surface: about 12 to 16 tools with short descriptions (assistant).
6. Multi-site from day one: gumperr now, 24crypto and qint later, each with its own token and possibly both products (owner).
7. Easy install for strangers: `npx -y atlas-lite-mcp`, env-only config, interactive `init`.
8. Extensible: Jira and Confluence are product modules, so Compass or others can be added later without touching the core (owner).

## 3. Non-goals (v1)

OAuth flows. Rovo credits and Teamwork Graph. Compass. Jira Service Management specifics. Attachment upload. Confluence whiteboards and databases. Permissions management and admin APIs. HTTP or SSE transport (stdio only). A UI. Destructive tools (no delete page or delete issue).

## 4. Anti-goals

The project fails, even if every tool works, if:

- Tool descriptions bloat the context. The full `tools/list` payload (names, descriptions, parameter descriptions) must stay under roughly 3,000 tokens.
- Any edit path round-trips the whole page through markdown and loses macros or formatting.
- Responses dump raw JSON or raw storage XML by default.
- A simple edit needs two or three lookup calls before the write.

## 5. Constraints and verified facts

Verified against Atlassian documentation on 2026-11-03.

- Authentication. Basic auth with email plus API token is supported for Jira Cloud REST v2 and v3 and Confluence Cloud REST v1 and v2, with no removal date announced. Passwords are deprecated, tokens are not.
- Rate limits. API-token traffic is explicitly not under the new points-based quotas, which apply to Forge, Connect and OAuth apps. It stays under burst limits. Jira, per tenant per endpoint: GET 100/s, POST 100/s, PUT 50/s, DELETE 50/s; the GET issue endpoint 150/s; writes to one issue 20 per 2 s and 100 per 30 s. A 429 carries `Retry-After` (seconds) and `RateLimit-Reason`. Confluence adds burst protection on Permissions, Search and Admin endpoints, numbers unpublished.
- Rovo credits. The Rovo MCP consumes Rovo credits: 25, 70 or 150 per user per month on Standard, Premium and Enterprise. Search and Teamwork Graph calls cost 1 to 10 credits each. Extra-usage billing starts 2026-12-03. Direct REST calls with a token do not consume credits.
- Token lifetime and scoped tokens. Tokens expire, default 1 year, maximum 365 days. Scoped tokens exist and are recommended. They must call `https://api.atlassian.com/ex/jira/{cloudId}/...` and `https://api.atlassian.com/ex/confluence/{cloudId}/...` instead of `https://<site>.atlassian.net/...`. Decision (assistant): support both unscoped (site URL) and scoped (api.atlassian.com plus cloudId) tokens. The cloudId is resolved once from `https://<site>.atlassian.net/_edge/tenant_info` and cached. A site declares its token kind with `tokenType` (6.2).
- Jira search. Use the current `/rest/api/3/search/jql` endpoint; the legacy `/rest/api/3/search` was deprecated in 2025. The builder confirms against the docs at build time.
- Admin API. The Atlassian Admin API (api-access) is for org-level token and key administration. Not needed.
- Runtime. Node 22 is the development runtime and the package declares `engines` `>=20` (owner). TypeScript, official `@modelcontextprotocol/sdk`, stdio, Zod for tool inputs (assistant). stdout belongs to the protocol, so all logging goes to stderr.

## 6. Decided design

### 6.1 Architecture

- Entry and CLI. Starts the MCP server over stdio by default. `init` runs interactive setup instead.
- Config. Loads and validates sites, expands env references, checks file permissions.
- Site resolver. Turns a `site` argument or a URL into one configured site.
- HTTP client, one per site. Picks the base URL for unscoped or scoped tokens, adds Basic auth, applies timeouts and 429 retries, maps errors to one-sentence messages. Native `fetch` is enough.
- Product modules. `confluence` and `jira` each own their API calls, tools and converters, and register tools through a small shared interface (tool definitions plus a context holding the resolver and clients). Compass later means a new module, not core edits.
- Storage operations. Pure functions over a Confluence storage string: find and replace, section boundaries, table location, cell update, row insertion. No network, heavily tested.
- Converters. Markdown to storage, storage to markdown, markdown to and from ADF, plus the placeholder map that carries unsupported content through a markdown round trip (6.7).
- Response formatting. One-line results and small markdown tables.

Every Confluence write follows one path: fetch body in storage format with its version, apply a pure transformation to the string, PUT with `version.number + 1` and a short version message, return one line. The model sends only the piece it wants changed and receives one line back.

### 6.2 Configuration

Config file (assistant): `~/.config/atlas-lite-mcp/sites.json`, path overridable with `ATLAS_MCP_CONFIG`.

```json
{
  "sites": [
    {
      "name": "gumperr",
      "baseUrl": "https://gumperr.atlassian.net",
      "email": "andrija@example.com",
      "apiToken": "${GUMPERR_ATLASSIAN_TOKEN}",
      "tokenType": "classic",
      "defaultJiraProject": "GUM",
      "defaultConfluenceSpace": "SD"
    }
  ]
}
```

The project and space keys above are examples. A site's default project and space are whatever its config declares; nothing in the code assumes a particular key.

Per site: `name` (required, unique), `baseUrl` (required), `email` (required), `apiToken` (required, literal or `${ENV_VAR}`), optional `tokenType`, `defaultJiraProject`, `defaultConfluenceSpace` and `cloudId`. A site whose env reference cannot be resolved is marked unavailable and reported by `sites_list` and by calls that target it. Other sites keep working.

Token type (assistant): `tokenType` is `"classic"` (default, site URL) or `"scoped"` (api.atlassian.com plus cloudId, section 5). There is no auto-detection by falling back on 401, since that costs a failed call and is harder to explain.

Single-site fallback (assistant): with no config file, `ATLASSIAN_URL`, `ATLASSIAN_EMAIL` and `ATLASSIAN_TOKEN` define one site named after the URL's subdomain, so the `npx` one-liner works with env variables only. `ATLASSIAN_TOKEN_TYPE` sets the token type for that site, with the same values and default.

Precedence (assistant): when a config file and these env variables are both present, the file wins, the env variables are ignored, and one line on stderr says so.

### 6.3 Multi-site resolution and URL parsing

Every tool accepts an optional `site`, by name or hostname (owner requirement, assistant design). Resolution:

1. A URL argument's hostname selects the site. If an explicit `site` disagrees, the call fails.
2. Otherwise an explicit `site` is matched case-insensitively on name or hostname.
3. Otherwise, if exactly one site exists, it is used.
4. Otherwise the error lists the configured site names.

Tools that target a page or issue accept a URL or a bare id or key and never require a lookup call first (owner). Required forms:

- `https://x.atlassian.net/wiki/spaces/SD/pages/23560194/Title`
- `https://x.atlassian.net/wiki/pages/viewpage.action?pageId=23560194`
- `https://x.atlassian.net/browse/KEY-123`

Where cheap, also accept page edit URLs (`/pages/edit-v2/{id}`), Jira board URLs with `selectedIssue=KEY-123`, and bare keys matching `[A-Z][A-Z0-9_]+-\d+`. Tiny links (`/wiki/x/...`) are optional.

### 6.4 Tool catalogue

The builder may adjust names and parameter spelling but must not remove a capability. Every tool also takes optional `site`, not repeated in the table.

| Tool | Inputs | Returns |
|---|---|---|
| `page_get` | `url` or `id`; `format`: `markdown` (default), `storage`, `outline`; `section?` heading text | Title, version, space, body as markdown. `outline` gives headings and table positions only. `section` gives only that heading's content. |
| `page_edit` | `url`; `find`; `replace`; `all?` boolean | Exact find and replace on storage XHTML. Default requires exactly one match. Returns count and `v13 -> v14`. |
| `page_update_section` | `url`; `heading`; `markdown` | Replaces content between the heading and the next heading of same or higher level, restoring placeholder tokens. `v13 -> v14`, plus a `Dropped:` line when tokens were removed. |
| `page_append` | `url`; `markdown` | Appends converted markdown to the body, restoring placeholder tokens. `v13 -> v14`. |
| `page_create` | `site` (required when several sites); `space`; `title`; `markdown`; `parent?` url or id | URL, id, version. |
| `page_search` | `query` (CQL or plain text); `space?`; `limit?` default 10 | Table: id, title, space, last modified. Plain text becomes `text ~ "..."`. |
| `page_comment` | `url`; `markdown` | Footer comment. Comment id and page title. |
| `table_get` | `url`; `table?` 1-based index or heading text above the table | Table as markdown. |
| `table_update` | `url`; `row`; `column`; `value`; `table?` | `Row/Column: old -> new, v13 -> v14`. |
| `table_add_row` | `url`; `cells` object column to value; `table?`; `position?` `end` or `after:<row label>` | Row added, `v13 -> v14`. |
| `issue_get` | `key` or `url`; `fields?` list; `include_comments?` boolean | Summary line, key fields, description as markdown with placeholder tokens. Comments only on request. |
| `issue_search` | `query` (JQL or plain text); `limit?` default 20 | Table: key, type, status, assignee, summary. |
| `issue_create` | `site` (required when several sites); `project?`; `type`; `summary`; `description?` markdown; `fields?` names or ids to plain values; `labels?`; `assignee?` name or email | Key and URL. If required fields are missing, their names and allowed values instead. |
| `issue_update` | `key` or `url`; `fields?` names or ids to plain values; `description?` markdown; `summary?` | One line naming changed fields, plus a `Dropped:` line when description tokens were removed. |
| `issue_transition` | `key` or `url`; `to` status name | `KEY-123: In Progress -> Done`. |
| `issue_comment` | `key` or `url`; `markdown` | Comment id and issue key. |
| `sites_list` | none | Names, hostnames, reachable products, default project and space. |

Optional if cheap: `issue_types` for a project. User lookup is internal, not a tool.

### 6.5 Tool behaviour details

`page_get`. `outline` lists headings with levels and marks tables, for example `[table 2: 5 rows x 4 cols]`, so the model can target a section or table without reading the page. `section` matches heading text trimmed and case-insensitive. In `markdown` format and with `section`, content the markdown view cannot express appears as placeholder tokens (6.7). `storage` exists for when the model needs exact markup for `page_edit`.

`page_edit` (assistant). A code editor's find and replace, applied to the storage string. Untouched XML is never parsed and re-serialised, which makes it lossless.

- Zero matches is an error suggesting `page_get` with `format: storage` or `section`, since text seen in markdown may be split by inline markup or entities.
- Several matches without `all: true` is an error stating the count and showing up to three short contexts.
- If the literal `find` misses but its XML-escaped form matches (`&` versus `&amp;`), the escaped form is used and `replace` is escaped the same way.
- The result must be well-formed XML before the PUT, otherwise nothing is written.

`page_update_section`. Heading must match uniquely, else the error lists candidates. The heading element is kept. The section ends at the next heading of same or higher level, or at the end of its containing element, so a replacement never cuts across a layout cell or macro. Placeholder tokens in `markdown` are restored to their original markup, and tokens from the section that are missing are reported as dropped (6.7).

Tables (assistant).

- A number selects by 1-based document order. Text selects the first table after that heading. With no `table`, the page must have exactly one table, else the error lists them.
- Row matches first-cell text, column matches header-row text, both trimmed and case-insensitive. Missing or ambiguous matches list the candidates.
- `table_update` changes only the cell's text content, keeping wrappers such as `<p>` and all attributes. Cells holding macros, images or nested tables are refused with a pointer to `page_edit`.
- `table_add_row` clones an existing body row's cell structure, fills cells by column name, leaves the rest empty, and rejects unknown columns with the header list.
- `rowspan` or `colspan` in the targeted area is refused in v1.

Jira.

- `issue_get` default fields: summary, type, status, priority, assignee, reporter, labels, parent, created, updated. `fields` adds others by id or display name.
- `issue_search` turns plain text into `text ~ "..." ORDER BY updated DESC`. JQL without a `project` clause becomes `project = X AND (<query>)` when the site has `defaultJiraProject`. Use the current `/rest/api/3/search/jql` endpoint (section 5).
- `issue_create` takes `project` from the argument or the site's `defaultJiraProject`, matches `type` case-insensitively against the project's issue types, converts `description` to ADF and resolves `assignee` to an accountId (ambiguous matches list candidates).
- `fields` contract for `issue_create` and `issue_update` (assistant). Keys may be display names ("Priority", "Story Points", "Sprint") or raw ids ("customfield_10042", "priority"). Values may be plain strings, numbers or arrays. The server resolves them to the API shape using the create metadata for the project and issue type: the key is matched by name case-insensitively, then for option, select and priority fields the value is matched case-insensitively against the allowed values; users are resolved by display name or email to an accountId; dates pass through in ISO form. Metadata is cached per (site, project, issue type) for the server process lifetime.
- Required fields. If the issue type has required fields that were not supplied, `issue_create` does not create the issue and returns the required field names with their allowed values, truncated to 10 values each.
- Jira Service Management request types are out of scope. If a default project turns out to be a JSM project, plain `issue_create` with a standard issue type is still expected to work; nothing JSM-specific is built.
- `issue_transition` reads available transitions, matches `to` case-insensitively against target status and transition name, and on failure lists what is available.

### 6.6 Response style

Plain text, not JSON (assistant). Writes return one line with versions or keys, for example `Updated "Costs" v13 -> v14 (1 replacement)`. A write that drops placeholders adds one `Dropped:` line (6.7). Lists are markdown tables. Full content only through `page_get`, `table_get` or `issue_get`. Errors are one sentence with the fix: "Token for site gumperr rejected (401). Tokens expire after at most 365 days; create a new one at id.atlassian.com/manage-profile/security/api-tokens and update sites.json." Errors are returned as tool results with `isError: true`, so the model can act on them.

Tool descriptions are one or two short sentences, parameter descriptions a few words. A test serialises the `tools/list` payload and checks the 3,000-token budget.

### 6.7 Content formats

Confluence pages use storage format through REST v2: `GET /wiki/api/v2/pages/{id}?body-format=storage`, then `PUT` with `version.number` plus one and a version `message`. Space keys are resolved to ids where v2 needs them, and cached.

Markdown to storage applies only to content the model writes (create, append, update section, comments). It must emit clean XHTML: headings, `<p>`, lists, `<strong>`, `<em>`, links, inline `<code>`, `<table>` with a header row, and fenced code as `<ac:structured-macro ac:name="code">` with language and a CDATA body.

Storage to markdown serves `page_get` and `table_get`. Standard elements become markdown, and everything the markdown view cannot express becomes a placeholder token (below). The markdown view on its own is lossy, so no write path rebuilds a page from it; the tokens are what let a rewritten section or description keep what the model did not touch.

Jira descriptions and comments use ADF through REST v3. The converters cover paragraphs, headings, lists, code blocks, bold, italic, inline code, links and tables. Other nodes become placeholder tokens.

Placeholders for unsupported content (assistant).

- Scope. `page_get` (markdown format or `section`) and `issue_get` emit tokens for content the markdown view cannot express. Confluence: macros, panels, lozenges and status, layouts, images and attachments, emoticons. Jira: media, mentions, panels, inline cards.
- Form. A stable opaque token `{{atlas:N}}`, where N is a 1-based counter over the whole page body or the whole issue (description and comments share one sequence), so a `section` view shows the same numbers as the full page, followed on the same line by a short human hint, for example `{{atlas:3}} [macro: toc]` or `{{atlas:7}} [image: screenshot.png]`.
- Map. The server keeps a map from token to original markup (storage XHTML or the ADF node) for that page or issue version, in memory, keyed by (site, id, version). For Confluence the version is the page version number; for Jira, which has no version counter, the issue's `updated` timestamp plays that role.
- Write back. When `page_update_section`, `page_append`, `issue_update` (description) or `issue_comment` receives markdown containing tokens, the server substitutes the original markup back in at each token's position. The hint text after a token is ignored on the way back.
- Removal. A token that is not present in the submitted markdown means that content was removed. The write proceeds, inside the targeted region only, and the response adds a line listing what was dropped, for example `Dropped: 2 items: [macro: toc], [image: screenshot.png]`.
- Staleness. If the version has changed since the map was built, the server rebuilds the map from the current version before applying. A token that cannot be resolved is left out and reported as dropped.

### 6.8 Error and rate-limit handling

- 429: honour `Retry-After`, cap a single wait at 60 s, at most 3 retries, then a clear error including `RateLimit-Reason` when present.
- 409 on a page write: re-fetch once, re-apply the same transformation, retry. If it no longer applies, say so.
- 401 and 403: the message names the site and the likely cause (expired token, wrong email, no product access, missing scope).
- 404: names the site and id, and notes it may be a permission issue, since Atlassian returns 404 for both.
- Network timeout: 30 s per request.

### 6.9 Safety

Tokens are never logged, echoed in errors or returned by a tool. If the config file is world-readable, a stderr warning suggests `chmod 600`. No destructive tools in v1, and the rule covers test code too (6.11). Every Confluence edit creates a page version with a message naming the tool, so recovery is through page history.

### 6.10 Packaging and install

npm publication is in scope for v1 (owner).

- Package name `atlas-lite-mcp`, confirmed unclaimed on npm on 2026-11-03. `package.json` carries a `bin` entry and declares `engines` `>=20`.
- `npm i -g atlas-lite-mcp` or `npx -y atlas-lite-mcp`.
- Claude Code: `claude mcp add atlas -- npx -y atlas-lite-mcp`.
- README carries JSON snippets for Cursor and Claude Desktop.
- `atlas-lite-mcp init` (assistant) asks for site name, URL, email and token or env variable name, writes `sites.json` with mode 600, and verifies each site with a `/myself` call plus a light Confluence call, reporting reachable products.
- Semantic versioning, MIT licence.
- Done for v1 (owner): the package is published to npm so that `npx -y atlas-lite-mcp` and `claude mcp add atlas -- npx -y atlas-lite-mcp` work, the public GitHub repo pandalabs-dev/atlas-lite-mcp has its README, and the release is tagged.
- Publish step (owner): the package is published from the owner's npm account. The owner is not logged in on the build machine, so the plan includes an explicit step where the owner runs `npm login` interactively before `npm publish`.
- Repository conventions (owner): `main` is the only long-lived branch. Commits are the owner's own work, with no AI attribution lines.

### 6.11 Testing

Vitest (assistant). Unit tests cover URL parsing, site resolution, storage find and replace (escaping and well-formedness included), section boundaries, table and row and column matching, and markdown to storage and markdown to ADF round trips on fixtures from real pages. A fixture with macros, panels and lozenges must stay byte-identical outside the targeted region after `page_edit`, `table_update` and `page_update_section`.

Placeholder fixtures (assistant): a page section holding a macro and an image, read as markdown and written back through `page_update_section` with its tokens preserved, round-trips unchanged; the same section written back with one token removed produces the `Dropped:` line naming that item.

Live smoke test (owner). It runs only when the env credentials plus two ids are present, and skips otherwise:

- `ATLAS_SMOKE_PAGE`, a permanent scratch Confluence page id, on the gumperr site for now.
- `ATLAS_SMOKE_ISSUE`, a permanent scratch Jira issue key.

It edits only those two objects: `page_edit`, `table_update`, `page_append` followed by `page_edit` to remove what it appended, `issue_comment`, `issue_update` of a harmless field, and `issue_transition` forward and back if the transitions allow. It never creates pages or issues and never touches anything else. The no-destructive-operations rule covers test code too: tests do not call delete endpoints. The owner creates the scratch page and issue by hand and supplies the ids.

## 7. Left to the builder

- Libraries for the conversions (for example marked or remark with a custom renderer, turndown or a custom walker) and the XML parser used to locate sections and tables.
- HTTP client details. Native fetch is fine.
- File layout within the architecture above.
- Caching of cloudId, space ids, issue types and transitions (in-memory per process is acceptable). Create metadata and placeholder maps follow 6.5 and 6.7.
- Wording of the short hints after placeholder tokens, within the forms shown in 6.7.
- Test fixtures, README wording, CLI argument parsing library.

## 8. Open questions

Nothing is open. The token type declaration and the precedence between a config file and env variables are settled in 6.2.
