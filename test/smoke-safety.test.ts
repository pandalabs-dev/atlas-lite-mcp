import { describe, expect, it } from 'vitest';
import {
  ensureAuthorization,
  runCommentSmoke,
  runLabelSmoke,
  runOutlineSmoke,
  runPageSmoke,
  runTableSmoke,
  runTransitionSmoke,
  type Call,
} from './smoke/scenarios.js';

const original = '<h2>Scratch</h2><table><tr><th>Item</th><th>Value</th></tr><tr><td>Row</td><td><p><strong>before</strong></p></td></tr></table>';
const changed = '<td><p><strong>atlas-smoke-cell-test</strong></p></td>';
const answer = (text: string, isError = false) => ({ content: [{ type: 'text' as const, text }], isError });

function fixture() {
  const state = { page: original, labels: ['keep'], status: 'Open', comments: 0, calls: [] as string[] };
  const faults = new Map<string, (args: Record<string, unknown>) => void>();
  const call: Call = async (name, args) => {
    state.calls.push(name);
    if (name === 'page_get') {
      faults.get('page_get')?.(args);
      if (args.format === 'storage') return answer(`# Scratch\nPage 1 in SD, v1\n\n${state.page}`);
      if (args.format === 'outline') return answer('# Scratch\nPage 1 in SD, v1\n\nh2 Scratch');
      return answer('# Scratch > Scratch\nPage 1 in SD, v1');
    }
    if (name === 'page_append') {
      state.page += `<p>${String(args.markdown)}</p>`;
      faults.get('page_append')?.(args);
      return answer('Appended to "Scratch" v1 -> v2');
    }
    if (name === 'page_edit') {
      const find = String(args.find);
      const matches = state.page.split(find).length - 1;
      if (matches !== 1) return answer('Missing or ambiguous match', true);
      state.page = state.page.replace(find, String(args.replace));
      faults.get('page_edit')?.(args);
      return answer('Updated "Scratch" v2 -> v3 (1 replacement)');
    }
    if (name === 'table_get') return answer('Table 1 (2 rows x 2 cols)\n\n| Item | Value |\n| --- | --- |\n| Row | before |');
    if (name === 'table_update') {
      state.page = state.page.replace('<td><p><strong>before</strong></p></td>', changed);
      faults.get('table_update')?.(args);
      return answer('Row / Value: before -> atlas-smoke-cell-test, v1 -> v2');
    }
    if (name === 'issue_get') {
      faults.get('issue_get')?.(args);
      return answer(`TST-1 [Task] Scratch\nStatus: ${state.status} | Priority: -\nLabels: ${state.labels.length ? state.labels.join(', ') : '-'} | Parent: -`);
    }
    if (name === 'issue_update') {
      state.labels = [...((args.fields as { labels: string[] }).labels)];
      faults.get('issue_update')?.(args);
      return answer('Updated TST-1: Labels');
    }
    if (name === 'smoke_list_transitions') {
      faults.get('smoke_list_transitions')?.(args);
      return answer(JSON.stringify(state.status === 'Open'
        ? [{ id: '1', name: 'Start', to: { name: 'Doing' } }]
        : [{ id: '2', name: 'Reopen', to: { name: 'Open' } }]));
    }
    if (name === 'issue_transition') {
      if (args.to === 'atlas-smoke-no-such-status') {
        state.status = 'Trap';
        return answer('TST-1: Open -> Trap');
      }
      const old = state.status;
      state.status = args.to === 'Start' ? 'Doing' : args.to === 'Reopen' ? 'Open' : String(args.to);
      faults.get('issue_transition')?.(args);
      return answer(`TST-1: ${old} -> ${state.status}`);
    }
    if (name === 'issue_comment') {
      state.comments++;
      faults.get('issue_comment')?.(args);
      return answer('Comment 42 added to TST-1');
    }
    throw new Error(`Unexpected tool ${name}`);
  };
  return { state, faults, call };
}

const page = '1';
const issue = 'TST-1';
const marker = 'atlas-smoke-test';
const cellMarker = 'atlas-smoke-cell-test';
const failOnce = (f: () => void) => { let first = true; return () => { if (first) { first = false; f(); } }; };

