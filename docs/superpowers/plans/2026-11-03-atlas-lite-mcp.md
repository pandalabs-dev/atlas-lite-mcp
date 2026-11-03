# atlas-lite-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish `atlas-lite-mcp`, a local stdio MCP server that edits Confluence Cloud pages surgically and losslessly and works Jira Cloud issues in one call per intent, using an email plus API token.

**Architecture:** A small core (config, site resolver, URL parser, per-site HTTP client, tool framework, placeholder store) plus two product modules (`confluence`, `jira`) that register tools through one `ProductModule` interface. Confluence writes always run fetch storage, apply a pure string transformation located by htmlparser2 source offsets (untouched XML is never re-serialised), check well-formedness, then PUT `version + 1`. Markdown is parsed once with mdast (GFM) and emitted to either storage XHTML or ADF by custom walkers, and `{{atlas:N}}` placeholder tokens carry unsupported content through every markdown round trip.

**Tech Stack:** Node 22 (dev), `engines >=20`, TypeScript 6.0.3 (strict, ESM, NodeNext), pnpm 9.15.0, `@modelcontextprotocol/sdk` 1.32.2, zod 4.6.7, htmlparser2 12.0.0 + domhandler 6.0.1 + entities 8.1.0, fast-xml-parser 5.12.0 (validator only), mdast-util-from-markdown 2.1.0 + micromark-extension-gfm 3.0.0 + mdast-util-gfm 3.1.0, vitest 5.1.0, native fetch.

**Spec:** `docs/superpowers/specs/2026-11-03-atlas-lite-mcp-design.md`

## Pinned decisions (researched 2026-11-03)

| Need | Choice (exact version) | Why |
|---|---|---|
| MCP server | `@modelcontextprotocol/sdk` 1.32.2 | Current npm latest of the 1.x package the spec names. Verified via context7 (docs at 1.32.2): `new McpServer({name, version})`, `server.registerTool(name, { description, inputSchema: <zod raw shape> }, handler)`, `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`, `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk/inMemory.js`. Checked in a scratch install: `tools/list` adds `$schema` and `execution` keys per tool, which count toward the budget. The separate v2 package `@modelcontextprotocol/server` 2.4.0 exists but is not what the spec names; do not use it. |
| Tool input schemas | `zod` 4.6.7 | SDK peer range `^3.25 \|\| ^4.0`; import `{ z } from 'zod'`. |
| Storage XHTML locate/read | `htmlparser2` 12.0.0 (`parseDocument` with `xmlMode: true, withStartIndices: true, withEndIndices: true, recognizeCDATA: true, decodeEntities: false`) + `domhandler` 6.0.1 (types) | Gives every element its source `startIndex`/`endIndex` (endIndex is INCLUSIVE, verified), so all edits splice the original string and untouched markup stays byte-identical. Tolerates `ac:`/`ri:` prefixes and CDATA. |
| Entity decoding for text matching | `entities` 8.1.0 (`decodeHTML`) | xmlMode leaves `&nbsp;` undecoded (verified); same major version htmlparser2 already depends on. |
| Well-formedness check | `fast-xml-parser` 5.12.0, `XMLValidator.validate('<r>' + storage + '</r>')` only | Verified: accepts `ac:` prefixes, `&nbsp;`, CDATA; rejects mismatched tags and a bare `&`. Never used to re-serialise. |
| Markdown parsing (both targets) | `mdast-util-from-markdown` 2.1.0 + `micromark-extension-gfm` 3.0.0 + `mdast-util-gfm` 3.1.0, types `@types/mdast` 4.0.4 | One AST feeds two small custom emitters (storage XHTML, ADF), so token restoration is written once. Verified tables and fenced code parse; `{{atlas:3}} [macro: toc]` parses as plain text. |
| Storage -> markdown, ADF -> markdown | Custom walkers (no library) | turndown needs a DOM and has no notion of placeholders or `ac:` elements; ADF is plain JSON. md-to-adf (2022) and marklassian do not support tokens. |
| CLI prompts and args | `node:readline/promises` and `process.argv` | Only `init`, `--version`, `--help`; no dependency needed. |
| Tests | `vitest` 5.1.0 (dev; needs Node ^22.12, dev only) | Verified running under pnpm 9.15.0 with `vi.stubGlobal('fetch', ...)`. |
| Compiler | `typescript` 6.0.3, `@types/node` 22.20.5 | npm `latest` is 7.0.2 (native port); 6.0.3 is the last JS-based line and compiled a scratch NodeNext sample with this stack. tsconfig sets `types: ["node"]` explicitly. |
| Package manager | pnpm 9.15.0 (`which pnpm` found it) | All commands below use pnpm; `npm` only for `pack --dry-run`, `login`, `publish`, `view`. |

Engines note: htmlparser2 12 and entities 8 declare `node >=20.19.0`. `engines` stays `>=20` per the owner; README states "Node 20.19 or newer".

Atlassian endpoint shapes (checked against the published OpenAPI specs on 2026-11-03 unless marked):

- Jira search: `POST /rest/api/3/search/jql`, body `{ jql, maxResults, fields: string[], nextPageToken? }`; response `{ issues, nextPageToken?, isLast }`. `fields` defaults to `id` only, so always send it. JQL must be bounded (has a restriction), `ORDER BY` alone is rejected by Atlassian.
- Jira create metadata: `GET /rest/api/3/issue/createmeta/{project}/issuetypes` -> `{ issueTypes | createMetaIssueType: [{ id, name }] }`; `GET /rest/api/3/issue/createmeta/{project}/issuetypes/{issueTypeId}?maxResults=200` -> `{ fields | results: [{ fieldId, key, name, required, hasDefaultValue, schema { type, items, system, custom }, allowedValues }] }` (read `fields ?? results`). Old `/issue/createmeta` is deprecated, do not use.
- Jira edit metadata: `GET /rest/api/3/issue/{key}/editmeta` -> `{ fields: { [id]: { name, required, schema, allowedValues } } }`.
- Jira others: `GET /rest/api/3/issue/{key}?fields=a,b`, `POST /rest/api/3/issue`, `PUT /rest/api/3/issue/{key}` (204), `GET|POST /rest/api/3/issue/{key}/transitions`, `POST /rest/api/3/issue/{key}/comment` `{ body: ADF }`, `GET /rest/api/3/user/search?query=`, `GET /rest/api/3/field`, `GET /rest/api/3/myself`.
- Confluence page: `GET /wiki/api/v2/pages/{id}?body-format=storage` -> `{ id, title, spaceId, version: { number }, body: { storage: { value } }, _links: { webui } }`; `PUT /wiki/api/v2/pages/{id}` body requires `{ id, status: "current", title, body: { representation: "storage", value }, version: { number, message } }`; `POST /wiki/api/v2/pages` requires `spaceId`, plus `{ status: "current", title, parentId?, body }`.
- Confluence others: `GET /wiki/api/v2/spaces?keys=SD` and `GET /wiki/api/v2/spaces/{id}`, `POST /wiki/api/v2/footer-comments` `{ pageId, body: { representation: "storage", value } }`. CQL search has no v2 endpoint: use `GET /wiki/rest/api/content/search?cql=&limit=&expand=space,version` (v1), results `[{ id, title, space: { key }, version: { when } }]` (verify at build time).
- Scoped tokens: base `https://api.atlassian.com/ex/jira/{cloudId}` and `https://api.atlassian.com/ex/confluence/{cloudId}` (Atlassian support page). Whether Confluence paths keep the `/wiki` prefix after that base is not stated on the page: plan keeps `/wiki/...` in every path and isolates the base in one function (verify at build time with a scoped token). cloudId from unauthenticated `GET https://<site>.atlassian.net/_edge/tenant_info` -> `{ cloudId }` (verify at build time).

## Global Constraints

- Work only inside `/Users/andrijaperic/development/atlas-lite-mcp`. Work happens on short-lived branch `v0.1`, merged fast-forward into `main` before Task 20; `main` is the only long-lived branch.
- Node 22 locally; `package.json` `"engines": { "node": ">=20" }`; `"type": "module"`; TypeScript `strict`, `module`/`moduleResolution` `NodeNext`; relative imports end in `.js`.
- Dependencies are added with exact versions (`pnpm add -E`), the versions in the table above.
- No em-dashes or en-dashes anywhere: code, comments, README, tool descriptions, commit messages. Use `->` or a plain hyphen. Enforced by `test/hygiene.test.ts`.
- Commits are the owner's own work: no AI attribution, no `Co-Authored-By` lines.
- Never log, print, echo in errors, or return a token. All logging goes to stderr (stdout is the MCP protocol).
- Never run `pkill -f` or any pattern-based kill.
- Secrets only via env variables or `~/.config/atlas-lite-mcp/sites.json` (overridable with `ATLAS_MCP_CONFIG`); never in the repo, fixtures or tests (tests use fake tokens such as `tok-SECRET-123`).
- No delete tools and no DELETE HTTP calls anywhere, test code included; the HTTP method type is `'GET' | 'POST' | 'PUT'`.
- Total `tools/list` payload under 3,000 tokens, measured as `JSON.stringify(tools).length / 4`, asserted `< 12000` characters (Task 16).
- Unit tests never hit the network: `test/setup/no-network.ts` replaces global `fetch` with a thrower (it does not stub `fetch` when `ATLAS_ALLOW_NETWORK=1`); code takes `fetch` by injection. `pnpm test` runs unit tests only and excludes `test/smoke/**`; the live smoke test runs only through `pnpm test:smoke` (Task 18).
- `tsconfig.json` keeps `noUncheckedIndexedAccess` and typechecks `test/`. Test snippets in this plan are illustrative: write them type-safe (guards or non-null assertions such as `calls[0]!`) so `pnpm typecheck` passes.
- Limits from the spec: 429 waits honour `Retry-After`, cap 60 s per wait, at most 3 retries; request timeout 30 s; `page_search` limit default 10; `issue_search` limit default 20; required-field allowed values truncated to 10.
- Responses are plain text, under roughly 20 lines by default; errors are one sentence with the fix (a second short sentence that states the fix is allowed), returned as tool results with `isError: true`.
- Every Confluence page update (PUT) carries the version message `atlas-lite-mcp <tool_name>`. Confluence v2 `POST /pages` and `POST /footer-comments` take no version message.
- Ambiguous heading, row and column matches list the matching candidates (up to 5, then `(and N more)`); missing ones list the available names as the tests show.

## Review Focus

1. Fresh `npx` install with no `sites.json` and no `ATLASSIAN_*` env: the server must still start and every tool (and `sites_list`) must answer one sentence telling the user to run `atlas-lite-mcp init` or set the three env variables. Test in Task 16.
2. JQL that already carries `ORDER BY` (or is only `ORDER BY ...`) on a site with `defaultJiraProject`: the project clause must go before `ORDER BY`, never `project = X AND (... ORDER BY ...)`. Test in Task 14.
3. Values containing `&`, `<`, `]]>` or `|` written through `table_update`, `table_add_row`, `page_append` and fenced code: storage stays well-formed and reads back as the same text. Tests in Tasks 7 and 9.
4. Placeholder tokens arriving in a process that never served `page_get` / `issue_get` (server restarted, or another agent read the page): the map is rebuilt from the current version and tokens restore. Tests in Tasks 11 and 14.
5. Headings, row labels and column names whose storage text has entities, `&nbsp;`, inline markup or stray whitespace (`R&amp;D`, `Q1&nbsp;2026`, `<strong>Item</strong>`): matching uses decoded, whitespace-collapsed text. Tests in Tasks 6 and 9.

---

## File structure

```
package.json, pnpm-lock.yaml, tsconfig.json, tsconfig.build.json, vitest.config.ts, vitest.smoke.config.ts, .gitignore, README.md, LICENSE
src/index.ts                       bin entry: init | --version | --help | stdio server
src/server.ts                      createServer(rt): McpServer with all modules
src/core/errors.ts                 AtlasError
src/core/log.ts                    log(line) -> stderr
src/core/config.ts                 loadConfig, configPath, defaultConfigDeps
src/core/url.ts                    parsePageRef, parseIssueRef
src/core/sites.ts                  resolveSite
src/core/http.ts                   createHttpClient, baseUrlFor (auth, base URL, retry, error mapping)
src/core/runtime.ts                createRuntime, Runtime, SiteRuntime
src/core/tools.ts                  ToolDef, ProductModule, defineTool, siteParam, executeTool, registerModules
src/core/format.ts                 plural (Task 5), mdTable, versionLine (Task 10)
src/core/placeholders.ts           Placeholder, TOKEN_RE, tokenText, formatDropped, PlaceholderStore<T extends Placeholder>
src/core/query.ts                  splitOrderBy (quote-aware ORDER BY split, shared by buildCql and buildJql)
src/core/sitesTool.ts              sitesTool (sites_list), coreModule
src/markdown/parse.ts              parseMarkdown (mdast + GFM)
src/confluence/storage/dom.ts      parseStorage, textOf, openTagEnd, innerRange, openTag, escapeXml
src/confluence/storage/edit.ts     findReplace, assertWellFormed
src/confluence/storage/placeholders.ts  StoragePlaceholder, collectStoragePlaceholders
src/confluence/storage/sections.ts listHeadings, findSection, outline, rowCount
src/confluence/storage/tables.ts   listTables, selectTable, updateCell, addRow
src/confluence/storage/restore.ts  restoreStorageTokens
src/confluence/storage/rewrite.ts  replaceSection, appendMarkdown
src/confluence/convert/toMarkdown.ts    storageToMarkdown
src/confluence/convert/fromMarkdown.ts  markdownToStorage
src/confluence/api.ts              getPage, putPage, createPage, spaceIdForKey, spaceKeyForId, searchPages, addFooterComment (all take rt: SiteRuntime)
src/confluence/write.ts            writePage (409 retry)
src/confluence/tools/pages.ts      page_get, page_edit, page_update_section, page_append, pageTarget
src/confluence/tools/publish.ts    page_create, page_search, page_comment, buildCql
src/confluence/tools/tables.ts     table_get, table_update, table_add_row
src/confluence/module.ts           confluenceModule
src/jira/adf/toMarkdown.ts         AdfNode, AdfDoc, AdfPlaceholder, adfToMarkdown
src/jira/adf/fromMarkdown.ts       markdownToAdf
src/jira/api.ts                    getIssue, searchIssues, listFields, getTransitions, doTransition, addComment, projectIssueTypes, createMeta, editMeta, createIssue, updateIssue (all take rt: SiteRuntime)
src/jira/jql.ts                    buildJql, isJql, quote
src/jira/users.ts                  findUser
src/jira/fields.ts                 normalizeCreateMeta, normalizeEditMeta, resolveFields, missingRequired, formatMissing, displayValue (pure logic, no HTTP calls of its own)
src/jira/tools/read.ts             issue_get, issue_search, issue_transition, issue_comment
src/jira/tools/write.ts            issue_create, issue_update
src/jira/module.ts                 jiraModule
src/cli/init.ts                    runInit, createPrompter
test/...                           mirrors src; test/fixtures/, test/helpers/, test/setup/, test/smoke/ (smoke runs only via vitest.smoke.config.ts)
```

---

