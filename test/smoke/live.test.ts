import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { defaultConfigDeps, loadConfig } from '../../src/core/config.js';
import { createRuntime, type Runtime } from '../../src/core/runtime.js';
import { parseIssueRef } from '../../src/core/url.js';
import { getTransitions } from '../../src/jira/api.js';
import { coreModule } from '../../src/core/sitesTool.js';
import { confluenceModule } from '../../src/confluence/module.js';
import { jiraModule } from '../../src/jira/module.js';
import { createSmokeSession } from './settlement.js';
import { ensureAuthorization, runCommentSmoke, runLabelSmoke, runOutlineSmoke, runPageSmoke, runTableSmoke, runTransitionSmoke } from './scenarios.js';

const PAGE = process.env.ATLAS_SMOKE_PAGE ?? '';
const ISSUE = process.env.ATLAS_SMOKE_ISSUE ?? '';
const enabled = Boolean(PAGE && ISSUE && process.env.ATLAS_ALLOW_NETWORK === '1');
const site = process.env.ATLAS_SMOKE_SITE;
let session: ReturnType<typeof createSmokeSession>;
let runtime: Runtime;

async function call(name: string, args: Record<string, unknown>): Promise<{ content?: unknown; isError?: unknown; [key: string]: unknown }> {
  if (name === 'smoke_list_transitions') {
    const ref = parseIssueRef(ISSUE);
    const srt = runtime.resolve({ ...(site !== undefined && { site }), ...(ref.host !== undefined && { host: ref.host }) });
    return { content: [{ type: 'text', text: JSON.stringify(await getTransitions(srt, ref.key)) }] };
  }
  return session.call(name, { ...args, ...(site ? { site } : {}) });
}
function marker(): string {
  return `atlas-smoke-${randomUUID()}`;
}

describe.skipIf(!enabled)('live smoke (requires ATLAS_ALLOW_NETWORK=1 and scratch page and issue)', () => {
  beforeAll(async () => {
    ensureAuthorization(process.env);
    const cfg = loadConfig(defaultConfigDeps());
    if (!site && cfg.sites.length !== 1) throw new Error('Set ATLAS_SMOKE_SITE when there is not exactly one site');
    runtime = createRuntime(cfg);
    session = createSmokeSession(runtime, [coreModule, confluenceModule, jiraModule]);
    await session.connect();
  });
  afterAll(async () => { await session?.close(); });

  it('page_append then page_edit removes what it appended', async (ctx) => {
    await session.run(() => runPageSmoke(call, PAGE, marker()), ctx.signal);
  });
  it('table_update writes a cell and restores the exact original markup', async (ctx) => {
    await session.run(() => runTableSmoke(call, PAGE, marker()), ctx.signal);
  });
  it('page_get outline and section read without errors', async (ctx) => {
    await session.run(() => runOutlineSmoke(call, PAGE), ctx.signal);
  });
  it('issue_comment adds a permanent comment', async (ctx) => {
    await session.run(() => runCommentSmoke(call, ISSUE, marker()), ctx.signal);
  });
  it('issue_update adds and removes a unique label', async (ctx) => {
    await session.run(() => runLabelSmoke(call, ISSUE, marker()), ctx.signal);
  });
  it('issue_transition goes forward and back when allowed', async (ctx) => {
    await session.run(async () => {
      const status = await runTransitionSmoke(call, ISSUE);
      console.error(`Smoke transition final issue status: ${status}`);
    }, ctx.signal);
  });
});