describe('smoke safety with an offline stateful fake', () => {
  it('restores an appended marker when the append response is lost', async () => {
    const f = fixture();
    f.faults.set('page_append', failOnce(() => { throw new Error('ambiguous append'); }));
    await expect(runPageSmoke(f.call, page, marker)).rejects.toThrow('ambiguous append');
    expect(f.state.page).toBe(original);
  });

  it('restores the edited marker after an ambiguous edit response', async () => {
    const f = fixture();
    f.faults.set('page_edit', failOnce(() => { throw new Error('ambiguous edit'); }));
    await expect(runPageSmoke(f.call, page, marker)).rejects.toThrow('ambiguous edit');
    expect(f.state.page).toBe(original);
  });

  it('preserves unrelated page changes during marker cleanup', async () => {
    const f = fixture();
    f.faults.set('page_append', failOnce(() => { f.state.page = '<p>concurrent</p>' + f.state.page; throw new Error('response lost'); }));
    await expect(runPageSmoke(f.call, page, marker)).rejects.toThrow('response lost');
    expect(f.state.page).toBe('<p>concurrent</p>' + original);
  });

  it('reports cleanup errors and the original failure together', async () => {
    const f = fixture();
    f.faults.set('page_append', () => { throw new Error('append failure'); });
    f.faults.set('page_edit', () => { throw new Error('cleanup failure'); });
    await expect(runPageSmoke(f.call, page, marker)).rejects.toThrow(/append failure[\s\S]*cleanup failure/);
  });

  it('restores exact cell markup after an ambiguous table update', async () => {
    const f = fixture();
    f.faults.set('table_update', () => { throw new Error('table response lost'); });
    await expect(runTableSmoke(f.call, page, cellMarker)).rejects.toThrow('table response lost');
    expect(f.state.page).toBe(original);
  });

  it('does not overwrite a concurrently edited cell in cleanup', async () => {
    const f = fixture();
    f.faults.set('table_update', () => { f.state.page = f.state.page.replace(changed, '<td>someone else</td>'); throw new Error('response lost'); });
    await expect(runTableSmoke(f.call, page, cellMarker)).rejects.toThrow(/response lost[\s\S]*(changed|manual|restore)/i);
    expect(f.state.page).toContain('<td>someone else</td>');
  });

  it('removes only its unique label when other labels changed', async () => {
    const f = fixture();
    f.faults.set('issue_update', failOnce(() => { f.state.labels.push('concurrent'); throw new Error('labels response lost'); }));
    await expect(runLabelSmoke(f.call, issue, marker)).rejects.toThrow('labels response lost');
    expect(f.state.labels).toEqual(['keep', 'concurrent']);
  });

  it('fails if an original label disappears while the test runs', async () => {
    const f = fixture();
    f.faults.set('issue_update', failOnce(() => { f.state.labels = [marker]; }));
    await expect(runLabelSmoke(f.call, issue, marker)).rejects.toThrow(/original|label/i);
    expect(f.state.labels).toEqual([]);
  });

  it('restores status after a transition response is lost', async () => {
    const f = fixture();
    f.faults.set('issue_transition', failOnce(() => { throw new Error('transition response lost'); }));
    await expect(runTransitionSmoke(f.call, issue)).rejects.toThrow('transition response lost');
    expect(f.state.status).toBe('Open');
  });

  it('fails and reports the final status if the reverse transition fails', async () => {
    const f = fixture();
    f.faults.set('issue_transition', (args) => { if (args.to === 'Reopen') { f.state.status = 'Doing'; throw new Error('reverse unavailable'); } });
    await expect(runTransitionSmoke(f.call, issue)).rejects.toThrow(/reverse unavailable[\s\S]*Doing/);
    expect(f.state.status).toBe('Doing');
  });

  it('fails incomplete table, heading and transition fixtures', async () => {
    const emptyTable: Call = async () => answer('The page has no tables.', true);
    await expect(runTableSmoke(emptyTable, page, cellMarker)).rejects.toThrow(/table/i);
    const emptyHeading: Call = async () => answer('# Scratch\nPage 1 in SD, v1\n\n');
    await expect(runOutlineSmoke(emptyHeading, page)).rejects.toThrow(/heading/i);
    const noTransition: Call = async (name) => name === 'issue_get'
      ? answer('TST-1\nStatus: Open | Priority: -\nLabels: - | Parent: -')
      : name === 'smoke_list_transitions' ? answer('[]') : answer('No transition. Available: none.', true);
    await expect(runTransitionSmoke(noTransition, issue)).rejects.toThrow(/transition/i);
  });

  it('requires explicit acknowledgements for scratch exclusivity, permanent comments and transitions', () => {
    expect(() => ensureAuthorization({})).toThrow(/scratch|comment|transition/i);
    expect(() => ensureAuthorization({ ATLAS_SMOKE_ACK_EXCLUSIVE_SCRATCH: '1', ATLAS_SMOKE_ACK_PERMANENT_COMMENT: '1' })).toThrow(/transition/i);
    expect(() => ensureAuthorization({ ATLAS_SMOKE_ACK_EXCLUSIVE_SCRATCH: '1', ATLAS_SMOKE_ACK_PERMANENT_COMMENT: '1', ATLAS_SMOKE_ACK_TRANSITION_RISK: '1' })).not.toThrow();
  });

  it('never sends a mutation when a workflow transition name collides with the old probe', async () => {
    const f = fixture();
    const requested: string[] = [];
    const call: Call = async (name, args) => {
      if (name === 'issue_transition') requested.push(String(args.to));
      return f.call(name, args);
    };
    await runTransitionSmoke(call, issue);
    expect(f.state.status).toBe('Open');
    expect(f.state.calls).toContain('smoke_list_transitions');
    expect(requested).toEqual(['Start', 'Reopen']);
  });

  it('refuses a competing transition name that would resolve to another target', async () => {
    const f = fixture();
    const call: Call = async (name, args) => name === 'smoke_list_transitions'
      ? answer(JSON.stringify([{ id: '1', name: 'Start', to: { name: 'Doing' } }, { id: '2', name: 'start', to: { name: 'Trap' } }]))
      : f.call(name, args);
    await expect(runTransitionSmoke(call, issue)).rejects.toThrow(/transition/i);
    expect(f.state.status).toBe('Open');
    expect(f.state.calls).not.toContain('issue_transition');
  });

  it('preserves an empty cell and its self-closing markup exactly', async () => {
    const f = fixture();
    f.state.page = original.replace('<td><p><strong>before</strong></p></td>', '<td/>');
    const emptyOriginal = f.state.page;
    const call: Call = async (name, args) => {
      if (name === 'table_update') {
        f.state.page = f.state.page.replace('<td/>', `<td><p>${cellMarker}</p></td>`);
        return answer('Row / Value: (empty) -> atlas-smoke-cell-test, v1 -> v2');
      }
      return f.call(name, args);
    };
    await runTableSmoke(call, page, cellMarker);
    expect(f.state.page).toBe(emptyOriginal);
  });

  it('fails an isError write response but restores its side effect', async () => {
    const f = fixture();
    const call: Call = async (name, args) => {
      const response = await f.call(name, args);
      return name === 'page_append' ? answer('server rejected', true) : response;
    };
    await expect(runPageSmoke(call, page, marker)).rejects.toThrow(/page_append failed/);
    expect(f.state.page).toBe(original);
  });

  it('fails and reports final issue status as unknown when it cannot be read', async () => {
    const f = fixture();
    let reads = 0;
    const call: Call = async (name, args) => {
      if (name === 'issue_get' && ++reads >= 3) throw new Error('status unavailable');
      return f.call(name, args);
    };
    await expect(runTransitionSmoke(call, issue)).rejects.toThrow(/final issue status unknown/);
    expect(f.state.status).toBe('Doing');
  });

  it('fails when reverse response is lost even if final status is restored', async () => {
    const f = fixture();
    f.faults.set('issue_transition', (args) => { if (args.to === 'Reopen') throw new Error('reverse response lost'); });
    await expect(runTransitionSmoke(f.call, issue)).rejects.toThrow(/reverse response lost[\s\S]*final issue status: Open/);
    expect(f.state.status).toBe('Open');
  });

  it('restores through a reverse transition named Open targeting Open from Doing', async () => {
    const f = fixture();
    const call: Call = async (name, args) => {
      if (name === 'smoke_list_transitions' && f.state.status === 'Doing') {
        return answer(JSON.stringify([{ id: '2', name: 'Open', to: { name: 'Open' } }]));
      }
      return f.call(name, args);
    };
    await expect(runTransitionSmoke(call, issue)).resolves.toBe('Open');
    expect(f.state.status).toBe('Open');
  });

  it('accepts destination-named forward transitions while rejecting current-status no-ops', async () => {
    const f = fixture();
    const call: Call = async (name, args) => name === 'smoke_list_transitions' && f.state.status === 'Open'
      ? answer(JSON.stringify([{ id: '1', name: 'Doing', to: { name: 'Doing' } }]))
      : f.call(name, args);
    await expect(runTransitionSmoke(call, issue)).resolves.toBe('Open');
    expect(f.state.status).toBe('Open');
    const trapped = fixture();
    const noOp: Call = async (name, args) => name === 'smoke_list_transitions'
      ? answer(JSON.stringify([{ id: '1', name: 'Open', to: { name: 'Doing' } }]))
      : trapped.call(name, args);
    await expect(runTransitionSmoke(noOp, issue)).rejects.toThrow(/unambiguous transition/);
    expect(trapped.state.calls).not.toContain('issue_transition');
  });

  it('does not retry an ambiguous permanent comment and reports it may exist', async () => {
    const f = fixture();
    f.faults.set('issue_comment', () => { throw new Error('comment response lost'); });
    await expect(runCommentSmoke(f.call, issue, marker)).rejects.toThrow(/comment[\s\S]*(may|possibly|inspect)/i);
    expect(f.state.comments).toBe(1);
  });
});