### Task 1: Scaffold, errors, logging and config loading

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`, `test/setup/no-network.ts`
- Create: `src/core/errors.ts`, `src/core/log.ts`, `src/core/config.ts`
- Test: `test/core/config.test.ts`, `test/hygiene.test.ts`

**Interfaces:**
- Produces:
  - `class AtlasError extends Error { constructor(message: string, opts?: { status?: number }); status?: number }`
  - `log(line: string): void` (writes `line + "\n"` to stderr)
  - `type TokenType = 'classic' | 'scoped'`
  - `interface Site { name: string; baseUrl: string; host: string; email: string; apiToken: string; tokenType: TokenType; defaultJiraProject?: string; defaultConfluenceSpace?: string; cloudId?: string; unavailable?: string }`
  - `interface LoadedConfig { sites: Site[]; source: 'file' | 'env' | 'none'; path: string }`
  - `interface ConfigDeps { env: Record<string, string | undefined>; home: string; readFile(path: string): string | undefined; fileMode(path: string): number | undefined; warn(line: string): void }`
  - `loadConfig(deps: ConfigDeps): LoadedConfig` (throws `AtlasError` on unparsable or invalid files)
  - `defaultConfigDeps(): ConfigDeps` (real fs, `os.homedir()`, `process.env`, `log`)
  - `configPath(env: NodeJS.ProcessEnv, home: string): string` (`env.ATLAS_MCP_CONFIG` when set, else `<home>/.config/atlas-lite-mcp/sites.json`; the only path rule, used by `loadConfig` and by `init` in Task 17)

- [ ] **Step 1: Confirm the repo state**

Run: `git -C /Users/andrijaperic/development/atlas-lite-mcp branch --show-current && ls`
Expected: `v0.1` (the short-lived work branch the controller created from `main`) and only `docs`.

- [ ] **Step 2: Create the package and install pinned dependencies**

`package.json` fields: `name: "atlas-lite-mcp"`, `version: "0.1.0"`, `description: "Fast local MCP server for Jira Cloud and Confluence Cloud with surgical, lossless page edits."`, `type: "module"`, `license: "MIT"`, `author: "Andrija Peric"`, `engines: { node: ">=20" }`, `packageManager: "pnpm@9.15.0"`, `repository: { type: "git", url: "git+https://github.com/pandalabs-dev/atlas-lite-mcp.git" }`, `keywords: ["mcp", "jira", "confluence", "atlassian", "model-context-protocol"]`, scripts `build: "tsc -p tsconfig.build.json"`, `typecheck: "tsc -p tsconfig.json --noEmit"`, `test: "vitest run"` (unit tests only), `"test:smoke": "vitest run --config vitest.smoke.config.ts"`. (`bin` and `files` come in Task 19; `vitest.smoke.config.ts` comes in Task 18.)

```bash
pnpm add -E @modelcontextprotocol/sdk@1.32.2 zod@4.6.7 htmlparser2@12.0.0 domhandler@6.0.1 entities@8.1.0 fast-xml-parser@5.12.0 mdast-util-from-markdown@2.1.0 micromark-extension-gfm@3.0.0 mdast-util-gfm@3.1.0
pnpm add -D -E typescript@6.0.3 vitest@5.1.0 @types/node@22.20.5 @types/mdast@4.0.4
```

- [ ] **Step 3: Write config files**

`tsconfig.json`: `target ES2023`, `module NodeNext`, `moduleResolution NodeNext`, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `types: ["node"]`, `skipLibCheck`, `noEmit`, include `src`, `test`, `vitest*.config.ts`. `tsconfig.build.json` extends it with `noEmit: false`, `rootDir: "src"`, `outDir: "dist"`, include `src` only, no source maps, no declarations. `vitest.config.ts` (the `pnpm test` config, unit tests only): `include: ['test/**/*.test.ts']`, `exclude: [...configDefaults.exclude, 'test/smoke/**']` (`configDefaults` from `vitest/config`), `setupFiles: ['test/setup/no-network.ts']`, `environment: 'node'`. `pnpm test` never collects `test/smoke/**`; Task 18 adds `vitest.smoke.config.ts` for it. `.gitignore`: `node_modules/`, `dist/`, `coverage/`, `*.tgz`, `.env*`.

`test/setup/no-network.ts` (setup file of both vitest configs): unless `process.env.ATLAS_ALLOW_NETWORK === '1'`, `vi.stubGlobal('fetch', () => { throw new Error('Network disabled in unit tests; inject a mock fetch.') })`. With `ATLAS_ALLOW_NETWORK=1` it does not stub `fetch`; only the live smoke run (Task 18) sets it.

- [ ] **Step 4: Write the failing tests**

```ts
// test/core/config.test.ts  (deps built by a local helper: fake env, home '/h', in-memory files, warn spy; the `mode` option sets the file mode, default 0o600, and mode-sensitive tests pass it explicitly)
it('loads the file named by ATLAS_MCP_CONFIG and expands ${VAR} tokens', () => {
  // file: one site gumperr, baseUrl 'https://gumperr.atlassian.net/', apiToken '${GUMPERR_ATLASSIAN_TOKEN}'
  const cfg = loadConfig(deps({ env: { ATLAS_MCP_CONFIG: '/x/sites.json', GUMPERR_ATLASSIAN_TOKEN: 'tok-SECRET-123' } }));
  expect(cfg.source).toBe('file');
  expect(cfg.sites[0]).toMatchObject({ name: 'gumperr', baseUrl: 'https://gumperr.atlassian.net', host: 'gumperr.atlassian.net', apiToken: 'tok-SECRET-123', tokenType: 'classic' });
});
it('defaults to ~/.config/atlas-lite-mcp/sites.json', () => { expect(loadConfig(deps({ files: { '/h/.config/atlas-lite-mcp/sites.json': validFile } })).path).toBe('/h/.config/atlas-lite-mcp/sites.json'); });
it('configPath honours ATLAS_MCP_CONFIG, else the default path', () => {
  expect(configPath({ ATLAS_MCP_CONFIG: '/x/sites.json' }, '/h')).toBe('/x/sites.json');
  expect(configPath({}, '/h')).toBe('/h/.config/atlas-lite-mcp/sites.json');
});
it('marks a site unavailable when its env reference is unset and keeps the others', () => {
  const cfg = loadConfig(deps({ file: twoSites, env: { QINT_TOKEN: 'x' } }));
  expect(cfg.sites.find(s => s.name === 'gumperr')?.unavailable).toBe('env GUMPERR_ATLASSIAN_TOKEN is not set');
  expect(cfg.sites.find(s => s.name === 'qint')?.unavailable).toBeUndefined();
});
it('rejects duplicate names case-insensitively', () => { expect(() => loadConfig(deps({ file: dupNames }))).toThrow(/Duplicate site name "gumperr"/); });
it('reports the invalid field path and never the token', () => {
  const run = () => loadConfig(deps({ file: { sites: [{ name: 'g', baseUrl: 'https://g.atlassian.net', apiToken: 'tok-SECRET-123' }] } }));
  expect(run).toThrow(/sites\[0\]\.email/);
  try { run(); } catch (e) { expect(String((e as Error).message)).not.toContain('tok-SECRET-123'); }
});
it('rejects tokenType other than classic or scoped', () => { expect(() => loadConfig(deps({ file: badTokenType }))).toThrow(/tokenType/); });
it('throws a parse error naming the path for invalid JSON', () => { expect(() => loadConfig(deps({ raw: '{nope' }))).toThrow(/Could not parse \/h\/\.config\/atlas-lite-mcp\/sites\.json/); });
it('builds one site from ATLASSIAN_* env when no file exists', () => {
  const cfg = loadConfig(deps({ env: { ATLASSIAN_URL: 'https://acme.atlassian.net', ATLASSIAN_EMAIL: 'a@b.c', ATLASSIAN_TOKEN: 't', ATLASSIAN_TOKEN_TYPE: 'scoped' } }));
  expect(cfg.source).toBe('env');
  expect(cfg.sites).toEqual([expect.objectContaining({ name: 'acme', host: 'acme.atlassian.net', tokenType: 'scoped' })]);
});
it('prefers the file over env and says so once on stderr', () => {
  const d = deps({ file: validFile, mode: 0o600, env: { ATLASSIAN_URL: 'https://acme.atlassian.net', ATLASSIAN_EMAIL: 'a@b.c', ATLASSIAN_TOKEN: 't' } });
  expect(loadConfig(d).sites.map(s => s.name)).toEqual(['gumperr']);
  expect(d.warn).toHaveBeenCalledTimes(1);
  expect(d.warn).toHaveBeenCalledWith('Using /h/.config/atlas-lite-mcp/sites.json; ATLASSIAN_URL, ATLASSIAN_EMAIL and ATLASSIAN_TOKEN are ignored.');
});
it('warns about group or world readable files', () => {
  const d = deps({ file: validFile, mode: 0o644 });
  loadConfig(d);
  expect(d.warn).toHaveBeenCalledWith('/h/.config/atlas-lite-mcp/sites.json is readable by other users; run chmod 600 /h/.config/atlas-lite-mcp/sites.json');
  const quiet = deps({ file: validFile, mode: 0o600 }); loadConfig(quiet); expect(quiet.warn).not.toHaveBeenCalled();
});
it('returns no sites and source none when nothing is configured', () => { expect(loadConfig(deps({}))).toMatchObject({ sites: [], source: 'none' }); });
```

```ts
// test/hygiene.test.ts  (walks src/, test/, plus README.md, LICENSE, package.json when present)
it('contains no en or em dash characters', () => { for (const f of files) expect(read(f), f).not.toMatch(/[\u2013\u2014]/); });
it('never uses the DELETE HTTP method', () => { for (const f of files.filter(f => !f.endsWith('hygiene.test.ts'))) expect(read(f), f).not.toMatch(/['"`]DELETE['"`]/); });
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm vitest run test/core/config.test.ts`
Expected: FAIL, cannot resolve `../../src/core/config.js`.

- [ ] **Step 6: Implement `errors.ts`, `log.ts`, `config.ts`**

Validate with a zod schema (`name`, `baseUrl` URL, `email`, `apiToken` non-empty strings; optional `tokenType` enum default `classic`, `defaultJiraProject`, `defaultConfluenceSpace`, `cloudId`). Format zod issues as `sites[0].email is required` style (path joined, never the input value). `${NAME}` expansion applies only when the whole `apiToken` string matches `^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$`. `baseUrl` is normalised to `origin` (no trailing slash, no path). Env-only site name is the first DNS label of the URL host. Permission warning on stderr when `mode & 0o077` is non-zero (any group or other bit). `loadConfig` takes its path from `configPath(deps.env, deps.home)`.

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm vitest run && pnpm typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json vitest.config.ts .gitignore src test
git commit -m "feat: scaffold project and load site configuration"
```

---

### Task 2: URL parsing and site resolution

**Files:**
- Create: `src/core/url.ts`, `src/core/sites.ts`
- Test: `test/core/url.test.ts`, `test/core/sites.test.ts`

**Interfaces:**
- Consumes: `Site`, `AtlasError` (Task 1)
- Produces:
  - `parsePageRef(input: string): { id: string; host?: string }`
  - `parseIssueRef(input: string): { key: string; host?: string }` (key upper-cased)
  - `resolveSite(sites: Site[], req: { site?: string; host?: string }): Site` (throws for unavailable sites too)

- [ ] **Step 1: Write the failing tests**

```ts
// test/core/url.test.ts
it.each([
  ['https://x.atlassian.net/wiki/spaces/SD/pages/23560194/Title', '23560194'],
  ['https://x.atlassian.net/wiki/spaces/SD/pages/23560194', '23560194'],
  ['https://x.atlassian.net/wiki/pages/viewpage.action?pageId=23560194', '23560194'],
  ['https://x.atlassian.net/wiki/pages/edit-v2/23560194', '23560194'],
  ['https://x.atlassian.net/wiki/spaces/SD/pages/edit-v2/23560194?draftShareId=1', '23560194'],
  ['https://x.atlassian.net/wiki/spaces/~5b12/pages/42/Personal', '42'],
  ['23560194', '23560194'],
])('page ref %s', (input, id) => { expect(parsePageRef(input).id).toBe(id); });
it('returns the host for page URLs', () => { expect(parsePageRef('https://x.atlassian.net/wiki/pages/viewpage.action?pageId=1').host).toBe('x.atlassian.net'); });
it('rejects tiny links with a pointer to the full URL', () => { expect(() => parsePageRef('https://x.atlassian.net/wiki/x/AbCd')).toThrow(/Tiny links are not supported; open the page and copy its full URL/); });
it('rejects unrecognised page input', () => { expect(() => parsePageRef('hello')).toThrow(/Not a Confluence page URL or id: "hello"/); });
it.each([
  ['https://x.atlassian.net/browse/KEY-123', 'KEY-123'],
  ['https://x.atlassian.net/jira/software/projects/GUM/boards/1?selectedIssue=GUM-7', 'GUM-7'],
  ['gum_2-15', 'GUM_2-15'],
  ['KEY-123', 'KEY-123'],
])('issue ref %s', (input, key) => { expect(parseIssueRef(input).key).toBe(key); });
it('rejects keys that do not match [A-Z][A-Z0-9_]+-\\d+', () => { expect(() => parseIssueRef('1A-2')).toThrow(/Not a Jira issue URL or key/); });
```

```ts
// test/core/sites.test.ts  (sites: gumperr -> gumperr.atlassian.net, qint -> qint.atlassian.net)
it('selects by URL host', () => { expect(resolveSite(two, { host: 'qint.atlassian.net' }).name).toBe('qint'); });
it('fails when site and URL host disagree', () => { expect(() => resolveSite(two, { site: 'gumperr', host: 'qint.atlassian.net' })).toThrow(/URL belongs to qint\.atlassian\.net but site "gumperr" was given/); });
it('matches site by name or host case-insensitively', () => {
  expect(resolveSite(two, { site: 'QINT' }).name).toBe('qint');
  expect(resolveSite(two, { site: 'Gumperr.Atlassian.net' }).name).toBe('gumperr');
});
it('uses the only site when nothing is given', () => { expect(resolveSite([gumperr], {}).name).toBe('gumperr'); });
it('lists names when ambiguous', () => { expect(() => resolveSite(two, {})).toThrow('Several sites are configured; pass site as one of: gumperr, qint.'); });
it('reports unknown hosts with configured names', () => { expect(() => resolveSite(two, { host: 'other.atlassian.net' })).toThrow(/No configured site for other\.atlassian\.net; configured: gumperr, qint/); });
it('reports unavailable sites with the reason', () => { expect(() => resolveSite([{ ...gumperr, unavailable: 'env GUMPERR_ATLASSIAN_TOKEN is not set' }], {})).toThrow('Site gumperr is unavailable: env GUMPERR_ATLASSIAN_TOKEN is not set.'); });
it('tells the user how to configure when there are no sites', () => { expect(() => resolveSite([], {})).toThrow('No Atlassian sites are configured. Run "npx atlas-lite-mcp init" or set ATLASSIAN_URL, ATLASSIAN_EMAIL and ATLASSIAN_TOKEN.'); });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core/url.test.ts test/core/sites.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `url.ts` and `sites.ts`**

Page: numeric input, `pageId` query param, or `/pages/(?:edit-v2/)?(\d+)` in the path; `/wiki/x/` is the tiny-link error. Issue: `/browse/(KEY)`, `selectedIssue` query param, or bare key, all matched case-insensitively against `^[A-Z][A-Z0-9_]+-\d+$` after upper-casing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/url.ts src/core/sites.ts test/core/url.test.ts test/core/sites.test.ts
git commit -m "feat: parse page and issue references and resolve sites"
```

---

### Task 3: HTTP client with auth, base URLs, retries and error mapping

**Files:**
- Create: `src/core/http.ts`, `test/helpers/fetch.ts`
- Test: `test/core/http.test.ts`

**Interfaces:**
- Consumes: `Site`, `AtlasError`
- Produces:
  - `type Product = 'jira' | 'confluence'`
  - `type HttpMethod = 'GET' | 'POST' | 'PUT'`
  - `interface RequestOptions { query?: Record<string, string | number | undefined>; body?: unknown; notFound?: string }`
  - `interface HttpClient { request<T>(product: Product, method: HttpMethod, path: string, opts?: RequestOptions): Promise<T> }` (`T` is `undefined` for 204)
  - `interface HttpDeps { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; timeoutMs?: number }`
  - `createHttpClient(site: Site, deps?: HttpDeps): HttpClient`
  - `baseUrlFor(site: Site, product: Product, cloudId?: string): string`
  - Test helper `mockFetch(routes: Route[]): { fetch: typeof fetch; calls: Call[] }` where `Route = { method: string; path: string | RegExp; status?: number; json?: unknown; headers?: Record<string, string>; times?: number; reply?: (call: Call) => { status?: number; json?: unknown; headers?: Record<string, string> } }`, `Call = { method: string; url: string; headers: Record<string, string>; body: any }` (`body` is the parsed JSON request body, `undefined` when none, typed `any` because this is a test helper so tests read its properties directly; header names lower-cased); routes match on method plus URL pathname (string = exact pathname, RegExp = tested against pathname + search); a route with `times` is consumed in order; unmatched calls throw.

- [ ] **Step 1: Write the failing tests**

```ts
// test/core/http.test.ts  (site gumperr classic, email a@b.c, token tok-SECRET-123; sleep = vi.fn(async () => {}))
it('sends Basic auth and JSON headers to the site URL for classic tokens', async () => {
  const m = mockFetch([{ method: 'GET', path: '/rest/api/3/myself', json: { accountId: '1' } }]);
  await createHttpClient(gumperr, { fetch: m.fetch }).request('jira', 'GET', '/rest/api/3/myself');
  expect(m.calls[0]!.url).toBe('https://gumperr.atlassian.net/rest/api/3/myself');
  expect(m.calls[0]!.headers.authorization).toBe('Basic ' + Buffer.from('a@b.c:tok-SECRET-123').toString('base64'));
  expect(m.calls[0]!.headers.accept).toBe('application/json');
});
it('uses api.atlassian.com with a cloudId resolved once from tenant_info for scoped tokens', async () => {
  const m = mockFetch([
    { method: 'GET', path: '/_edge/tenant_info', json: { cloudId: 'c-1' } },
    { method: 'GET', path: '/ex/jira/c-1/rest/api/3/myself', json: {} },
    { method: 'GET', path: '/ex/confluence/c-1/wiki/api/v2/spaces', json: { results: [] } },
  ]);
  const c = createHttpClient({ ...gumperr, tokenType: 'scoped' }, { fetch: m.fetch });
  await c.request('jira', 'GET', '/rest/api/3/myself');
  await c.request('confluence', 'GET', '/wiki/api/v2/spaces');
  expect(m.calls.filter(x => x.url.endsWith('/_edge/tenant_info'))).toHaveLength(1);
  expect(m.calls[0]!.headers.authorization).toBeUndefined();
});
it('skips tenant_info when cloudId is configured', async () => {
  const m = mockFetch([{ method: 'GET', path: '/ex/jira/c-9/rest/api/3/myself', json: {} }]);
  await createHttpClient({ ...gumperr, tokenType: 'scoped', cloudId: 'c-9' }, { fetch: m.fetch }).request('jira', 'GET', '/rest/api/3/myself');
  expect(m.calls.map(c => c.url)).toEqual(['https://api.atlassian.com/ex/jira/c-9/rest/api/3/myself']);
});
it('retries 429 honouring Retry-After, capped at 60 s, and succeeds', async () => {
  const m = mockFetch([
    { method: 'GET', path: '/rest/api/3/myself', status: 429, headers: { 'retry-after': '120' }, times: 1 },
    { method: 'GET', path: '/rest/api/3/myself', json: { ok: true } },
  ]);
  const sleep = vi.fn(async () => {});
  await expect(createHttpClient(gumperr, { fetch: m.fetch, sleep }).request('jira', 'GET', '/rest/api/3/myself')).resolves.toEqual({ ok: true });
  expect(sleep).toHaveBeenCalledWith(60000);
});
it('gives up after 3 retries and includes RateLimit-Reason', async () => {
  // 4 responses of 429 with 'retry-after': '1', 'ratelimit-reason': 'jira-burst-based'
  await expect(req()).rejects.toThrow('Rate limited by site gumperr after 3 retries (jira-burst-based); try again in a minute.');
  expect(m.calls).toHaveLength(4);
});
it('maps 401 to the expiry hint', async () => { await expect(req401()).rejects.toThrow('Token for site gumperr rejected (401). Tokens expire after at most 365 days; create a new one at id.atlassian.com/manage-profile/security/api-tokens and update sites.json.'); });
it('maps 403 naming site and likely causes', async () => { await expect(req403()).rejects.toThrow('Access denied on site gumperr (403): the account may lack access to this product or item, or a scoped token is missing a scope.'); });
it('maps 404 with the caller description and the permission note', async () => {
  await expect(client.request('confluence', 'GET', '/wiki/api/v2/pages/9', { notFound: 'page 9' })).rejects.toThrow('Not found on site gumperr: page 9. Atlassian also returns 404 when the account lacks permission.');
});
it('surfaces the first Atlassian error message for other 4xx', async () => {
  // 400 json { errorMessages: [], errors: { summary: 'You must specify a summary of the issue.' } }
  await expect(req400()).rejects.toThrow('Site gumperr rejected the request (400): You must specify a summary of the issue.');
});
it('keeps the status on errors so callers can react to 409', async () => { await expect(req409()).rejects.toMatchObject({ status: 409 }); });
it('times out after 30 s', async () => { /* fetch that rejects with DOMException name TimeoutError */ await expect(r).rejects.toThrow('Request to site gumperr timed out after 30 s.'); });
it('never includes the token in any error message', async () => { for (const p of [req401(), req403(), req400(), reqNetwork()]) await p.catch(e => expect(e.message).not.toContain('tok-SECRET-123')); });
it('encodes query params and JSON bodies, returns undefined for 204', async () => {
  const m = mockFetch([{ method: 'PUT', path: '/rest/api/3/issue/GUM-1', status: 204 }]);
  const r = await createHttpClient(gumperr, { fetch: m.fetch }).request('jira', 'PUT', '/rest/api/3/issue/GUM-1', { query: { a: 'x y', b: 2, c: undefined }, body: { fields: { summary: 'S' } } });
  expect(r).toBeUndefined();
  expect(m.calls[0]!.url).toBe('https://gumperr.atlassian.net/rest/api/3/issue/GUM-1?a=x+y&b=2');
  expect(m.calls[0]!.headers['content-type']).toBe('application/json');
  expect(m.calls[0]!.body).toEqual({ fields: { summary: 'S' } });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core/http.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `createHttpClient` and `baseUrlFor`**

`baseUrlFor`: classic -> `site.baseUrl`; scoped -> `https://api.atlassian.com/ex/${product}/${cloudId}`; paths always carry their full `/rest/...` or `/wiki/...` prefix (the one place to change if build-time verification shows scoped Confluence drops `/wiki`). Timeout via `AbortSignal.timeout(deps.timeoutMs ?? 30000)`. `Retry-After` is seconds or an HTTP date; absent -> `2 ** attempt` seconds; each wait `Math.min(ms, 60000)`. 5xx -> `Site gumperr returned 502; try again shortly.` Network errors -> `Could not reach site gumperr (<code or message>).` First Atlassian message: `errorMessages[0]`, else first value of `errors` object, else `errors[0].title` (Confluence v2), else `message`. `User-Agent: atlas-lite-mcp`. Query strings are built with `URLSearchParams` (`undefined` values skipped); a request with a body sends it as JSON with `content-type: application/json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core/http.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/http.ts test/helpers/fetch.ts test/core/http.test.ts
git commit -m "feat: add per-site HTTP client with retries and clear errors"
```

---

### Task 4: Storage DOM helpers, find and replace, well-formedness

**Files:**
- Create: `src/confluence/storage/dom.ts`, `src/confluence/storage/edit.ts`, `test/fixtures/confluence/rich-page.xml`, `test/helpers/fixtures.ts`
- Test: `test/confluence/storage/edit.test.ts`, `test/confluence/storage/dom.test.ts`

**Interfaces:**
- Produces:
  - `parseStorage(storage: string): Document` (domhandler `Document`; options pinned in the decisions table)
  - `textOf(node: AnyNode): string` (all descendant text and CDATA, entities decoded with `decodeHTML`, `\u00a0` -> space, whitespace collapsed, trimmed)
  - `openTagEnd(src: string, el: Element): number` (index just after the opening tag's `>`, quote-aware)
  - `innerRange(src: string, el: Element): { start: number; end: number } | null` (null when self-closing)
  - `openTag(src: string, el: Element): string` (source text of the opening tag, `/>` turned into `>`)
  - `escapeXml(text: string): string` (`&`, `<`, `>`, `"`)
  - `findReplace(storage: string, find: string, replace: string, all: boolean): { storage: string; count: number }`
  - `assertWellFormed(storage: string): void`
  - `fixture(name: string): string` test helper reading `test/fixtures/<name>`

- [ ] **Step 1: Write the fixture `test/fixtures/confluence/rich-page.xml`**

Used by Tasks 4 to 13. Synthetic, but modelled on real storage structures (`ac:structured-macro` with `ac:parameter` and `ac:rich-text-body`, `ac:image`/`ri:attachment`, `ac:layout`/`ac:layout-section`/`ac:layout-cell`, tables with `th`/`td`, `&nbsp;`, CDATA code bodies); real pages are covered by the Task 18 smoke test. Exact content (one element per line):

```xml
<h1>Overview</h1>
<ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="m-toc"/>
<p>Status: <ac:structured-macro ac:name="status" ac:schema-version="1" ac:macro-id="m-st"><ac:parameter ac:name="title">ON TRACK</ac:parameter><ac:parameter ac:name="colour">Green</ac:parameter></ac:structured-macro> for R&amp;D&nbsp;team <ac:emoticon ac:name="smile"/></p>
<ac:structured-macro ac:name="info" ac:schema-version="1" ac:macro-id="m-info"><ac:rich-text-body><p>Budget is <strong>frozen</strong>.</p></ac:rich-text-body></ac:structured-macro>
<h2>Budget</h2>
<p>Numbers in CHF.</p>
<table data-layout="default"><colgroup><col/><col/><col/></colgroup><tbody><tr><th><p><strong>Item</strong></p></th><th><p><strong>Q1&nbsp;2026</strong></p></th><th><p><strong>Q2</strong></p></th></tr><tr><td><p>Hosting</p></td><td><p>100</p></td><td><p>120</p></td></tr><tr><td><p>Licences</p></td><td><p><strong>40</strong></p></td><td><p>40</p></td></tr><tr><td><p>Support </p></td><td><p><ac:structured-macro ac:name="status" ac:schema-version="1" ac:macro-id="m-st2"><ac:parameter ac:name="title">TBD</ac:parameter></ac:structured-macro></p></td><td><p/></td></tr></tbody></table>
<h3>Notes</h3>
<p>See <a href="https://example.com/a?b=1&amp;c=2">the sheet</a> and <code>cfg.json</code>.</p>
<ac:structured-macro ac:name="code" ac:schema-version="1" ac:macro-id="m-code"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[if (a < b && c) {}]]></ac:plain-text-body></ac:structured-macro>
<h2>Team</h2>
<p>Two columns below.</p>
<ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell><h2>Left</h2><p>Ana</p><ac:image ac:width="200"><ri:attachment ri:filename="ana.png"/></ac:image></ac:layout-cell><ac:layout-cell><h2>Right</h2><p>Marko</p></ac:layout-cell></ac:layout-section></ac:layout>
<h2>Done</h2>
<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>Ship</ac:task-body></ac:task></ac:task-list>
```

- [ ] **Step 2: Write the failing tests**

```ts
// test/confluence/storage/dom.test.ts
it('textOf decodes entities and nbsp and collapses whitespace', () => {
  const doc = parseStorage('<p> R&amp;D&nbsp;team\n x </p>');
  expect(textOf(doc.children[0]!)).toBe('R&D team x');
});
it('innerRange and openTag respect quotes containing >', () => {
  const src = '<p title="a>b">x</p><p/>';
  const [p1, p2] = parseStorage(src).children as [Element, Element];
  expect(src.slice(innerRange(src, p1)!.start, innerRange(src, p1)!.end)).toBe('x');
  expect(openTag(src, p1)).toBe('<p title="a>b">');
  expect(innerRange(src, p2)).toBeNull();
  expect(openTag(src, p2)).toBe('<p>');
});
```

```ts
// test/confluence/storage/edit.test.ts  (page = fixture('confluence/rich-page.xml'))
it('replaces exactly one match and leaves every other byte identical', () => {
  const r = findReplace(page, '<p>Numbers in CHF.</p>', '<p>Numbers in EUR.</p>', false);
  expect(r.count).toBe(1);
  const i = page.indexOf('<p>Numbers in CHF.</p>');
  expect(r.storage.slice(0, i)).toBe(page.slice(0, i));
  expect(r.storage.slice(i + '<p>Numbers in EUR.</p>'.length)).toBe(page.slice(i + '<p>Numbers in CHF.</p>'.length));
});
it('errors on zero matches with the storage hint', () => {
  expect(() => findReplace(page, 'Budget is frozen', 'x', false)).toThrow('No match for the find text. Text seen in markdown may be split by inline markup or entities; call page_get with format "storage" or a section to copy the exact markup.');
});
it('errors on several matches without all, showing the count and up to three contexts', () => {
  expect(() => findReplace(page, '<td><p>1', 'x', false)).toThrow(/^Found 2 matches; pass all: true or use a longer find text\. Matches: "/);
});
it('replaces a single match with all: true and reports the count', () => {
  const r = findReplace(page, '<p>Hosting</p>', '<p>Web hosting</p>', true);
  expect(r.count).toBe(1);
  expect(r.storage).toBe(page.replace('<p>Hosting</p>', '<p>Web hosting</p>'));
});
it('replaces every match with all: true', () => {
  const r = findReplace(page, 'ac:schema-version="1"', 'ac:schema-version="2"', true);
  expect(r.count).toBe(5);
  expect(r.storage).toBe(page.split('ac:schema-version="1"').join('ac:schema-version="2"'));
});
it('falls back to the XML-escaped form and escapes replace the same way', () => {
  const r = findReplace(page, 'R&D', 'R&D & Ops', false);
  expect(r.storage).toContain('for R&amp;D &amp; Ops&nbsp;team');
});
it('rejects empty find', () => { expect(() => findReplace(page, '', 'x', false)).toThrow('find must not be empty.'); });
it('assertWellFormed accepts the fixture and rejects broken markup', () => {
  expect(() => assertWellFormed(page)).not.toThrow();
  expect(() => assertWellFormed('<p>a<strong>b</p>')).toThrow(/^Edit would produce malformed XML \(.+\); nothing was written\.$/);
  expect(() => assertWellFormed('<p>a & b</p>')).toThrow(/malformed XML/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run test/confluence/storage`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `dom.ts` and `edit.ts`**

`findReplace` counts non-overlapping literal occurrences (`indexOf` loop, no regex). Contexts: 30 characters either side of each of the first three matches, newlines collapsed, joined as `"...ctx...", "...ctx..."`. Escaped fallback applies only when the literal count is 0, `escapeXml(find) !== find`, and the escaped count is at least 1. `findReplace` does not call `assertWellFormed`; `writePage` (Task 10) does for every write.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/confluence/storage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/confluence/storage test/confluence/storage test/fixtures/confluence/rich-page.xml test/helpers/fixtures.ts
git commit -m "feat: add storage find and replace with well-formedness check"
```

---

### Task 5: Placeholders and storage to markdown

**Files:**
- Create: `src/core/placeholders.ts`, `src/core/format.ts`, `src/confluence/storage/placeholders.ts`, `src/confluence/convert/toMarkdown.ts`
- Test: `test/core/placeholders.test.ts`, `test/core/format.test.ts`, `test/confluence/convert/toMarkdown.test.ts`

**Interfaces:**
- Consumes: `parseStorage`, `textOf` (Task 4)
- Produces:
  - `interface Placeholder<T = unknown> { n: number; hint: string; original: T; block: boolean }` (`src/core/placeholders.ts`)
  - `interface StoragePlaceholder extends Placeholder<string> { start: number; end: number }` (`end` exclusive; lives in `src/confluence/storage/placeholders.ts`, core never imports it)
  - `const TOKEN_RE: RegExp` = `/\{\{atlas:(\d+)\}\}(?: \[[^\]\n]*\])?/g`
  - `tokenText(p: Placeholder): string` -> `{{atlas:3}} [macro: toc]`
  - `plural(n: number, word: string): string` in `src/core/format.ts` (`1 item`, `2 items`; Task 10 adds `mdTable` and `versionLine` to this file)
  - `formatDropped(dropped: Placeholder[], unknown: number[]): string | null` -> `Dropped: 2 items: [macro: toc], [image: screenshot.png]` (count via `plural(n, 'item')`, unknown as `{{atlas:9}} [unknown token]`), null when both empty
  - `class PlaceholderStore<T extends Placeholder> { constructor(maxEntries = 100); getOrBuild(key: string, version: string, build: () => T[]): Map<number, T> }` (rebuilds when the stored version differs; evicts oldest key beyond max; generic so Confluence stores `StoragePlaceholder` and Jira stores `AdfPlaceholder` without core importing either)
  - `collectStoragePlaceholders(storage: string, doc: Document): StoragePlaceholder[]`
  - `storageToMarkdown(storage: string, opts?: { within?: { start: number; end: number } }): { markdown: string; placeholders: StoragePlaceholder[] }` (placeholders always cover the whole body)

- [ ] **Step 1: Write the failing tests**

```ts
// test/core/placeholders.test.ts
it('formats dropped lines', () => {
  expect(formatDropped([p(1, 'macro: toc'), p(2, 'image: screenshot.png')], [])).toBe('Dropped: 2 items: [macro: toc], [image: screenshot.png]');
  expect(formatDropped([], [9])).toBe('Dropped: 1 item: {{atlas:9}} [unknown token]');
  expect(formatDropped([], [])).toBeNull();
});
it('PlaceholderStore rebuilds on version change and caches otherwise', () => {
  const s = new PlaceholderStore<Placeholder<string>>(); const build = vi.fn(() => [p(1, 'x')]);
  const key = 'confluence:page:gumperr:1';
  s.getOrBuild(key, '13', build); s.getOrBuild(key, '13', build);
  expect(s.getOrBuild(key, '14', build).get(1)?.hint).toBe('x');
  expect(build).toHaveBeenCalledTimes(2);
});
```

```ts
// test/core/format.test.ts  (Task 10 adds mdTable and versionLine cases)
it('pluralises', () => {
  expect(plural(1, 'item')).toBe('1 item');
  expect(plural(2, 'item')).toBe('2 items');
  expect(plural(0, 'item')).toBe('0 items');
});
```

```ts
// test/confluence/convert/toMarkdown.test.ts  (page = rich-page.xml)
it('numbers placeholders over the whole body in document order', () => {
  const { placeholders } = storageToMarkdown(page);
  expect(placeholders.map(x => [x.n, x.hint, x.block])).toEqual([
    [1, 'macro: toc', true], [2, 'status: ON TRACK', false], [3, 'emoticon: smile', false],
    [4, 'panel: info, Budget is frozen.', true], [5, 'status: TBD', false], [6, 'image: ana.png', true], [7, 'tasks: 1', true],
  ]);
  expect(page.slice(placeholders[0]!.start, placeholders[0]!.end)).toBe('<ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="m-toc"/>');
});
it('renders standard elements and tokens', () => {
  const md = storageToMarkdown(page).markdown;
  expect(md).toContain('# Overview\n\n{{atlas:1}} [macro: toc]\n\nStatus: {{atlas:2}} [status: ON TRACK] for R&D team {{atlas:3}} [emoticon: smile]');
  expect(md).toContain('| **Item** | **Q1 2026** | **Q2** |\n| --- | --- | --- |\n| Hosting | 100 | 120 |');
  expect(md).toContain('See [the sheet](https://example.com/a?b=1&c=2) and `cfg.json`.');
  expect(md).toContain('```ts\nif (a < b && c) {}\n```');
  expect(md).toContain('## Left\n\nAna\n\n{{atlas:6}} [image: ana.png]');
  expect(md).not.toMatch(/ac:|ri:|<\/?p>/);
});
it('renders only nodes inside a range while keeping page-wide numbers', () => {
  const start = page.indexOf('<h2>Left</h2>') + '<h2>Left</h2>'.length;
  const end = page.indexOf('</ac:layout-cell>');
  expect(storageToMarkdown(page, { within: { start, end } }).markdown.trim()).toBe('Ana\n\n{{atlas:6}} [image: ana.png]');
});
it('keeps a code macro with parameters other than language as a placeholder', () => {
  const s = '<ac:structured-macro ac:name="code"><ac:parameter ac:name="title">x</ac:parameter><ac:plain-text-body><![CDATA[a]]></ac:plain-text-body></ac:structured-macro>';
  expect(storageToMarkdown(s).markdown.trim()).toBe('{{atlas:1}} [macro: code]');
});
it('escapes pipes inside table cells and markdown specials in text', () => {
  expect(storageToMarkdown('<table><tbody><tr><th>a|b</th></tr><tr><td>1*2</td></tr></tbody></table>').markdown).toContain('| a\\|b |\n| --- |\n| 1\\*2 |');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core/placeholders.test.ts test/core/format.test.ts test/confluence/convert`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement placeholder collection and the markdown walker**

Placeholder elements (outermost only, nested ones are inside the original): every `ac:structured-macro` / `ac:macro` except a `code` macro whose only parameter is `language` and that has `ac:plain-text-body`; `ac:image`, `ac:link`, `ac:emoticon`, `ac:task-list`, `ac:placeholder`, `ac:inline-comment-marker` (hint `comment`), `time`, `ri:*` outside the above, and any other `ac:*` element except the transparent layout trio. Hints: `macro: <name>`, `panel: <info|note|warning|tip|panel>, <first 30 chars of text>` for those macro names, `status: <title param>`, `image: <ri:filename or ri:value>`, `emoticon: <ac:name>`, `link: <ri:content-title or text>`, `tasks: <count>`, `date: <datetime>`, `<tag>` otherwise; strip `[`, `]` and newlines from hints. Hints never contain URLs: a hint value that is a URL (for example an external image's `ri:value`) is reduced to its host (`image: example.com`). `block` is true when the element's parent is the document, a layout cell, `ac:rich-text-body`, `td`, `th`, `li` or `blockquote`.

Layout elements (`ac:layout`, `ac:layout-section`, `ac:layout-cell`) are transparent containers in the markdown view: their children render, cells separated by a blank line, and the layout markup itself is never tokenised. This deviates on purpose from the spec's list in 6.7 ("layouts" as placeholders): tokenising a layout would hide the whole body of layout-based pages from `page_get`. Layout markup stays lossless because writes only splice inside sections that end at their containing cell (Task 6). Flag this in the Task 11 commit body.

Range rendering: a node fully outside `within` is skipped, fully inside is rendered, partially overlapping (a container) is descended into. Element mapping: `h1..h6` -> `#` x level, `p` -> paragraph, `ul/ol/li` (nested lists indented two spaces), `strong/b` -> `**`, `em/i` -> `*`, `s/del` -> `~~`, `code` -> backticks, `a` -> `[text](href)`, `br` -> newline, `hr` -> `---`, `blockquote` -> `> `, `table` -> GFM table (first row is the header), `pre` -> fenced block, code macro -> fenced block with language, unknown HTML elements -> their children. Decode entities with `decodeHTML`, then map `\u00a0` to a normal space and collapse whitespace runs to one space (the `textOf` normalisation) in every text run used for matching or markdown output, so `R&amp;D&nbsp;team` renders `R&D team`; CDATA code bodies and `pre` keep their text verbatim. Escape `\ * _ ` [ ]` in text runs and `|` in table cells; tokens and hints are emitted unescaped.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/core/placeholders.test.ts test/core/format.test.ts test/confluence/convert`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/placeholders.ts src/core/format.ts src/confluence/storage/placeholders.ts src/confluence/convert/toMarkdown.ts test/core/placeholders.test.ts test/core/format.test.ts test/confluence/convert/toMarkdown.test.ts
git commit -m "feat: convert storage to markdown with placeholder tokens"
```

---

### Task 6: Section boundaries and outline

**Files:**
- Create: `src/confluence/storage/sections.ts`
- Test: `test/confluence/storage/sections.test.ts`

**Interfaces:**
- Consumes: `parseStorage`, `textOf`, `innerRange` (Task 4)
- Produces:
  - `interface Heading { level: number; text: string; el: Element }`
  - `listHeadings(doc: Document): Heading[]` (document order, any depth)
  - `findSection(storage: string, doc: Document, heading: string): { heading: Heading; start: number; end: number }` (`start` just after the heading element, `end` exclusive)
  - `outline(storage: string): string`
  - `rowCount(table: Element): number` (exported; counts the `tr` elements whose nearest `table` ancestor is `table`, header row included; the only row-counting rule, reused by Task 9)

- [ ] **Step 1: Write the failing tests**

```ts
// test/confluence/storage/sections.test.ts  (page = rich-page.xml; region(name) = page.slice(start, end))
it('ends a section at the next heading of same or higher level, including deeper headings', () => {
  const r = region('Budget');
  expect(r).toContain('<p>Numbers in CHF.</p>'); expect(r).toContain('<h3>Notes</h3>'); expect(r).toContain('m-code');
  expect(r).not.toContain('<h2>Team</h2>');
});
it('stops before a sibling that contains a heading of same or higher level', () => { expect(region('Team').trim()).toBe('<p>Two columns below.</p>'); });
it('ends at the end of the containing layout cell', () => {
  expect(region('Left')).toBe('<p>Ana</p><ac:image ac:width="200"><ri:attachment ri:filename="ana.png"/></ac:image>');
});
it('runs to the end of the body for the last section', () => { expect(region('Done').trim()).toMatch(/^<ac:task-list>.*<\/ac:task-list>$/s); });
it('matches trimmed, case-insensitive, entity-decoded text', () => {
  expect(findSection('<h2> R&amp;D&nbsp;Plan </h2><p>x</p>', parseStorage('<h2> R&amp;D&nbsp;Plan </h2><p>x</p>'), 'r&d plan').heading.text).toBe('R&D Plan');
});
it('lists candidates when missing or ambiguous', () => {
  expect(() => region('Nope')).toThrow('No heading "Nope". Headings: Overview, Budget, Notes, Team, Left, Right, Done.');
  const dup = '<h2>A</h2><p>1</p><h2>a</h2>';
  expect(() => findSection(dup, parseStorage(dup), 'A')).toThrow('Heading "A" matches 2 headings: A, a; use page_edit or make the heading unique.');
});
it('rowCount counts only rows that belong to the table', () => {
  const s = '<table><tbody><tr><td><table><tbody><tr><td>x</td></tr></tbody></table></td></tr><tr><td>y</td></tr></tbody></table>';
  expect(rowCount(parseStorage(s).children[0] as Element)).toBe(2);
});
it('outlines headings and tables', () => {
  expect(outline(page)).toBe([
    'h1 Overview', '  h2 Budget', '    [table 1: 4 rows x 3 cols]', '    h3 Notes', '  h2 Team', '  h2 Left', '  h2 Right', '  h2 Done',
  ].join('\n'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/confluence/storage/sections.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `sections.ts`**

Boundary algorithm (not determined by the signature):

```ts
// L = heading level; siblings = heading.el.parent children after heading.el
for (const sib of siblingsAfter) {
  if (isElement(sib) && (isHeadingAtMost(sib, L) || hasDescendantHeadingAtMost(sib, L))) return { start, end: sib.startIndex };
}
return { start, end: parent is Document ? storage.length : innerRange(storage, parent)!.end };
```

Outline: one line per heading `'  '.repeat(level - 1) + 'h' + level + ' ' + text`; each table is a line `[table N: R rows x C cols]` (rows include the header row; columns from the widest row) indented one level deeper than the most recent heading (no indent before the first heading). Row counts come from `rowCount` (defined here and exported; Task 9 reuses it, so there is one counting rule).

Errors: a missing heading lists every heading (as tested); an ambiguous heading lists the matching headings' texts, up to 5, then `(and N more)`, as in `Heading "A" matches 2 headings: A, a; use page_edit or make the heading unique.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/confluence/storage/sections.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/confluence/storage/sections.ts test/confluence/storage/sections.test.ts
git commit -m "feat: locate page sections and build outlines"
```

---

### Task 7: Markdown to storage, token restoration, section rewrite and append

**Files:**
- Create: `src/markdown/parse.ts`, `src/confluence/convert/fromMarkdown.ts`, `src/confluence/storage/restore.ts`, `src/confluence/storage/rewrite.ts`
- Create: `test/fixtures/confluence/placeholder-section.xml`, `test/fixtures/confluence/clean-section.xml`
- Test: `test/confluence/convert/fromMarkdown.test.ts`, `test/confluence/storage/rewrite.test.ts`

**Interfaces:**
- Consumes: `storageToMarkdown`, `StoragePlaceholder`, `TOKEN_RE`, `collectStoragePlaceholders` (Task 5), `findSection` (Task 6), `parseStorage`, `escapeXml`, `fixture` (Task 4)
- Produces:
  - `parseMarkdown(md: string): Root` (mdast with GFM)
  - `markdownToStorage(md: string): string`
  - `restoreStorageTokens(storage: string, tokens: Map<number, StoragePlaceholder>): { storage: string; used: Set<number>; unknown: number[] }`
  - `replaceSection(storage: string, heading: string, markdown: string, placeholders: Map<number, StoragePlaceholder>): { storage: string; dropped: StoragePlaceholder[]; unknown: number[] }`
  - `appendMarkdown(storage: string, markdown: string, placeholders: Map<number, StoragePlaceholder>): { storage: string; unknown: number[] }`
  - `placeholders` is the page-wide map for this exact storage version: the tools (Task 11) take it from the runtime's placeholder store, which rebuilds it with `collectStoragePlaceholders` when the stored version differs from the current page version (spec 6.7)

- [ ] **Step 1: Write the fixtures**

`placeholder-section.xml` (no newlines):

```xml
<h2>Gallery</h2><p>Intro text.</p><ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="abc"/><p>See <ac:image ac:width="400"><ri:attachment ri:filename="screenshot.png"/></ac:image> above.</p><ul><li><p>one</p></li><li><p>two <strong>bold</strong></p></li></ul><h2>Next</h2><p>Tail</p>
```

`clean-section.xml`: storage exactly as `markdownToStorage` emits it for headings 1 to 3, a paragraph with `<strong>`, `<em>`, `<code>`, a link, a nested bullet list, an ordered list, a GFM table, and a `ts` fenced block (synthetic, written by hand but modelled on real storage structures, used as the round-trip golden; real pages are covered by the Task 18 smoke test).

- [ ] **Step 2: Write the failing tests**

```ts
// test/confluence/convert/fromMarkdown.test.ts
it('emits clean XHTML for standard markdown', () => {
  expect(markdownToStorage('## Plan\n\nA **b** *c* `d` [e](https://x.y/?a=1&b=2)')).toBe('<h2>Plan</h2><p>A <strong>b</strong> <em>c</em> <code>d</code> <a href="https://x.y/?a=1&amp;b=2">e</a></p>');
  expect(markdownToStorage('- one\n  - two')).toBe('<ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul>');
  expect(markdownToStorage('| A | B |\n|---|---|\n| 1 | 2 |')).toBe('<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>');
});
it('emits fenced code as a code macro with CDATA, splitting ]]>', () => {
  expect(markdownToStorage('```ts\na ]]> b\n```')).toBe('<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[a ]]]]><![CDATA[> b]]></ac:plain-text-body></ac:structured-macro>');
});
it('escapes XML specials and raw HTML in text', () => { expect(markdownToStorage('a < b & <script>x</script>')).toBe('<p>a &lt; b &amp; &lt;script&gt;x&lt;/script&gt;</p>'); });
it('round-trips the clean fixture byte for byte', () => {
  const clean = fixture('confluence/clean-section.xml');
  expect(markdownToStorage(storageToMarkdown(clean).markdown)).toBe(clean);
});
it('round-trips text with &, < and | through storage and back', () => {
  const md = '| a |\n| --- |\n| x \\| y & <z> |';
  expect(storageToMarkdown(markdownToStorage(md)).markdown.trim()).toBe(md);
});
```

```ts
// test/confluence/storage/rewrite.test.ts
const page = fixture('confluence/placeholder-section.xml');
const tokens = (s: string) => new Map(collectStoragePlaceholders(s, parseStorage(s)).map(p => [p.n, p] as const));
it('shows the section as markdown with tokens', () => {
  const { start, end } = findSection(page, parseStorage(page), 'Gallery');
  expect(storageToMarkdown(page, { within: { start, end } }).markdown.trim()).toBe('Intro text.\n\n{{atlas:1}} [macro: toc]\n\nSee {{atlas:2}} [image: screenshot.png] above.\n\n- one\n- two **bold**');
});
it('writes the section back unchanged when tokens are kept (spec 6.11)', () => {
  const md = 'Intro text.\n\n{{atlas:1}} [macro: toc]\n\nSee {{atlas:2}} [image: screenshot.png] above.\n\n- one\n- two **bold**';
  const r = replaceSection(page, 'Gallery', md, tokens(page));
  expect(r.storage).toBe(page); expect(r.dropped).toEqual([]); expect(r.unknown).toEqual([]);
});
it('reports a removed token as dropped and keeps bytes outside the section', () => {
  const r = replaceSection(page, 'Gallery', 'Intro text.\n\nSee {{atlas:2}} [image: screenshot.png] above.', tokens(page));
  expect(r.dropped.map(d => d.hint)).toEqual(['macro: toc']);
  expect(r.storage.startsWith('<h2>Gallery</h2>')).toBe(true);
  expect(r.storage.endsWith('<h2>Next</h2><p>Tail</p>')).toBe(true);
});
it('ignores edited hint text and reports unknown tokens', () => {
  const r = replaceSection(page, 'Gallery', '{{atlas:1}} [whatever]\n\n{{atlas:99}} [x]', tokens(page));
  expect(r.storage).toContain('<h2>Gallery</h2><ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="abc"/><h2>Next</h2>');
  expect(r.unknown).toEqual([99]);
});
it('appends converted markdown and restores tokens copied from the page', () => {
  const r = appendMarkdown(page, 'More {{atlas:2}} [image: screenshot.png]', tokens(page));
  expect(r.storage).toBe(page + '<p>More <ac:image ac:width="400"><ri:attachment ri:filename="screenshot.png"/></ac:image></p>');
  expect(r.unknown).toEqual([]);
  expect(appendMarkdown(page, 'x {{atlas:99}}', tokens(page)).unknown).toEqual([99]);
});
it('keeps the rich page byte-identical outside the targeted section', () => {
  const rich = fixture('confluence/rich-page.xml');
  const { start, end } = findSection(rich, parseStorage(rich), 'Left');
  const out = replaceSection(rich, 'Left', 'Ana and Ivan\n\n{{atlas:6}} [image: ana.png]', tokens(rich)).storage;
  expect(out.slice(0, start)).toBe(rich.slice(0, start));
  expect(out.slice(out.length - (rich.length - end))).toBe(rich.slice(end));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run test/confluence/convert/fromMarkdown.test.ts test/confluence/storage/rewrite.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement the emitter, restoration and rewrite**

Emitter per mdast node: `heading` -> `<hN>`, `paragraph` -> `<p>`, `list` -> `<ul>`/`<ol>` with `<li><p>..</p>..</li>`, `strong`, `emphasis`, `delete` -> `<s>`, `inlineCode` -> `<code>`, `link` -> `<a href>`, `image` -> link to its URL, `break` -> `<br/>`, `thematicBreak` -> `<hr/>`, `blockquote`, `table` (first row `th`), `code` -> code macro (omit the language parameter when none), `html` -> escaped text. No newlines between elements.

Restoration algorithm (`restoreStorageTokens`):

```ts
// pass 1: a paragraph that holds only one token (plus optional hint)
out = s.replace(/<p>\s*\{\{atlas:(\d+)\}\}(?: \[[^\]\n]*\])?\s*<\/p>/g, (m, n) => tok(n) ? (tok(n).block ? tok(n).original : `<p>${tok(n).original}</p>`) : (unknown.push(+n), ''));
// pass 2: any remaining token inline
out = out.replace(TOKEN_RE, (m, n) => tok(n) ? tok(n).original : (unknown.push(+n), ''));
// used = every n substituted; the hint regex also matches escaped hint text because hints contain no ] or newline
```

`replaceSection`: parse, `findSection`, `restoreStorageTokens(markdownToStorage(md), placeholders)` with the page-wide map it was given, splice `[start, end)`; `dropped` = entries of `placeholders` whose `start` lies in `[start, end)` and `n` not in `used`. `appendMarkdown`: same conversion with the same map, concatenated at the end of the body; nothing on the page is replaced, so there is no dropped list, and `unknown` goes to the caller's `Dropped:` line (Task 11).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/confluence`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/markdown src/confluence/convert/fromMarkdown.ts src/confluence/storage/restore.ts src/confluence/storage/rewrite.ts test/fixtures/confluence test/confluence
git commit -m "feat: convert markdown to storage and restore placeholder tokens"
```

---

### Task 8: Markdown to and from ADF with placeholders

**Files:**
- Create: `src/jira/adf/toMarkdown.ts`, `src/jira/adf/fromMarkdown.ts`, `test/fixtures/jira/issue-rich.json`
- Test: `test/jira/adf.test.ts`

**Interfaces:**
- Consumes: `parseMarkdown` (Task 7), `Placeholder`, `TOKEN_RE`, `tokenText` (Task 5)
- Produces:
  - `interface AdfNode { type: string; attrs?: Record<string, unknown>; content?: AdfNode[]; marks?: { type: string; attrs?: Record<string, unknown> }[]; text?: string }` (exported from `src/jira/adf/toMarkdown.ts`, as are `AdfDoc` and `AdfPlaceholder`)
  - `type AdfDoc = { type: 'doc'; version: 1; content: AdfNode[] }`
  - `type AdfPlaceholder = Placeholder<AdfNode>`
  - `adfToMarkdown(doc: AdfDoc | AdfNode | null | undefined, startAt?: number): { markdown: string; placeholders: AdfPlaceholder[] }` (numbers start at `startAt`, default 1)
  - `markdownToAdf(md: string, tokens?: Map<number, AdfPlaceholder>): { doc: AdfDoc; used: Set<number>; unknown: number[] }`

- [ ] **Step 1: Write the fixture**

`issue-rich.json`: `{ "description": <ADF doc>, "comments": [<ADF doc>, <ADF doc>] }`. Description content in order: heading level 2 `Steps`; paragraph `Open ` + bold `login` + ` then ` + italic `wait` + ` and run ` + code `npm test` + ` see ` + link `docs` (href `https://x.y`) + ` cc ` + mention (`attrs.id` `u1`, `text` `@Ana`); bulletList of `one`, `two`; codeBlock language `ts` text `a < b`; mediaSingle with media `attrs.alt` `shot.png`; panel `panelType` `info` containing paragraph `Careful`; table 2x2 (header `A`,`B`; cells `1`,`2`). Comment 1: paragraph `Looks good ` + inlineCard url `https://x.y/z`. Comment 2: paragraph `Done`. Write the supported nodes in exactly the canonical form `markdownToAdf` emits (adjacent text nodes merged when their marks match, no `localId`, no table `attrs`), because the round-trip test compares with `toEqual`.

- [ ] **Step 2: Write the failing tests**

```ts
// test/jira/adf.test.ts  (fx = JSON.parse(fixture('jira/issue-rich.json')))
it('renders supported nodes and tokens', () => {
  const { markdown, placeholders } = adfToMarkdown(fx.description);
  expect(markdown).toContain('## Steps\n\nOpen **login** then *wait* and run `npm test` see [docs](https://x.y) cc {{atlas:1}} [mention: @Ana]');
  expect(markdown).toContain('- one\n- two');
  expect(markdown).toContain('```ts\na < b\n```');
  expect(markdown).toContain('{{atlas:2}} [media: shot.png]\n\n{{atlas:3}} [panel: info, Careful]');
  expect(markdown).toContain('| A | B |\n| --- | --- |\n| 1 | 2 |');
  expect(placeholders.map(p => [p.n, p.block])).toEqual([[1, false], [2, true], [3, true]]);
});
it('continues numbering across comments', () => { expect(adfToMarkdown(fx.comments[0], 4).markdown).toBe('Looks good {{atlas:4}} [card: x.y]'); });
it('builds valid ADF for supported markdown', () => {
  const { doc } = markdownToAdf('# T\n\nA **b** `c` [d](https://e.f)\n\n1. x\n\n```js\ny\n```');
  expect(doc).toEqual({ type: 'doc', version: 1, content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'T' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'A ' }, { type: 'text', text: 'b', marks: [{ type: 'strong' }] }, { type: 'text', text: ' ' }, { type: 'text', text: 'c', marks: [{ type: 'code' }] }, { type: 'text', text: ' ' }, { type: 'text', text: 'd', marks: [{ type: 'link', attrs: { href: 'https://e.f' } }] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] },
    { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'y' }] },
  ] });
});
it('round-trips the fixture description unchanged when tokens are kept', () => {
  const { markdown, placeholders } = adfToMarkdown(fx.description);
  const back = markdownToAdf(markdown, new Map(placeholders.map(p => [p.n, p])));
  expect(back.doc).toEqual(fx.description); expect(back.unknown).toEqual([]);
});
it('splits a paragraph when a block token sits inside text', () => {
  const t = new Map([[2, { n: 2, hint: 'media: shot.png', block: true, original: fx.description.content[4] }]]);
  expect(markdownToAdf('before {{atlas:2}} [media: shot.png] after', t).doc.content.map((n: AdfNode) => n.type)).toEqual(['paragraph', 'mediaSingle', 'paragraph']);
});
it('reports unknown tokens and leaves them out', () => { expect(markdownToAdf('x {{atlas:7}}').unknown).toEqual([7]); });
it('restores a leading token and drops the rest of its paragraph, autolinks included', () => {
  const card: AdfNode = { type: 'inlineCard', attrs: { url: 'https://example.com/x' } };
  const t = new Map([[2, { n: 2, hint: 'card: example.com', block: false, original: card }]]);
  expect(markdownToAdf('{{atlas:2}} [card: example.com] and https://example.com/more text', t).doc).toEqual({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [card] }] });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run test/jira/adf.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement both walkers**

ADF -> markdown: `paragraph`, `heading`, `bulletList`, `orderedList`, `listItem`, `codeBlock`, `blockquote`, `rule`, `hardBreak`, `table`/`tableRow`/`tableHeader`/`tableCell`, `text` with marks `strong`, `em`, `code`, `strike`, `link`; everything else becomes a token. Block placeholder types: `mediaSingle`, `mediaGroup`, `panel`, `blockCard`, `embedCard`, `expand`, `nestedExpand`, `extension`, `bodiedExtension`, `taskList`, `decisionList`, `layoutSection`; all others are inline. Hints: `mention: <attrs.text>`, `media: <attrs.alt or first media attrs.id>`, `panel: <panelType>, <first 30 chars>`, `card: <host of attrs.url>`, `emoji: <attrs.shortName>`, `status: <attrs.text>`, `date: <ISO date>`, `<type>` otherwise. Hints never contain URLs (a URL is reduced to its host, as in `card: example.com`).

markdown -> ADF: the result is an `AdfDoc` (`{ type: 'doc', version: 1, content }`); `code` mark never combines with other marks except `link`; a `listItem` always starts with a `paragraph`; table first row uses `tableHeader`; `html` nodes become text. Token restoration on the produced tree:

```ts
// for each paragraph: split its text nodes on TOKEN_RE into segments [text | token n]
// if the paragraph is exactly one token: block original -> replace the paragraph with it; inline original -> paragraph [original]
// else inline originals go in place (marks dropped); a block original splits the paragraph into
//   paragraph(before), original, paragraph(after), dropping empty paragraphs
// a paragraph whose leading text matches TOKEN_RE (token at the very start): restore that token as above and drop
//   the remainder of the paragraph, whatever its node types (text, links, autolinks)
// unknown n -> removed (with its hint), recorded in unknown
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/jira/adf.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/jira/adf test/jira/adf.test.ts test/fixtures/jira/issue-rich.json
git commit -m "feat: convert markdown to and from ADF with placeholder tokens"
```

---

### Task 9: Table operations on storage

**Files:**
- Create: `src/confluence/storage/tables.ts`
- Test: `test/confluence/storage/tables.test.ts`

**Interfaces:**
- Consumes: `parseStorage`, `textOf`, `innerRange`, `openTag`, `escapeXml` (Task 4), `listHeadings`, `rowCount` (Task 6)
- Produces:
  - `interface TableInfo { index: number; el: Element; rows: Element[]; header: string[]; rowCount: number; colCount: number }` (`rowCount` is `rowCount(el)` from Task 6)
  - `listTables(doc: Document): TableInfo[]` (document order, nested tables counted; `rows` excludes rows of nested tables)
  - `selectTable(storage: string, doc: Document, sel?: number | string): TableInfo`
  - `updateCell(storage: string, sel: number | string | undefined, row: string, column: string, value: string): { storage: string; old: string; table: number }`
  - `addRow(storage: string, sel: number | string | undefined, cells: Record<string, string>, position?: string): { storage: string; table: number }` (`position` is `'end'` (default) or `'after:<row label>'`)

- [ ] **Step 1: Write the failing tests**

```ts
// test/confluence/storage/tables.test.ts  (page = rich-page.xml; multi = page + '<h2>Extra</h2><table><tbody><tr><th>K</th></tr><tr><td>v</td></tr></tbody></table>')
it('selects by index, by heading text, or the only table', () => {
  expect(selectTable(page, parseStorage(page)).index).toBe(1);
  expect(selectTable(multi, parseStorage(multi), 2).header).toEqual(['K']);
  expect(selectTable(multi, parseStorage(multi), 'extra').index).toBe(2);
  expect(() => selectTable(multi, parseStorage(multi))).toThrow('The page has 2 tables; pass table as a number or the heading above it. Tables: 1 under "Budget" (4 rows x 3 cols), 2 under "Extra" (2 rows x 1 cols).');
});
it('updates only the text inside the innermost wrapper, keeping markup and other bytes', () => {
  const r = updateCell(page, undefined, 'licences', 'Q1 2026', '45');
  expect(r.old).toBe('40');
  expect(r.storage).toBe(page.replace('<td><p><strong>40</strong></p></td>', '<td><p><strong>45</strong></p></td>'));
});
it('matches row and column on decoded, trimmed, case-insensitive text', () => {
  expect(updateCell(page, 1, 'SUPPORT', 'q2', 'n/a').storage).toContain('<td><p>n/a</p></td></tr></tbody>');
});
it('escapes values', () => { expect(updateCell(page, 1, 'Hosting', 'Q2', 'a & <b>').storage).toContain('<td><p>a &amp; &lt;b&gt;</p></td>'); });
it('refuses cells with macros, images or nested tables', () => {
  expect(() => updateCell(page, 1, 'Support', 'Q1 2026', 'x')).toThrow('Cell Support / Q1 2026 holds a macro, image or nested table; use page_edit with format "storage" markup.');
});
it('lists candidates for unknown or ambiguous rows and columns', () => {
  expect(() => updateCell(page, 1, 'Nope', 'Q2', 'x')).toThrow('No row "Nope" in table 1. Rows: Hosting, Licences, Support.');
  expect(() => updateCell(page, 1, 'Hosting', 'Q9', 'x')).toThrow('No column "Q9" in table 1. Columns: Item, Q1 2026, Q2.');
  const dup = '<table><tbody><tr><th>K</th><th>V</th><th>v</th></tr><tr><td>a</td><td>1</td><td>2</td></tr><tr><td>A</td><td>3</td><td>4</td></tr></tbody></table>';
  expect(() => updateCell(dup, 1, 'a', 'K', 'x')).toThrow('Row "a" matches 2 rows in table 1: a, A; use page_edit or make the row label unique.');
  expect(() => addRow(dup, 1, { v: 'x' })).toThrow('Column "v" matches 2 columns in table 1: V, v; use page_edit or make the column header unique.');
});
it('refuses rowspan or colspan in the targeted rows', () => {
  const s = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td rowspan="2">x</td><td>1</td></tr></tbody></table>';
  expect(() => updateCell(s, 1, 'x', 'B', '2')).toThrow('Table 1 uses rowspan or colspan in the targeted rows; use page_edit with format "storage" markup.');
});
it('adds a row cloned from a body row, filling by column name', () => {
  const r = addRow(page, 1, { item: 'Backups', Q2: '15' });
  expect(r.storage).toContain('<tr><td><p>Support </p></td>');
  expect(r.storage).toContain('</tr><tr><td><p>Backups</p></td><td><p></p></td><td><p>15</p></td></tr></tbody>');
});
it('inserts after a named row', () => { expect(addRow(page, 1, { Item: 'CDN' }, 'after:hosting').storage).toMatch(/<td><p>Hosting<\/p><\/td>.*?<\/tr><tr><td><p>CDN<\/p><\/td>/); });
it('rejects unknown columns with the header list', () => { expect(() => addRow(page, 1, { Q3: '1' })).toThrow('Unknown column "Q3" in table 1. Columns: Item, Q1 2026, Q2.'); });
it('keeps the rest of the page byte-identical after updateCell', () => {
  const r = updateCell(page, 1, 'Hosting', 'Q2', '125'); const i = page.indexOf('<p>120</p>');
  expect(r.storage.slice(0, i)).toBe(page.slice(0, i));
  expect(r.storage.slice(i + '<p>125</p>'.length)).toBe(page.slice(i + '<p>120</p>'.length));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/confluence/storage/tables.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `tables.ts`**

`rows` are exactly the `tr` elements that `rowCount` (Task 6) counts, those whose nearest `table` ancestor is that table, and `TableInfo.rowCount` is `rowCount(el)`; do not write a second counting rule. Ambiguous row labels or column headers list the matching candidates, up to 5, then `(and N more)`: `Row "a" matches 2 rows in table 1: a, A; use page_edit or make the row label unique.` and `Column "v" matches 2 columns in table 1: V, v; use page_edit or make the column header unique.` Header is row 1; body rows are the rest; a row label is its first cell's `textOf`. Refused content: any descendant named `ac:*`, `ri:*`, `img` or `table`. Cell text replacement (not determined by the tests alone):

```ts
// descend the single-element wrapper chain
let target = cell;
for (;;) {
  const kids = target.children.filter(k => !(isText(k) && k.data.trim() === ''));
  if (kids.length === 1 && isElement(kids[0]) && WRAPPERS.has(kids[0].name)) { target = kids[0]; continue; } // p span strong em b i u s code sub sup
  break;
}
// empty cell (no non-whitespace content) -> inner becomes `<p>${escapeXml(v)}</p>`
// self-closing target (`<p/>`) -> replace the element with openTag(src, target) + escaped + `</${name}>`
// otherwise replace innerRange(src, target) with escapeXml(v)
```

`addRow`: template row is the last body row (`end`) or the named row (`after:`); refuse when the table has no body row (`Table 1 has no body row to copy; use page_edit with format "storage" markup.`). New row = `openTag(tr)` + for each template cell: `openTag(cell)` + the template's wrapper chain open tags (same descent as above; cells with refused content use `<p>`) + escaped value or empty + closing tags; inserted at the template row's `endIndex + 1`. Cell values are matched to header names case-insensitively.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/confluence/storage/tables.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/confluence/storage/tables.ts test/confluence/storage/tables.test.ts
git commit -m "feat: read, update and extend storage tables"
```

---

### Task 10: Tool framework, runtime, Confluence API and the write path

**Files:**
- Create: `src/core/tools.ts`, `src/core/runtime.ts`, `src/confluence/api.ts`, `src/confluence/write.ts`, `test/helpers/runtime.ts`
- Modify: `src/core/format.ts` (add `mdTable`, `versionLine`; `plural` exists from Task 5)
- Test: `test/core/tools.test.ts`, `test/confluence/write.test.ts`; modify `test/core/format.test.ts`

**Interfaces:**
- Consumes: `createHttpClient`, `HttpDeps` (Task 3), `resolveSite` (Task 2), `LoadedConfig`, `AtlasError` (Task 1), `Placeholder`, `PlaceholderStore`, `plural` (Task 5), `assertWellFormed` (Task 4)
- Produces:
  - `interface SiteRuntime { site: Site; http: HttpClient; cache: Map<string, unknown> }`
  - `interface Runtime { resolve(req: { site?: string; host?: string }): SiteRuntime; sites(): Site[]; placeholders: { get<T extends Placeholder>(product: string): PlaceholderStore<T> }; configError?: string }` (`placeholders.get(product)` returns one store per product name, created on first use and reused; core never imports Confluence or Jira types)
  - `createRuntime(cfg: LoadedConfig | { error: string }, deps?: HttpDeps): Runtime` (one `SiteRuntime` per site, created lazily and reused; `resolve` throws `configError` when set)
  - `interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> { name: string; description: string; shape: S; run(args: z.infer<z.ZodObject<S>>, rt: Runtime): Promise<string> }`
  - `interface ProductModule { name: string; tools: ToolDef<any>[] }`
  - `defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S>`
  - `siteParam` = `z.string().optional().describe('Site name or host')`
  - `executeTool(def: ToolDef, args: unknown, rt: Runtime): Promise<{ text: string; isError: boolean }>`
  - `registerModules(server: McpServer, modules: ProductModule[], rt: Runtime): void`
  - `mdTable(headers: string[], rows: string[][]): string`, `versionLine(verb: string, title: string, from: number, to: number, extra?: string): string`, added to `src/core/format.ts` next to `plural` (Task 5)
  - `interface PageData { id: string; title: string; spaceId: string; version: number; storage: string; webui?: string }`
  - `getPage(rt: SiteRuntime, id: string): Promise<PageData>`
  - `putPage(rt: SiteRuntime, page: PageData, storage: string, message: string): Promise<number>` (returns the new version)
  - `writePage(rt: SiteRuntime, pageId: string, tool: string, transform: (page: PageData) => { storage: string; note?: string }): Promise<{ page: PageData; from: number; to: number; note?: string }>`
  - Test helper `testRuntime(routes: Route[], sites?: Site[]): { rt: Runtime; calls: Call[] }` (default one site `gumperr`, sleep is a no-op)

- [ ] **Step 1: Write the failing tests**

```ts
// test/core/format.test.ts  (extends the Task 5 file, which tests plural)
it('formats tables and version lines', () => {
  expect(mdTable(['id', 'title'], [['1', 'a|b']])).toBe('| id | title |\n| --- | --- |\n| 1 | a\\|b |');
  expect(versionLine('Updated', 'Costs', 13, 14, '1 replacement')).toBe('Updated "Costs" v13 -> v14 (1 replacement)');
});
```

```ts
// test/core/tools.test.ts
const echo = defineTool({ name: 'echo', description: 'Echo.', shape: { text: z.string(), site: siteParam }, run: async a => a.text });
it('returns text for success and isError for AtlasError', async () => {
  expect(await executeTool(echo, { text: 'hi' }, rt)).toEqual({ text: 'hi', isError: false });
  const bad = defineTool({ ...echo, run: async () => { throw new AtlasError('Nope.'); } });
  expect(await executeTool(bad, { text: 'x' }, rt)).toEqual({ text: 'Nope.', isError: true });
});
it('reports invalid arguments in one sentence', async () => { expect((await executeTool(echo, {}, rt)).text).toMatch(/^Invalid arguments: text/); });
it('redacts configured tokens from unexpected errors', async () => {
  const leak = defineTool({ ...echo, run: async () => { throw new Error('boom tok-SECRET-123'); } });
  expect(await executeTool(leak, { text: 'x' }, rt)).toEqual({ text: 'Unexpected error: boom ***', isError: true });
});
it('every tool call fails with the config error when config is broken', async () => {
  const broken = createRuntime({ error: 'Could not parse /h/sites.json: Unexpected token.' });
  const t = defineTool({ ...echo, run: async (_a, r) => (r.resolve({}), 'ok') });
  expect(await executeTool(t, { text: 'x' }, broken)).toEqual({ text: 'Could not parse /h/sites.json: Unexpected token.', isError: true });
});
```

```ts
// test/confluence/write.test.ts  (getPage13: GET /wiki/api/v2/pages/7 returns version 13, title Costs, storage '<p>a</p>'; getPage14: the same page at version 14)
it('PUTs version + 1 with the tool message and the full required body', async () => {
  const { rt, calls } = testRuntime([getPage13, { method: 'PUT', path: '/wiki/api/v2/pages/7', json: { version: { number: 14 } } }]);
  const r = await writePage(rt.resolve({}), '7', 'page_edit', p => ({ storage: p.storage.replace('a', 'b') }));
  expect(r).toMatchObject({ from: 13, to: 14 });
  expect(calls[1]!.body).toEqual({ id: '7', status: 'current', title: 'Costs', body: { representation: 'storage', value: '<p>b</p>' }, version: { number: 14, message: 'atlas-lite-mcp page_edit' } });
});
it('re-fetches once and re-applies on 409', async () => {
  const { rt, calls } = testRuntime([
    { ...getPage13, times: 1 },
    { method: 'PUT', path: '/wiki/api/v2/pages/7', status: 409, json: {}, times: 1 },
    getPage14,
    { method: 'PUT', path: '/wiki/api/v2/pages/7', json: { version: { number: 15 } } },
  ]);
  const transform = vi.fn((p: PageData) => ({ storage: p.storage.replace('a', 'b') }));
  const r = await writePage(rt.resolve({}), '7', 'page_edit', transform);
  expect(transform).toHaveBeenCalledTimes(2);
  expect(r).toMatchObject({ from: 14, to: 15 });
  expect(calls.map(c => c.method)).toEqual(['GET', 'PUT', 'GET', 'PUT']);
  expect(calls[3]!.body.version).toEqual({ number: 15, message: 'atlas-lite-mcp page_edit' });
});
it('says so when the transform no longer applies after a 409', async () => {
  await expect(run409ThenTransformThrows()).rejects.toThrow('Page "Costs" changed during the edit and the change no longer applies: No match for the find text.');
});
it('writes nothing when the result is malformed', async () => {
  const { rt, calls } = testRuntime([getPage13]);
  await expect(writePage(rt.resolve({}), '7', 'page_edit', () => ({ storage: '<p>' }))).rejects.toThrow(/malformed XML/);
  expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);
});
it('getPage names the page in 404 errors', async () => { await expect(getPage(rt404.resolve({}), '9')).rejects.toThrow('Not found on site gumperr: page 9. Atlassian also returns 404 when the account lacks permission.'); });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core/tools.test.ts test/core/format.test.ts test/confluence/write.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the framework, runtime, API functions and `writePage`**

`executeTool`: `z.object(def.shape).safeParse(args)`; failure -> `Invalid arguments: <path> <message>; ...`; `AtlasError` -> its message; other errors -> `Unexpected error: ` + message with every configured `apiToken` replaced by `***`. `registerModules` calls `server.registerTool(def.name, { description: def.description, inputSchema: def.shape }, args => executeTool(...) -> { content: [{ type: 'text', text }], isError })`. `getPage` GETs `/wiki/api/v2/pages/{id}` with `query: { 'body-format': 'storage' }` and `notFound: 'page ' + id`. `writePage` calls `assertWellFormed` before every PUT; after a 409 it re-fetches, re-applies the transform and reports the versions of the write that landed (`from: 14, to: 15` in the test); a second 409 -> `Page "Costs" is being edited by someone else; try again.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core src/confluence/api.ts src/confluence/write.ts test/core test/confluence/write.test.ts test/helpers/runtime.ts
git commit -m "feat: add tool framework, runtime and Confluence write path"
```

---

### Task 11: Page read and edit tools

**Files:**
- Create: `src/confluence/tools/pages.ts`, `src/confluence/module.ts`
- Modify: `src/confluence/api.ts` (add `spaceKeyForId`)
- Test: `test/confluence/tools/pages.test.ts`

**Interfaces:**
- Consumes: `defineTool`, `siteParam`, `executeTool`, `writePage`, `getPage`, `versionLine`, `Runtime.placeholders`, `testRuntime` (Task 10); `parsePageRef` (Task 2); `storageToMarkdown`, `StoragePlaceholder`, `collectStoragePlaceholders`, `formatDropped` (Task 5); `findSection`, `outline` (Task 6); `replaceSection`, `appendMarkdown` (Task 7); `parseStorage`, `findReplace` (Task 4)
- Produces:
  - `spaceKeyForId(rt: SiteRuntime, spaceId: string): Promise<string>` (cached in `rt.cache` as `confluence:spaceKey:<site>:<id>`)
  - `pageTools: ToolDef[]` = `page_get`, `page_edit`, `page_update_section`, `page_append`
  - `confluenceModule: ProductModule` (`name: 'confluence'`, tools grow in Tasks 12 and 13)
  - Shared helper in `pages.ts`: `pageTarget(args: { url?: string; id?: string; site?: string }, rt: Runtime): { srt: SiteRuntime; id: string }`

Schemas (keep descriptions to these words; they count toward the budget):
- `page_get`: description `Read a Confluence page as markdown, storage XHTML, or an outline of headings and tables.`; `url?` (`Page URL or id`), `id?` (`Page id`), `format?` enum `markdown|storage|outline` (`Default markdown`), `section?` (`Heading text`), `site`.
- `page_edit`: `Exact find and replace on the page storage XHTML.`; `url` (`Page URL or id`), `find`, `replace`, `all?` (`Replace every match`), `site`.
- `page_update_section`: `Replace the content under a heading with markdown; keep {{atlas:N}} tokens to preserve macros.`; `url`, `heading`, `markdown`, `site`.
- `page_append`: `Append markdown to the end of a page.`; `url`, `markdown`, `site`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/confluence/tools/pages.test.ts  (GET page 7 returns rich-page.xml, title Costs, spaceId 100, v13; GET /wiki/api/v2/spaces/100 -> { key: 'SD' })
it('page_get markdown starts with a header line', async () => {
  const r = await run('page_get', { url: 'https://gumperr.atlassian.net/wiki/spaces/SD/pages/7/Costs' });
  expect(r.text.split('\n').slice(0, 3)).toEqual(['# Costs', 'Page 7 in SD, v13', '']);
  expect(r.text).toContain('{{atlas:1}} [macro: toc]');
});
it('page_get section shows only that section with page-wide numbers', async () => {
  expect((await run('page_get', { id: '7', section: 'left' })).text).toBe('# Costs > Left\nPage 7 in SD, v13\n\nAna\n\n{{atlas:6}} [image: ana.png]');
});
it('page_get outline and storage', async () => {
  expect((await run('page_get', { id: '7', format: 'outline' })).text).toContain('    [table 1: 4 rows x 3 cols]');
  expect((await run('page_get', { id: '7', format: 'storage' })).text).toContain('ac:macro-id="m-toc"');
});
it('page_get requires url or id', async () => { expect(await run('page_get', {})).toEqual({ text: 'Pass url or id.', isError: true }); });
it('page_edit returns count and versions and sends only the changed body', async () => {
  const { text, calls } = await runWithCalls('page_edit', { url: '7', find: 'Numbers in CHF.', replace: 'Numbers in EUR.' });
  expect(text).toBe('Updated "Costs" v13 -> v14 (1 replacement)');
  expect(calls.at(-1)!.body.body.value).toBe(page.replace('Numbers in CHF.', 'Numbers in EUR.'));
});
it('page_update_section restores tokens and reports drops', async () => {
  const r = await run('page_update_section', { url: '7', heading: 'Left', markdown: 'Ana and Ivan' });
  expect(r.text).toBe('Updated section "Left" in "Costs" v13 -> v14\nDropped: 1 item: [image: ana.png]');
});
it('restores tokens in a fresh runtime that never served page_get', async () => {
  const { rt, calls } = testRuntime(routes); // new runtime, empty placeholder store
  await executeTool(byName('page_update_section'), { url: '7', heading: 'Left', markdown: 'Ana\n\n{{atlas:6}} [image: ana.png]' }, rt);
  expect(calls.at(-1)!.body.body.value).toBe(page);
});
it('page_append returns versions', async () => { expect((await run('page_append', { url: '7', markdown: 'Bye' })).text).toBe('Appended to "Costs" v13 -> v14'); });
it('page_append reports unknown tokens as dropped', async () => {
  expect((await run('page_append', { url: '7', markdown: 'Bye {{atlas:99}}' })).text).toBe('Appended to "Costs" v13 -> v14\nDropped: 1 item: {{atlas:99}} [unknown token]');
});
it('rejects a URL whose host is not the given site', async () => {
  expect((await run('page_edit', { url: 'https://qint.atlassian.net/wiki/pages/viewpage.action?pageId=7', find: 'a', replace: 'b', site: 'gumperr' })).isError).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/confluence/tools/pages.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the four tools and `confluenceModule`**

Placeholder map: `rt.placeholders.get<StoragePlaceholder>('confluence').getOrBuild('confluence:page:<site>:<id>', String(page.version), () => collectStoragePlaceholders(page.storage, parseStorage(page.storage)))`. `page_get` fills it; `page_update_section` and `page_append` call it inside the `writePage` transform on the freshly fetched page and pass the map to `replaceSection` / `appendMarkdown`. When the stored version differs from the current page version, `getOrBuild` rebuilds the map from the current storage before restoring (spec 6.7), so a fresh or stale store still restores tokens. `page_update_section` and `page_append` both add `formatDropped(dropped, unknown)` as a second line when it is not null (`page_append` has no dropped placeholders, only `unknown`). `page_get` header: `# <title>` (or `# <title> > <heading>`) then `Page <id> in <space key>, v<version>` then a blank line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/confluence`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/confluence test/confluence/tools/pages.test.ts
git commit -m "feat: add page_get, page_edit, page_update_section and page_append" -m "Layouts render transparently in the markdown view instead of as tokens, so layout-based pages stay readable; layout markup stays lossless because sections end at their cell."
```

---

### Task 12: Page create, search and comment tools

**Files:**
- Create: `src/confluence/tools/publish.ts`, `src/core/query.ts`
- Modify: `src/confluence/api.ts` (add `spaceIdForKey`, `createPage`, `searchPages`, `addFooterComment`), `src/confluence/module.ts`
- Test: `test/confluence/tools/publish.test.ts`, `test/core/query.test.ts`

**Interfaces:**
- Consumes: Task 10 and 11 interfaces, `markdownToStorage` (Task 7), `parsePageRef` (Task 2)
- Produces:
  - `splitOrderBy(query: string): { where: string; orderBy: string }` in `src/core/query.ts` (the one quote-aware helper: splits at the last `ORDER BY` outside double-quoted strings, honouring `\"` escapes; both parts trimmed, `orderBy` keeps the `ORDER BY ...` text and is `''` when absent; Task 14 reuses it for `buildJql`)
  - `spaceIdForKey(rt: SiteRuntime, key: string): Promise<string>` (cached `confluence:spaceId:<site>:<KEY>`, e.g. `confluence:spaceId:gumperr:SD`; unknown key -> `No Confluence space "XX" on site gumperr.`)
  - `createPage(rt: SiteRuntime, input: { spaceId: string; title: string; storage: string; parentId?: string }): Promise<{ id: string; version: number; url: string }>` (url = `site.baseUrl + '/wiki' + _links.webui`)
  - `searchPages(rt: SiteRuntime, cql: string, limit: number): Promise<{ id: string; title: string; space: string; modified: string }[]>`
  - `addFooterComment(rt: SiteRuntime, pageId: string, storage: string): Promise<string>`
  - `buildCql(query: string, space?: string): string` (in `src/confluence/tools/publish.ts`, built on `splitOrderBy`)
  - `publishTools: ToolDef[]` = `page_create`, `page_search`, `page_comment`

Schemas: `page_create` `Create a page from markdown.`; `space?` (`Space key; default from site`), `title`, `markdown`, `parent?` (`Parent page URL or id`), `site`. `page_search` `Search pages by CQL or plain text.`; `query`, `space?`, `limit?` (`Default 10`), `site`. `page_comment` `Add a footer comment to a page.`; `url`, `markdown`, `site`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/core/query.test.ts
it('splits ORDER BY outside double quotes only', () => {
  expect(splitOrderBy('title ~ "Costs" ORDER BY lastmodified DESC')).toEqual({ where: 'title ~ "Costs"', orderBy: 'ORDER BY lastmodified DESC' });
  expect(splitOrderBy('ORDER BY created DESC')).toEqual({ where: '', orderBy: 'ORDER BY created DESC' });
  expect(splitOrderBy('summary ~ "order by me"')).toEqual({ where: 'summary ~ "order by me"', orderBy: '' });
  expect(splitOrderBy('summary ~ "a \\" order by" order by key')).toEqual({ where: 'summary ~ "a \\" order by"', orderBy: 'order by key' });
});
```

```ts
// test/confluence/tools/publish.test.ts  (site gumperr, defaultConfluenceSpace SD; GET /wiki/api/v2/spaces?keys=SD -> id 100; GET page 7 -> title Costs, spaceId 100; POST /wiki/api/v2/pages -> id 900, version 1, _links.webui /spaces/SD/pages/900/Notes; runNoDefaultSpace = the same routes on a site without defaultConfluenceSpace)
it('buildCql turns plain text into a quoted text search and scopes CQL to a space', () => {
  expect(buildCql('budget "Q3" plan')).toBe('type = page AND text ~ "budget \\"Q3\\" plan"');
  expect(buildCql('budget', 'SD')).toBe('type = page AND space = "SD" AND text ~ "budget"');
  expect(buildCql('title ~ "Costs" ORDER BY lastmodified DESC', 'SD')).toBe('space = "SD" AND (title ~ "Costs") ORDER BY lastmodified DESC');
  expect(buildCql('space = SD AND title ~ x', 'QA')).toBe('space = SD AND title ~ x');
  expect(buildCql('title ~ "order by x"', 'SD')).toBe('space = "SD" AND (title ~ "order by x")');
  expect(buildCql('ORDER BY created DESC', 'SD')).toBe('space = "SD" ORDER BY created DESC');
});
it('page_search returns a compact table with default limit 10', async () => {
  const { text, calls } = await runWithCalls('page_search', { query: 'budget' });
  expect(new URL(calls[0]!.url).searchParams.get('limit')).toBe('10');
  expect(text).toBe('| id | title | space | modified |\n| --- | --- | --- | --- |\n| 7 | Costs | SD | 2026-11-01 |');
});
it('page_search says when nothing matched', async () => { expect((await run('page_search', { query: 'zzz' })).text).toBe('No pages found.'); });
it('page_create uses the site default space and returns url, id and version', async () => {
  const { text, calls } = await runWithCalls('page_create', { title: 'Notes', markdown: '# Hi' });
  expect(calls.find(c => c.method === 'POST')!.body).toEqual({ spaceId: '100', status: 'current', title: 'Notes', body: { representation: 'storage', value: '<h1>Hi</h1>' } });
  expect(text).toBe('Created "Notes" 900 v1 https://gumperr.atlassian.net/wiki/spaces/SD/pages/900/Notes');
});
it('page_create takes the space from the parent when space is omitted and no default exists', async () => {
  const { text, calls } = await runNoDefaultSpace('page_create', { title: 'Notes', markdown: '# Hi', parent: '7' });
  expect(calls.some(c => new URL(c.url).pathname === '/wiki/api/v2/pages/7')).toBe(true);
  expect(calls.find(c => c.method === 'POST')!.body).toEqual({ spaceId: '100', status: 'current', title: 'Notes', parentId: '7', body: { representation: 'storage', value: '<h1>Hi</h1>' } });
  expect(text).toBe('Created "Notes" 900 v1 https://gumperr.atlassian.net/wiki/spaces/SD/pages/900/Notes');
});
it('page_create requires site when several sites exist', async () => { expect((await runTwoSites('page_create', { title: 'x', markdown: 'y' })).text).toBe('Several sites are configured; pass site as one of: gumperr, qint.'); });
it('page_comment posts a footer comment', async () => {
  const { text, calls } = await runWithCalls('page_comment', { url: '7', markdown: 'Looks *good*' });
  expect(calls.at(-1)!.body).toEqual({ pageId: '7', body: { representation: 'storage', value: '<p>Looks <em>good</em></p>' } });
  expect(text).toBe('Comment 555 added to "Costs"');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/confluence/tools/publish.test.ts test/core/query.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`buildCql` first calls `splitOrderBy(query)`. CQL detection: `/[=~<>]|\b(?:not\s+)?in\s*\(/i` matches `where`, or `orderBy` is non-empty. Plain text becomes `type = page AND text ~ "<quoted>"` (plus the space clause when a space is known). Space scoping applies only when `where` has no `space` clause (`/\bspace\s*(?:=|!=|in\b|not\s+in\b)/i`) and is prepended to `where` only: `space = "SD" AND (<where>) <orderBy>`, or `space = "SD" <orderBy>` when `where` is empty (no trailing space when `orderBy` is empty). Escape `\` and `"` in quoted strings. `modified` is the date part of `version.when`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/confluence test/core`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/confluence src/core/query.ts test/confluence/tools/publish.test.ts test/core/query.test.ts
git commit -m "feat: add page_create, page_search and page_comment"
```

---

### Task 13: Table tools

**Files:**
- Create: `src/confluence/tools/tables.ts`
- Modify: `src/confluence/module.ts`
- Test: `test/confluence/tools/tables.test.ts`

**Interfaces:**
- Consumes: `selectTable`, `updateCell`, `addRow` (Task 9); `storageToMarkdown` (Task 5); `parseStorage` (Task 4); `writePage`, `getPage` (Task 10); `pageTarget` (Task 11)
- Produces: `tableTools: ToolDef[]` = `table_get`, `table_update`, `table_add_row`

Schemas: `table` is `z.union([z.number().int().positive(), z.string()]).optional().describe('Index or heading above')`. `table_get` `Read one page table as markdown.`; `url`, `table?`, `site`. `table_update` `Set one table cell, matched by row label and column header.`; `url`, `row`, `column`, `value`, `table?`, `site`. `table_add_row` `Add a table row; cells map column names to values.`; `url`, `cells` (`z.record(z.string(), z.string())`), `table?`, `position?` (`end or after:<row label>`), `site`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/confluence/tools/tables.test.ts  (page 7 = rich-page.xml, v13)
it('table_get returns a header and the markdown table with tokens', async () => {
  expect((await run('table_get', { url: '7' })).text).toBe(['Table 1 (4 rows x 3 cols)', '', '| **Item** | **Q1 2026** | **Q2** |', '| --- | --- | --- |', '| Hosting | 100 | 120 |', '| Licences | **40** | 40 |', '| Support | {{atlas:5}} [status: TBD] |  |'].join('\n'));
});
it('table_update reports old and new values and versions', async () => {
  expect((await run('table_update', { url: '7', row: 'Hosting', column: 'Q2', value: '125' })).text).toBe('Hosting / Q2: 120 -> 125, v13 -> v14');
});
it('table_update keeps every byte outside the cell (spec 6.11)', async () => {
  const { calls } = await runWithCalls('table_update', { url: '7', row: 'Hosting', column: 'Q2', value: '125' });
  expect(calls.at(-1)!.body.body.value).toBe(page.replace('<td><p>120</p></td>', '<td><p>125</p></td>'));
});
it('table_add_row returns versions', async () => { expect((await run('table_add_row', { url: '7', cells: { Item: 'CDN' } })).text).toBe('Row added to table 1, v13 -> v14'); });
it('passes matching errors through as isError', async () => { expect(await run('table_update', { url: '7', row: 'Nope', column: 'Q2', value: '1' })).toEqual({ text: 'No row "Nope" in table 1. Rows: Hosting, Licences, Support.', isError: true }); });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/confluence/tools/tables.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the three tools**

`table_get` renders the table element's outer range, `storage.slice(table.el.startIndex, table.el.endIndex + 1)`, passed as `storageToMarkdown(storage, { within: { start: table.el.startIndex, end: table.el.endIndex + 1 } })` so the whole `table` element is inside the range (a GFM table comes out) and tokens keep their page-wide numbers (`{{atlas:5}}` in the test). Writes go through `writePage(srt, id, '<tool>', page => ...)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/confluence`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/confluence test/confluence/tools/tables.test.ts
git commit -m "feat: add table_get, table_update and table_add_row"
```

---

### Task 14: Jira read, search, transition and comment tools

**Files:**
- Create: `src/jira/api.ts` (all Jira HTTP calls, `listFields` included), `src/jira/jql.ts`, `src/jira/tools/read.ts`, `src/jira/module.ts`
- Create: `src/jira/fields.ts` (pure logic only, no HTTP calls; only `displayValue` in this task)
- Test: `test/jira/jql.test.ts`, `test/jira/tools/read.test.ts`

**Interfaces:**
- Consumes: framework and `Runtime.placeholders` (Task 10), `parseIssueRef` (Task 2), `adfToMarkdown`, `markdownToAdf`, `AdfDoc`, `AdfPlaceholder` (Task 8), `formatDropped` (Task 5), `splitOrderBy` (Task 12)
- Produces:
  - `isJql(q: string): boolean`; `quote(s: string): string`; `buildJql(query: string, defaultProject?: string): string` (splits with `splitOrderBy` from `src/core/query.ts`, no second ORDER BY logic)
  - `interface JiraIssue { id: string; key: string; fields: Record<string, any> }`
  - `getIssue(rt: SiteRuntime, key: string, fields: string[]): Promise<JiraIssue>` (`notFound: 'issue ' + key`)
  - `searchIssues(rt: SiteRuntime, jql: string, limit: number): Promise<JiraIssue[]>`
  - `listFields(rt: SiteRuntime): Promise<{ id: string; name: string; schema?: { type: string; custom?: string } }[]>` in `src/jira/api.ts` (cached `jira:fields:<site>`)
  - `getTransitions(rt: SiteRuntime, key: string): Promise<{ id: string; name: string; to: { name: string } }[]>`, `doTransition(rt: SiteRuntime, key: string, id: string): Promise<void>`
  - `addComment(rt: SiteRuntime, key: string, body: AdfDoc): Promise<string>` (returns comment id)
  - `issuePlaceholders(rt: Runtime, srt: SiteRuntime, issue: JiraIssue): Map<number, AdfPlaceholder>` (description first, then comments in order; `rt.placeholders.get<AdfPlaceholder>('jira').getOrBuild('jira:issue:<site>:<KEY>', fields.updated, ...)`, so a changed `updated` rebuilds the map from the fetched issue)
  - `displayValue(v: unknown): string` (strings, numbers, `displayName`/`name`/`value`/`key` objects, arrays joined with `, `, ADF via `adfToMarkdown`, null -> `-`)
  - `readTools: ToolDef[]` = `issue_get`, `issue_search`, `issue_transition`, `issue_comment`; `jiraModule: ProductModule` (`name: 'jira'`)

Schemas: `issue_get` `Read a Jira issue: key fields and description as markdown.`; `key` (`Issue key or URL`), `fields?` (`Extra field names or ids`), `include_comments?`, `site`. `issue_search` `Search issues by JQL or plain text.`; `query`, `limit?` (`Default 20`), `site`. `issue_transition` `Move an issue to a status.`; `key`, `to` (`Status or transition name`), `site`. `issue_comment` `Comment on an issue in markdown.`; `key`, `markdown`, `site`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/jira/jql.test.ts
it('turns plain text into a text search ordered by updated', () => {
  expect(buildJql('login fails on "Safari"')).toBe('text ~ "login fails on \\"Safari\\"" ORDER BY updated DESC');
  expect(isJql('login is broken')).toBe(false);
  expect(isJql('status = Done')).toBe(true);
});
it('prefixes the default project and keeps ORDER BY outside the parentheses', () => {
  expect(buildJql('status = Done ORDER BY created DESC', 'GUM')).toBe('project = "GUM" AND (status = Done) ORDER BY created DESC');
  expect(buildJql('ORDER BY created DESC', 'GUM')).toBe('project = "GUM" ORDER BY created DESC');
  expect(buildJql('broken login', 'GUM')).toBe('project = "GUM" AND (text ~ "broken login") ORDER BY updated DESC');
  expect(buildJql('project = QA AND status = Done', 'GUM')).toBe('project = QA AND status = Done');
  expect(buildJql('summary ~ "order by me"', 'GUM')).toBe('project = "GUM" AND (summary ~ "order by me")');
});
```

```ts
// test/jira/tools/read.test.ts  (issue GUM-12 fields: summary, issuetype Bug, status In Progress, priority High, assignee Ana, reporter Marko, labels [web], parent GUM-1, created/updated, description = fixture description, comment.comments = fixture comments)
it('issue_get prints a compact header and the description with tokens', async () => {
  const r = await run('issue_get', { key: 'https://gumperr.atlassian.net/browse/GUM-12' });
  expect(r.text.split('\n').slice(0, 3)).toEqual([
    'GUM-12 [Bug] Login fails on Safari',
    'Status: In Progress | Priority: High | Assignee: Ana | Reporter: Marko',
    'Labels: web | Parent: GUM-1 | Created: 2026-11-01 | Updated: 2026-11-02',
  ]);
  expect(r.text).toContain('{{atlas:2}} [media: shot.png]');
  expect(r.text).not.toContain('Comments');
});
it('issue_get requests default fields plus extras resolved by display name', async () => {
  const { calls } = await runWithCalls('issue_get', { key: 'GUM-12', fields: ['Story Points'] });
  expect(new URL(calls.at(-1)!.url).searchParams.get('fields')).toBe('summary,issuetype,status,priority,assignee,reporter,labels,parent,created,updated,description,customfield_10042');
});
it('issue_get includes comments on request, numbering after the description', async () => {
  expect((await run('issue_get', { key: 'GUM-12', include_comments: true })).text).toContain('Comments (2):\n\n### Ana, 2026-11-02 (id 10001)\nLooks good {{atlas:4}} [card: x.y]');
});
it('issue_search posts to /rest/api/3/search/jql with fields and follows nextPageToken up to the limit', async () => {
  const { text, calls } = await runWithCalls('issue_search', { query: 'login', limit: 3 });
  expect(calls[0]).toMatchObject({ method: 'POST', body: { jql: 'project = "GUM" AND (text ~ "login") ORDER BY updated DESC', maxResults: 3, fields: ['summary', 'issuetype', 'status', 'assignee'] } });
  expect(calls[1]!.body.nextPageToken).toBe('tok2');
  expect(text.split('\n')[0]).toBe('| key | type | status | assignee | summary |');
  expect(text.split('\n')).toHaveLength(5);
});
it('issue_transition matches status or transition name case-insensitively', async () => {
  expect((await run('issue_transition', { key: 'GUM-12', to: 'done' })).text).toBe('GUM-12: In Progress -> Done');
});
it('issue_transition lists what is available on failure', async () => {
  expect(await run('issue_transition', { key: 'GUM-12', to: 'Shipped' })).toEqual({ text: 'No transition to "Shipped" from In Progress. Available: Done (Done), Stop progress (To Do).', isError: true });
});
it('issue_transition is a no-op when already there', async () => { expect((await run('issue_transition', { key: 'GUM-12', to: 'in progress' })).text).toBe('GUM-12 is already In Progress.'); });
it('issue_comment converts markdown to ADF and restores tokens in a fresh runtime', async () => {
  const { text, calls } = await runWithCalls('issue_comment', { key: 'GUM-12', markdown: 'See {{atlas:2}} [media: shot.png]' });
  expect(calls.at(-1)!.body.body.content.map((n: AdfNode) => n.type)).toEqual(['paragraph', 'mediaSingle']);
  expect(text).toBe('Comment 10050 added to GUM-12');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/jira`
Expected: FAIL

- [ ] **Step 3: Implement**

`buildJql` first calls `splitOrderBy(query)` (Task 12). `isJql(q)` is true when `/[=~<>]|\b(?:not\s+)?in\s*\(|\bis\s+(?:not\s+)?(?:empty|null)\b/i` matches `where`, or `splitOrderBy(q).orderBy` is non-empty. Plain text: `where` = `text ~ "<quoted>"`, `orderBy` = `ORDER BY updated DESC`. Project clause test on `where`: `/\bproject\s*(?:=|!=|\bin\b|\bnot\s+in\b)/i`; without one and with a default project the clause is prepended to `where` only: `project = "GUM" AND (<where>) <orderBy>`, or `project = "GUM" <orderBy>` when `where` is empty (no trailing space when `orderBy` is empty). `searchIssues` caps `maxResults` at `min(limit, 100)` and loops while `!isLast && nextPageToken && issues.length < limit`. `issue_get` extras: names resolved via `listFields` (by id, else display name case-insensitive; unknown -> `Unknown field "X".`), printed as one `Name: value` line each after the header. Comments block: `Comments (N):` then per comment `### <author>, <YYYY-MM-DD> (id <id>)` and its markdown. `issue_comment` fetches `description,comment,updated` to rebuild the token map before converting; unknown tokens add the `Dropped:` line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/jira`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jira test/jira
git commit -m "feat: add issue_get, issue_search, issue_transition and issue_comment"
```

---

### Task 15: Field resolution, issue_create and issue_update

**Files:**
- Create: `src/jira/users.ts`, `src/jira/tools/write.ts`
- Modify: `src/jira/fields.ts` (pure logic: `normalizeCreateMeta`, `normalizeEditMeta`, `resolveFields`, `missingRequired`, `formatMissing`), `src/jira/api.ts` (HTTP: `projectIssueTypes`, `createMeta`, `editMeta`, `createIssue`, `updateIssue`), `src/jira/module.ts`
- Test: `test/jira/fields.test.ts`, `test/jira/tools/write.test.ts`

**Interfaces:**
- Consumes: Task 14 interfaces, `markdownToAdf` (Task 8)
- Produces:
  - `interface FieldMeta { id: string; name: string; required: boolean; hasDefaultValue: boolean; schema: { type: string; items?: string; system?: string; custom?: string }; allowedValues?: { id: string; name?: string; value?: string }[] }`
  - `normalizeCreateMeta(json: unknown): FieldMeta[]` (reads `fields ?? results`, id from `fieldId ?? key`), `normalizeEditMeta(json: unknown): FieldMeta[]`
  - In `src/jira/api.ts`: `projectIssueTypes(rt: SiteRuntime, project: string): Promise<{ id: string; name: string }[]>` (cached `jira:issueTypes:<site>:<project>`), `createMeta(rt: SiteRuntime, project: string, issueTypeId: string): Promise<FieldMeta[]>` (cached `jira:createMeta:<site>:<project>:<issueTypeId>` for the process), `editMeta(rt: SiteRuntime, key: string): Promise<FieldMeta[]>`, `createIssue(rt: SiteRuntime, fields: Record<string, unknown>): Promise<{ key: string }>`, `updateIssue(rt: SiteRuntime, key: string, fields: Record<string, unknown>): Promise<void>`
  - `findUser(rt: SiteRuntime, query: string): Promise<{ accountId: string; displayName: string }>`
  - `resolveFields(rt: SiteRuntime, meta: FieldMeta[], input: Record<string, unknown>, label: string): Promise<{ fields: Record<string, unknown>; names: string[] }>` (in `fields.ts`; makes no HTTP call itself, user values go through `findUser`)
  - `missingRequired(meta: FieldMeta[], supplied: Set<string>): FieldMeta[]`, `formatMissing(label: string, missing: FieldMeta[]): string`
  - `writeTools: ToolDef[]` = `issue_create`, `issue_update`

Decision (challenges spec 6.5 with evidence, flag in the commit body): `issue_update` resolves `fields` against `GET /rest/api/3/issue/{key}/editmeta` rather than create metadata. Editmeta is the authoritative list of fields editable on that issue (fields such as resolution or fix versions may be on the edit screen only), and it costs one call instead of GET issue plus createmeta. The resolver and value rules are identical. `issue_update` with only `summary` and/or `description` skips editmeta.

Schemas: `issue_create` `Create an issue; fields map names or ids to plain values.`; `project?` (`Default from site`), `type` (`Issue type name`), `summary`, `description?` (`Markdown`), `fields?` (`z.record(z.string(), z.unknown())`), `labels?`, `assignee?` (`Name or email`), `site`. `issue_update` `Update issue fields, summary or description.`; `key`, `fields?`, `description?`, `summary?`, `site`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/jira/fields.test.ts  (meta: Priority (priority, allowed High/Medium/Low), Story Points (customfield_10042, number), Severity (customfield_10050, option, required, allowed S1..S12), Components (components, array/component), Due date (duedate, date), Watchers user field customfield_10060 (user), Labels (labels, array/string), Sprint (customfield_10020, custom gh-sprint))
it('matches keys by id or display name and values case-insensitively', async () => {
  const r = await resolveFields(srt, meta, { priority: 'high', 'story points': '5', Severity: 's2', Components: ['web'], duedate: '2026-12-01', Labels: ['a'] }, 'GUM Bug');
  expect(r.fields).toEqual({ priority: { id: '2' }, customfield_10042: 5, customfield_10050: { id: '1002' }, components: [{ id: '30' }], duedate: '2026-12-01', labels: ['a'] });
  expect(r.names).toEqual(['Priority', 'Story Points', 'Severity', 'Components', 'Due date', 'Labels']);
});
it('resolves user fields by display name or email', async () => { /* GET /rest/api/3/user/search?query=ana%40x.y -> [{ accountId: 'u1', displayName: 'Ana', emailAddress: 'ana@x.y', active: true }] */ expect((await resolveFields(srt, meta, { customfield_10060: 'ana@x.y' }, 'x')).fields).toEqual({ customfield_10060: { accountId: 'u1' } }); });
it('lists candidates for ambiguous users', async () => { await expect(findUser(srtTwoAnas, 'Ana')).rejects.toThrow('"Ana" matches 2 users: Ana Kovac (ana.k@x.y), Ana Petrovic (ana.p@x.y). Use an email.'); });
it('rejects unknown values with up to 10 allowed values', async () => {
  await expect(resolveFields(srt, meta, { Severity: 'S99' }, 'GUM Bug')).rejects.toThrow('Severity has no value "S99". Allowed: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10 (and 2 more).');
});
it('rejects unknown fields naming the screen', async () => { await expect(resolveFields(srt, meta, { Foo: 1 }, 'GUM Bug')).rejects.toThrow('Field "Foo" is not available for GUM Bug.'); });
it('requires a numeric sprint id', async () => { await expect(resolveFields(srt, meta, { Sprint: 'Sprint 4' }, 'GUM Bug')).rejects.toThrow('Sprint needs the numeric sprint id.'); });
it('formats missing required fields', () => {
  expect(formatMissing('GUM Bug', missingRequired(meta, new Set(['summary'])))).toBe('Not created: GUM Bug needs these fields:\n- Severity: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10 (and 2 more)');
});
it('normalizes createmeta pages that use either fields or results', () => {
  expect(normalizeCreateMeta({ results: [{ fieldId: 'priority', name: 'Priority', required: false, schema: { type: 'priority' } }] })[0]!.id).toBe('priority');
  expect(normalizeCreateMeta({ fields: [{ fieldId: 'x', name: 'X', required: true, schema: { type: 'string' } }] })[0]!.required).toBe(true);
});
```

```ts
// test/jira/tools/write.test.ts  (site default project GUM; issue types Bug(1), Task(2); createRoutes = the issuetypes and createmeta routes plus POST /rest/api/3/issue -> GUM-13; byName and testRuntime as in Task 11)
it('issue_create resolves type, converts description, resolves assignee and returns key and URL', async () => {
  const { text, calls } = await runWithCalls('issue_create', { type: 'bug', summary: 'Login fails', description: '**Steps**', labels: ['web'], assignee: 'Ana', fields: { Severity: 'S1' } });
  expect(calls.find(c => c.method === 'POST')!.body.fields).toEqual({ project: { key: 'GUM' }, issuetype: { id: '1' }, summary: 'Login fails', description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steps', marks: [{ type: 'strong' }] }] }] }, labels: ['web'], assignee: { accountId: 'u1' }, customfield_10050: { id: '1001' } });
  expect(text).toBe('Created GUM-13 https://gumperr.atlassian.net/browse/GUM-13');
});
it('issue_create returns missing required fields instead of creating', async () => {
  const { text, calls } = await runWithCalls('issue_create', { type: 'Bug', summary: 'x' });
  expect(text).toMatch(/^Not created: GUM Bug needs these fields:\n- Severity: /);
  expect(calls.some(c => c.method === 'POST')).toBe(false);
});
it('issue_create lists issue types when the type does not match', async () => { expect((await run('issue_create', { type: 'Epic', summary: 'x' })).text).toBe('No issue type "Epic" in GUM. Types: Bug, Task.'); });
it('issue_create needs a project when the site has no default', async () => { expect((await runNoDefault('issue_create', { type: 'Bug', summary: 'x' })).text).toBe('Pass project; site gumperr has no defaultJiraProject.'); });
it('issue_create reuses cached create metadata', async () => {
  const { rt, calls } = testRuntime(createRoutes);
  for (const summary of ['a', 'b']) await executeTool(byName('issue_create'), { type: 'Bug', summary, fields: { Severity: 'S1' } }, rt);
  const gets = (path: string) => calls.filter(c => c.method === 'GET' && new URL(c.url).pathname === path).length;
  expect(gets('/rest/api/3/issue/createmeta/GUM/issuetypes')).toBe(1);
  expect(gets('/rest/api/3/issue/createmeta/GUM/issuetypes/1')).toBe(1);
  expect(calls.filter(c => c.method === 'POST')).toHaveLength(2);
});
it('issue_update names changed fields and reports dropped description tokens', async () => {
  const r = await run('issue_update', { key: 'GUM-12', summary: 'New', description: 'Only text now' });
  expect(r.text).toBe('Updated GUM-12: summary, description\nDropped: 3 items: [mention: @Ana], [media: shot.png], [panel: info, Careful]');
});
it('issue_update resolves fields against editmeta', async () => {
  const { calls } = await runWithCalls('issue_update', { key: 'GUM-12', fields: { Priority: 'low' } });
  expect(calls.map(c => new URL(c.url).pathname)).toEqual(['/rest/api/3/issue/GUM-12/editmeta', '/rest/api/3/issue/GUM-12']);
  expect(calls[1]!.body).toEqual({ fields: { priority: { id: '3' } } });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/jira`
Expected: FAIL

- [ ] **Step 3: Implement**

Value rules by `schema`: `number` -> `Number(v)` (NaN -> `<Name> needs a number.`); `date`/`datetime` -> string as given; `user` -> `{ accountId }` via `findUser`; `array` of `string` -> string array; `array` of `user` -> `[{ accountId }]`; `array` with `allowedValues` -> `[{ id }]`; any field with `allowedValues` -> `{ id }` matched on `name ?? value`; custom `com.pyxis.greenhopper.jira:gh-sprint` -> integer; system `parent` -> `{ key }`; rich text (`system` `description`/`environment` or custom containing `textarea`) -> ADF via `markdownToAdf`; otherwise the value unchanged. `findUser`: `GET /rest/api/3/user/search?query=`, active users only, exact case-insensitive match on `displayName` or `emailAddress` first, then a single result, else the ambiguity error; none -> `No Jira user matches "X".` Required check ignores `project`, `issuetype`, `summary` and fields with `hasDefaultValue`. Description drops: description placeholders from `issuePlaceholders` (Task 14; the store rebuilds them from the freshly fetched issue when `fields.updated` changed) whose `n` was not used.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/jira`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jira test/jira
git commit -m "feat: add issue_create and issue_update with field resolution" -m "issue_update resolves fields against editmeta, the authoritative list of editable fields for an existing issue, saving a lookup call."
```

---

### Task 16: Server wiring, sites_list, entry point and the description budget

**Files:**
- Create: `src/core/sitesTool.ts`, `src/server.ts`, `src/index.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `registerModules`, `createRuntime` (Task 10), `confluenceModule`, `jiraModule`, `loadConfig`, `defaultConfigDeps` (Task 1)
- Produces:
  - `sitesTool: ToolDef` (`sites_list`, description `List configured Atlassian sites and what they can reach.`, no inputs)
  - `coreModule: ProductModule` in `src/core/sitesTool.ts` (`name: 'core'`, tools `[sitesTool]`)
  - `createServer(rt: Runtime): McpServer` (name `atlas-lite-mcp`, version from package.json)
  - `packageVersion(): string` (reads `../package.json` relative to `import.meta.url`)
  - `main(argv: string[]): Promise<void>` in `src/index.ts` (first line `#!/usr/bin/env node`): `init` -> Task 17 (stub prints `init is not available yet` until then); `--version`/`-v` -> prints version; `--help`/`-h` -> usage lines; otherwise load config (errors become `configError`, never a crash), connect `StdioServerTransport`, exit 0 when stdin closes

- [ ] **Step 1: Write the failing tests**

```ts
// test/server.test.ts  (client connected through InMemoryTransport.createLinkedPair)
const NAMES = ['issue_comment', 'issue_create', 'issue_get', 'issue_search', 'issue_transition', 'issue_update', 'page_append', 'page_comment', 'page_create', 'page_edit', 'page_get', 'page_search', 'page_update_section', 'sites_list', 'table_add_row', 'table_get', 'table_update'];
it('exposes exactly the catalogue and no delete tools', async () => {
  const { tools } = await client.listTools();
  expect(tools.map(t => t.name).sort()).toEqual(NAMES);
  expect(tools.some(t => /delete|remove/i.test(t.name))).toBe(false);
});
it('keeps the tools/list payload under 3,000 tokens (chars / 4 < 12,000 chars)', async () => {
  const { tools } = await client.listTools();
  const chars = JSON.stringify(tools).length;
  expect(chars, `payload ${chars} chars ~ ${Math.round(chars / 4)} tokens`).toBeLessThan(12000);
});
it('keeps every description short and dash-free', async () => {
  for (const t of (await client.listTools()).tools) { expect(t.description!.length, t.name).toBeLessThanOrEqual(120); expect(JSON.stringify(t)).not.toMatch(/[\u2013\u2014]/); }
});
it('answers with the setup sentence when nothing is configured', async () => {
  const c = await connect(createRuntime({ sites: [], source: 'none', path: '/h/sites.json' }));
  const r = await c.callTool({ name: 'page_get', arguments: { id: '1' } });
  expect(r).toMatchObject({ isError: true, content: [{ type: 'text', text: 'No Atlassian sites are configured. Run "npx atlas-lite-mcp init" or set ATLASSIAN_URL, ATLASSIAN_EMAIL and ATLASSIAN_TOKEN.' }] });
  expect((await c.callTool({ name: 'sites_list', arguments: {} })).content).toEqual([{ type: 'text', text: 'No Atlassian sites are configured. Run "npx atlas-lite-mcp init" or set ATLASSIAN_URL, ATLASSIAN_EMAIL and ATLASSIAN_TOKEN.' }]);
});
it('sites_list probes each site and shows defaults', async () => {
  // gumperr: myself 200, spaces 200; qint: unavailable (env QINT_TOKEN is not set)
  expect((await c.callTool({ name: 'sites_list', arguments: {} })).content).toEqual([{ type: 'text', text: [
    '| site | host | reachable | project | space |', '| --- | --- | --- | --- | --- |',
    '| gumperr | gumperr.atlassian.net | jira, confluence | GUM | SD |',
    '| qint | qint.atlassian.net | unavailable: env QINT_TOKEN is not set | - | - |',
  ].join('\n') }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/server.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `sitesTool.ts`, `server.ts`, `index.ts`**

`sites_list` probes `GET /rest/api/3/myself` and `GET /wiki/api/v2/spaces?limit=1` in parallel per available site; a failed probe shows as `jira (confluence: 401)` style. If the budget test fails, shorten descriptions; never raise the limit.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Verify the stdio handshake from a build**

Run: `pnpm build && printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' | env -u ATLASSIAN_URL ATLAS_MCP_CONFIG=/nonexistent node dist/index.js`
Expected: one JSON line containing `"serverInfo":{"name":"atlas-lite-mcp","version":"0.1.0"}`, then the process exits on its own when stdin closes. Stop it only by closing stdin or Ctrl+C on that process, never with `pkill -f`.

- [ ] **Step 6: Commit**

```bash
git add src/core/sitesTool.ts src/server.ts src/index.ts test/server.test.ts
git commit -m "feat: wire the stdio server, sites_list and the description budget test"
```

---

### Task 17: `atlas-lite-mcp init`

**Files:**
- Create: `src/cli/init.ts`
- Modify: `src/index.ts` (route `init`)
- Test: `test/cli/init.test.ts`

**Interfaces:**
- Consumes: `createHttpClient` (Task 3), `Site`, `configPath` (Task 1)
- Produces:
  - `interface Prompter { ask(question: string, opts?: { default?: string; secret?: boolean }): Promise<string>; close(): void }`
  - `createPrompter(): Prompter` (readline/promises on stdin/stderr; `secret` answers are not echoed)
  - `interface InitDeps { prompter: Prompter; out(line: string): void; configPath: string; env: Record<string, string | undefined>; fetch?: typeof fetch; readFile(path: string): string | undefined; writeFile(path: string, data: string): void }` (`writeFile` creates the parent with mode 700 and writes with mode 600, then chmods 600; `index.ts` sets `configPath` to `configPath(process.env, os.homedir())` from Task 1, never a second path rule)
  - `runInit(deps: InitDeps): Promise<number>` (exit code)

- [ ] **Step 1: Write the failing tests**

```ts
// test/cli/init.test.ts  (scripted prompter answers in order, default = the answers listed in the first test; `files` seeds existing files for readFile; fetch mocked)
it('writes sites.json with an env reference, mode handled by writeFile, and verifies products', async () => {
  // answers: name gumperr, url gumperr.atlassian.net, email a@b.c, token GUMPERR_ATLASSIAN_TOKEN, token type '', project GUM, space SD, another 'n'
  const d = deps({ env: { GUMPERR_ATLASSIAN_TOKEN: 'tok-SECRET-123' }, routes: [myselfOk('Andrija Peric'), spacesOk] });
  expect(await runInit(d)).toBe(0);
  expect(JSON.parse(d.written['/h/.config/atlas-lite-mcp/sites.json']!)).toEqual({ sites: [{ name: 'gumperr', baseUrl: 'https://gumperr.atlassian.net', email: 'a@b.c', apiToken: '${GUMPERR_ATLASSIAN_TOKEN}', tokenType: 'classic', defaultJiraProject: 'GUM', defaultConfluenceSpace: 'SD' }] });
  expect(d.lines).toContain('gumperr: Jira ok (Andrija Peric), Confluence ok');
  expect(d.lines.join('\n')).toContain('claude mcp add atlas -- npx -y atlas-lite-mcp');
});
it('asks for the token as a secret and never prints it', async () => {
  const d = deps({ answers: literalTokenAnswers('tok-SECRET-123') });
  await runInit(d);
  expect(d.prompter.ask).toHaveBeenCalledWith(expect.stringMatching(/token/i), expect.objectContaining({ secret: true }));
  expect(d.lines.join('\n')).not.toContain('tok-SECRET-123');
});
it('replaces a site with the same name and keeps others', async () => {
  const qint = { name: 'qint', baseUrl: 'https://qint.atlassian.net', email: 'q@b.c', apiToken: '${QINT_TOKEN}' };
  const existing = { sites: [{ name: 'gumperr', baseUrl: 'https://old.atlassian.net', email: 'old@b.c', apiToken: '${OLD_TOKEN}' }, qint] };
  const d = deps({ env: { GUMPERR_ATLASSIAN_TOKEN: 'tok-SECRET-123' }, routes: [myselfOk('Andrija Peric'), spacesOk], files: { '/h/.config/atlas-lite-mcp/sites.json': JSON.stringify(existing) } });
  expect(await runInit(d)).toBe(0);
  const { sites } = JSON.parse(d.written['/h/.config/atlas-lite-mcp/sites.json']!);
  expect(sites.map((x: { name: string }) => x.name)).toEqual(['gumperr', 'qint']);
  expect(sites[0]).toMatchObject({ baseUrl: 'https://gumperr.atlassian.net', email: 'a@b.c', apiToken: '${GUMPERR_ATLASSIAN_TOKEN}' });
  expect(sites[1]).toEqual(qint);
});
it('reports unreachable products without failing the write', async () => {
  const d = deps({ routes: [myself401, spaces404] });
  expect(await runInit(d)).toBe(0);
  const line = d.lines.find(l => l.startsWith('gumperr: Jira failed (Token for site gumperr rejected (401).'));
  expect(line).toBeDefined();
  expect(line).toContain('Confluence failed (Not found on site gumperr');
  expect(Object.keys(d.written)).toEqual(['/h/.config/atlas-lite-mcp/sites.json']);
});
it('warns when the env variable named for the token is not set', async () => { expect((await runInitWith({ env: {} })).lines).toContain('GUMPERR_ATLASSIAN_TOKEN is not set in this shell; set it before starting the server. Skipping verification.'); });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/cli/init.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `runInit` and `createPrompter`, route `init` in `index.ts`**

Prompts in order: `Site name`, `Site URL (e.g. https://acme.atlassian.net)`, `Atlassian account email`, `API token, or the name of an env variable that holds it` (secret), `Token type, classic or scoped` (default `classic`), `Default Jira project key (optional)`, `Default Confluence space key (optional)`, `Add another site? (y/N)`. URL normalised to `https://<host>`. An answer matching `^[A-Z][A-Z0-9_]*$` is an env variable name stored as `${NAME}`. An existing site with the same name (case-insensitive) is replaced in place; other sites keep their order. Verification: `GET /rest/api/3/myself` (shows `displayName`) and `GET /wiki/api/v2/spaces?limit=1`. Final lines: `Wrote /h/.config/atlas-lite-mcp/sites.json (mode 600).` and `Add to Claude Code: claude mcp add atlas -- npx -y atlas-lite-mcp`. Secret echo: a muted output stream that drops writes while the secret question is pending.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli src/index.ts test/cli
git commit -m "feat: add interactive init that writes and verifies sites.json"
```

---

### Task 18: Live smoke test

**Files:**
- Create: `vitest.smoke.config.ts`, `test/smoke/live.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `defaultConfigDeps` (Task 1), `createRuntime` (Task 10), `createServer` (Task 16), MCP `Client` over `InMemoryTransport`; `test/setup/no-network.ts` and the `"test:smoke": "vitest run --config vitest.smoke.config.ts"` script (Task 1)

- [ ] **Step 1: Write the smoke config and the smoke test**

`vitest.smoke.config.ts`: `include: ['test/smoke/**']`, `setupFiles: ['test/setup/no-network.ts']`, `environment: 'node'`, `testTimeout: 120000` (live calls may wait on 429s). `pnpm test` excludes `test/smoke/**` (Task 1), so this file runs only through `pnpm test:smoke`.

Enabled only when `ATLAS_SMOKE_PAGE`, `ATLAS_SMOKE_ISSUE` and `ATLAS_ALLOW_NETWORK=1` are all set; otherwise `describe.skipIf(!enabled)` skips with that reason. When enabled, sites come from `loadConfig(defaultConfigDeps())` (a config file at the default or `ATLAS_MCP_CONFIG` path, or all three `ATLASSIAN_*` variables). Optional `ATLAS_SMOKE_SITE` names the site (default: the only one). Helpers in the file: `call(name, args)` (`client.callTool`), `text(r)` (the first text content), `cells(line)` (split a markdown table row on unescaped `|`, trim, strip `**`), `labelsOf(issueText)` (the `Labels:` value of the `issue_get` header as an array, `[]` for `-`). It touches only those two objects, never creates pages or issues, and never deletes:

```ts
it('page_append then page_edit removes what it appended', async () => {
  const marker = `atlas-smoke-${Date.now()}`;
  expect(text(await call('page_append', { url: PAGE, markdown: marker }))).toMatch(/^Appended to ".+" v\d+ -> v\d+$/);
  expect(text(await call('page_edit', { url: PAGE, find: marker, replace: marker + '-edited' }))).toMatch(/\(1 replacement\)$/);
  expect(text(await call('page_edit', { url: PAGE, find: `<p>${marker}-edited</p>`, replace: '' }))).toMatch(/\(1 replacement\)$/);
});
it('table_update writes a cell and puts the old value back', async (ctx) => {
  const t = await call('table_get', { url: PAGE });
  const lines = text(t).split('\n'); // 'Table 1 (R rows x C cols)', '', header row, separator, first body row
  if (t.isError || lines.length < 5) { console.warn(`smoke: table_update skipped, no usable table: ${lines[0]}`); return ctx.skip(); }
  const head = cells(lines[2]!), row = cells(lines[4]!);
  const [label, column, old] = [row[0]!, head[1]!, row[1]!];
  expect(text(await call('table_update', { url: PAGE, row: label, column, value: `${old} (smoke)` }))).toMatch(/ \(smoke\), v\d+ -> v\d+$/);
  expect(text(await call('table_update', { url: PAGE, row: label, column, value: old }))).toContain(`(smoke) -> ${old}, v`);
});
it('page_get outline and section read without errors', async () => {
  const o = await call('page_get', { url: PAGE, format: 'outline' });
  expect(o.isError).toBeFalsy();
  const first = text(o).split('\n').find(l => /^\s*h[1-6] /.test(l));
  if (!first) return; // page without headings: nothing to read by section
  const s = await call('page_get', { url: PAGE, section: first.trim().slice(3) });
  expect(s.isError).toBeFalsy();
  expect(text(s).split('\n')[0]).toMatch(/^# .+ > .+$/);
});
it('issue_comment adds a comment', async () => { expect(text(await call('issue_comment', { key: ISSUE, markdown: `atlas-lite-mcp smoke ${new Date().toISOString()}` }))).toMatch(/^Comment \d+ added to /); });
it('issue_update changes labels and restores them', async () => {
  const before = labelsOf(text(await call('issue_get', { key: ISSUE })));
  expect(text(await call('issue_update', { key: ISSUE, fields: { labels: [...before, 'atlas-smoke'] } }))).toMatch(/^Updated .+: Labels$/);
  expect(labelsOf(text(await call('issue_get', { key: ISSUE })))).toContain('atlas-smoke');
  expect(text(await call('issue_update', { key: ISSUE, fields: { labels: before } }))).toMatch(/^Updated .+: Labels$/);
  expect(labelsOf(text(await call('issue_get', { key: ISSUE }))).sort()).toEqual([...before].sort());
});
it('issue_transition goes forward and back when allowed', async () => {
  const status = /Status: (.+?) \|/.exec(text(await call('issue_get', { key: ISSUE })))![1]!;
  const probe = await call('issue_transition', { key: ISSUE, to: 'atlas-smoke-no-such-status' });
  expect(probe.isError).toBe(true); // 'No transition to "..." from <status>. Available: <name> (<to>), ...'
  const targets = [...(text(probe).split('Available: ')[1] ?? '').matchAll(/\(([^)]+)\)/g)].map(m => m[1]!);
  const target = targets.find(to => to.toLowerCase() !== status.toLowerCase());
  if (!target) { console.warn(`smoke: no transition away from ${status}`); return; }
  expect(text(await call('issue_transition', { key: ISSUE, to: target }))).toContain(`: ${status} -> ${target}`);
  const back = await call('issue_transition', { key: ISSUE, to: status });
  if (back.isError) console.warn(`smoke: could not return ${ISSUE} to ${status}: ${text(back)}`);
  else expect(text(back)).toContain(`: ${target} -> ${status}`);
});
```

- [ ] **Step 2: Verify it skips when not switched on and stays out of `pnpm test`**

Run: `env -u ATLAS_SMOKE_PAGE -u ATLAS_SMOKE_ISSUE -u ATLAS_ALLOW_NETWORK pnpm test:smoke`
Expected: all tests skipped, exit 0.

Run: `ATLAS_SMOKE_PAGE=1 ATLAS_SMOKE_ISSUE=GUM-1 pnpm test`
Expected: PASS, and the output lists no `test/smoke` file.

- [ ] **Step 3: Run it live if the owner has supplied the scratch ids**

Run: `ATLAS_ALLOW_NETWORK=1 ATLAS_SMOKE_PAGE=<id> ATLAS_SMOKE_ISSUE=<KEY> pnpm test:smoke`
Expected: PASS. If the ids are not available, record "smoke not run, ids pending" in the task report and continue. Scoped-token check: if a scoped site is configured, this is where the `/wiki` prefix and `tenant_info` decisions from the endpoint notes get verified; fix `baseUrlFor` if Confluence calls 404.

- [ ] **Step 4: Commit**

```bash
git add vitest.smoke.config.ts test/smoke/live.test.ts
git commit -m "test: add opt-in live smoke test for scratch page and issue"
```

---

### Task 19: README, LICENSE and packaging

**Files:**
- Create: `README.md`, `LICENSE`
- Modify: `package.json` (`bin`, `files`, `prepublishOnly`)

**Interfaces:**
- Consumes: everything above

- [ ] **Step 1: Packaging fields**

`package.json`: `"bin": { "atlas-lite-mcp": "dist/index.js" }`, `"files": ["dist", "README.md", "LICENSE"]`, script `"prepublishOnly": "pnpm run typecheck && pnpm test && pnpm run build"` (`pnpm test` is unit only; the smoke test never runs during publish).

- [ ] **Step 2: LICENSE**

Standard MIT text, first line after the title `Copyright (c) 2026 Andrija Peric`.

- [ ] **Step 3: README**

Sections, in order: one-paragraph intro (why: fast, local, surgical edits, no Rovo credits); Requirements (Node 20.19 or newer, an Atlassian API token from id.atlassian.com/manage-profile/security/api-tokens); Install (`claude mcp add atlas -- npx -y atlas-lite-mcp`, `npm i -g atlas-lite-mcp`); Quick setup with env only (`ATLASSIAN_URL`, `ATLASSIAN_EMAIL`, `ATLASSIAN_TOKEN`, `ATLASSIAN_TOKEN_TYPE`); `atlas-lite-mcp init`; Multiple sites with the `sites.json` example from spec 6.2 (path `~/.config/atlas-lite-mcp/sites.json`, `ATLAS_MCP_CONFIG`, `${ENV_VAR}` references, `chmod 600`, file wins over env); Scoped tokens (`tokenType: "scoped"`, optional `cloudId`); Claude Desktop and Cursor snippets:

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

(Claude Desktop: `claude_desktop_config.json`; Cursor: `~/.cursor/mcp.json` or `.cursor/mcp.json`.) Then: Tools table (17 tools, one line each); Placeholder tokens (`{{atlas:N}} [hint]`, keep them to keep macros, removed ones are reported as `Dropped:`); Safety (no delete tools, every edit is a page version named after the tool, tokens never logged); Troubleshooting (401 expiry, 404 may mean permission, rate limits); Development (`pnpm install`, `pnpm test`, `pnpm build`, and the live smoke test `ATLAS_ALLOW_NETWORK=1 ATLAS_SMOKE_PAGE=<id> ATLAS_SMOKE_ISSUE=<KEY> pnpm test:smoke`); License MIT. No dashes other than plain hyphens.

- [ ] **Step 4: Verify build, tests and package contents**

Run: `pnpm typecheck && pnpm test && pnpm build && npm pack --dry-run`
Expected: tests pass (`pnpm test` does not collect the smoke test); the pack listing shows only `package.json`, `README.md`, `LICENSE` and `dist/**` files, `dist/index.js` first line `#!/usr/bin/env node`; no `test/`, `src/`, `docs/`, `.env` or fixtures.

Run: `node dist/index.js --version`
Expected: `0.1.0`

- [ ] **Step 5: Commit**

```bash
git add README.md LICENSE package.json
git commit -m "docs: add README and MIT license; configure package bin and files"
```

---

### Task 20: Release v0.1.0 (GitHub, npm, tag)

Controller merges `v0.1` into `main` (fast-forward) and the task runs on `main`.

**Files:** none changed (unless a check fails).

- [ ] **Step 1: Final gate**

Run: `git branch --show-current && git status --short && pnpm typecheck && pnpm test && pnpm build && npm pack --dry-run`
Expected: `main`, clean tree, all PASS.

- [ ] **Step 2: Create the public GitHub repo and push**

Run: `gh auth status` (must show an account with access to `pandalabs-dev`), then
`gh repo create pandalabs-dev/atlas-lite-mcp --public --source . --push --description "Fast local MCP server for Jira Cloud and Confluence Cloud with surgical, lossless page edits"`
Expected: repo URL printed, `main` pushed. If the repo already exists, stop and report instead of forcing.

Run: `gh repo view pandalabs-dev/atlas-lite-mcp --json visibility,url,defaultBranchRef`
Expected: `"visibility":"PUBLIC"`, default branch `main`.

- [ ] **Step 3: OWNER STEP, interactive npm login**

The executing agent stops here and asks the owner to run, in their own terminal: `npm login`. Do not attempt to log in, create tokens, or work around this. Continue only after the owner confirms.

Run: `npm whoami`
Expected: the owner's npm username.

- [ ] **Step 4: Publish**

Run: `npm view atlas-lite-mcp version`
Expected: E404 (name still unclaimed). If it exists, stop and report.

Run: `npm publish --access public` (runs `prepublishOnly`; if npm asks for a one-time password, the owner supplies it with `--otp <code>`)
Expected: `+ atlas-lite-mcp@0.1.0`.

- [ ] **Step 5: Verify the published package**

Run: `npm view atlas-lite-mcp version && npx -y atlas-lite-mcp@0.1.0 --version`
Expected: `0.1.0` twice.

Run: `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' | ATLAS_MCP_CONFIG=/nonexistent npx -y atlas-lite-mcp@0.1.0`
Expected: an initialize result with `"name":"atlas-lite-mcp"`; the process exits when stdin closes.

- [ ] **Step 6: Tag and push the release**

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

Run: `git ls-remote --tags origin v0.1.0`
Expected: one line ending `refs/tags/v0.1.0`.
