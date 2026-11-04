import { isTag, type Element } from 'domhandler';
import { parseStorage, textOf } from '../../src/confluence/storage/dom.js';
import { selectTable, updateCell } from '../../src/confluence/storage/tables.js';

export interface Response { content?: unknown; isError?: unknown; [key: string]: unknown }
export type Call = (name: string, args: Record<string, unknown>) => Promise<Response>;

function text(response: Response): string {
  if (!Array.isArray(response.content)) throw new Error('Missing tool response content');
  const first = response.content.find((item: { type?: string }) => item.type === 'text');
  if (!first || typeof first.text !== 'string') throw new Error('Missing text response');
  return first.text;
}

function checked(response: Response, operation: string): string {
  const result = text(response);
  if (response.isError) throw new Error(`${operation} failed: ${result}`);
  return result;
}

function requireMatch(value: string, regex: RegExp, operation: string): void {
  if (!regex.test(value)) throw new Error(`${operation} returned an unexpected response: ${value}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withCleanup(work: () => Promise<void>, cleanup: () => Promise<void>): Promise<void> {
  let primary: unknown;
  let failed = false;
  try { await work(); } catch (e) { primary = e; failed = true; }
  try { await cleanup(); } catch (e) {
    if (failed) throw new Error(`${errorText(primary)}; cleanup failed: ${errorText(e)}`);
    throw new Error(`Cleanup failed: ${errorText(e)}`);
  }
  if (failed) throw primary;
}

function safeMarker(marker: string): void {
  if (!/^atlas-smoke-[a-z0-9-]+$/.test(marker)) throw new Error('Invalid smoke marker');
}

async function storageOf(call: Call, page: string): Promise<string> {
  const output = checked(await call('page_get', { url: page, format: 'storage' }), 'page_get storage');
  const split = output.indexOf('\n\n');
  if (split < 0 || !/^# .+\nPage .+, v\d+\n\n/.test(output)) throw new Error('Invalid page storage response');
  return output.slice(split + 2);
}

async function editAndVerify(call: Call, page: string, from: string, to: string, verify: () => Promise<void>): Promise<void> {
  let error: unknown;
  let failed = false;
  try {
    requireMatch(checked(await call('page_edit', { url: page, find: from, replace: to }), 'page_edit cleanup'), /\(1 replacement\)$/, 'page_edit cleanup');
  } catch (e) { error = e; failed = true; }
  try { await verify(); } catch (e) {
    if (failed) throw new Error(`${errorText(error)}; verification failed: ${errorText(e)}`);
    throw e;
  }
  if (failed) throw error;
}

export function ensureAuthorization(env: NodeJS.ProcessEnv): void {
  if (env.ATLAS_SMOKE_ACK_EXCLUSIVE_SCRATCH !== '1') throw new Error('Explicit exclusive scratch acknowledgement required');
  if (env.ATLAS_SMOKE_ACK_PERMANENT_COMMENT !== '1') throw new Error('Explicit permanent comment acknowledgement required');
  if (env.ATLAS_SMOKE_ACK_TRANSITION_RISK !== '1') throw new Error('Explicit transition risk acknowledgement required');
}

export async function runPageSmoke(call: Call, page: string, marker: string): Promise<void> {
  safeMarker(marker);
  if ((await storageOf(call, page)).includes(marker)) throw new Error('Page already contains the smoke marker');
  const plain = `<p>${marker}</p>`;
  const edited = `<p>${marker}-edited</p>`;
  await withCleanup(async () => {
    requireMatch(checked(await call('page_append', { url: page, markdown: marker }), 'page_append'), /^Appended to ".+" v\d+ -> v\d+$/, 'page_append');
    requireMatch(checked(await call('page_edit', { url: page, find: marker, replace: marker + '-edited' }), 'page_edit'), /\(1 replacement\)$/, 'page_edit');
  }, async () => {
    const current = await storageOf(call, page);
    const occurrences = current.split(marker).length - 1;
    if (occurrences === 0) return;
    const snippet = current.includes(edited) ? edited : current.includes(plain) ? plain : '';
    if (occurrences !== 1 || snippet === '') throw new Error('Page marker changed or duplicated; manual cleanup required');
    await editAndVerify(call, page, snippet, '', async () => {
      if ((await storageOf(call, page)).includes(marker)) throw new Error('Page marker remains; manual cleanup required');
    });
  });
}

function cellElements(row: Element): Element[] {
  return row.children.filter((n): n is Element => isTag(n) && (n.name === 'th' || n.name === 'td'));
}

interface CellSnapshot { row: string; column: string; markup: string }
function firstCell(storage: string): CellSnapshot {
  const table = selectTable(storage, parseStorage(storage));
  const row = table.rows[1];
  const col = table.header[1];
  if (!row || !col) throw new Error('Scratch table requires a header and a body row with at least two cells');
  const cells = cellElements(row);
  const label = cells[0] ? textOf(cells[0]) : '';
  const cell = cells[1];
  if (!label || !cell || cell.startIndex === null || cell.endIndex === null) throw new Error('Scratch table requires a labelled row and a second cell');
  return { row: label, column: col, markup: storage.slice(cell.startIndex, cell.endIndex + 1) };
}

export async function runTableSmoke(call: Call, page: string, marker: string): Promise<void> {
  safeMarker(marker);
  const tableText = checked(await call('table_get', { url: page }), 'table_get');
  requireMatch(tableText, /^Table 1 \(\d+ rows x \d+ cols\)/, 'table_get');
  const storage = await storageOf(call, page);
  if (storage.includes(marker)) throw new Error('Page already contains the table marker');
  const original = firstCell(storage);
  const changedStorage = updateCell(storage, undefined, original.row, original.column, marker).storage;
  const changed = firstCell(changedStorage);
  if (!changed.markup.includes(marker) || changed.markup === original.markup) throw new Error('Unable to construct a unique table marker');
  await withCleanup(async () => {
    requireMatch(checked(await call('table_update', { url: page, row: original.row, column: original.column, value: marker }), 'table_update'), /v\d+ -> v\d+$/, 'table_update');
    const current = firstCell(await storageOf(call, page));
    if (current.row !== original.row || current.column !== original.column || current.markup !== changed.markup) {
      throw new Error('Table cell changed unexpectedly after update');
    }
  }, async () => {
    const currentStorage = await storageOf(call, page);
    const current = firstCell(currentStorage);
    if (current.row !== original.row || current.column !== original.column) throw new Error('Table target changed; manual restore required');
    if (current.markup === original.markup && !currentStorage.includes(marker)) return;
    if (current.markup !== changed.markup || currentStorage.split(marker).length !== 2) throw new Error('Table cell changed or marker duplicated; manual restore required');
    await editAndVerify(call, page, changed.markup, original.markup, async () => {
      const finalStorage = await storageOf(call, page);
      const final = firstCell(finalStorage);
      if (final.row !== original.row || final.column !== original.column || final.markup !== original.markup || finalStorage.includes(marker)) {
        throw new Error('Table cell was not restored exactly; manual restore required');
      }
    });
  });
}

export async function runOutlineSmoke(call: Call, page: string): Promise<void> {
  const outline = checked(await call('page_get', { url: page, format: 'outline' }), 'page_get outline');
  const first = outline.split('\n').find((line) => /^\s*h[1-6] .+/.test(line));
  if (!first) throw new Error('Scratch page must contain a heading');
  const section = checked(await call('page_get', { url: page, section: first.trim().slice(3) }), 'page_get section');
  requireMatch(section.split('\n')[0] ?? '', /^# .+ > .+$/, 'page_get section');
}

function labelsOf(issue: string): string[] {
  const value = /(?:^|\n)Labels: (.*?) \|/.exec(issue)?.[1];
  if (value === undefined) throw new Error('Missing labels in issue response');
  return value === '-' ? [] : value.split(',').map((s) => s.trim());
}

async function issueText(call: Call, issue: string): Promise<string> {
  return checked(await call('issue_get', { key: issue }), 'issue_get');
}

export async function runLabelSmoke(call: Call, issue: string, marker: string): Promise<void> {
  safeMarker(marker);
  const before = labelsOf(await issueText(call, issue));
  if (before.includes(marker)) throw new Error('Issue already contains the smoke label');
  await withCleanup(async () => {
    requireMatch(checked(await call('issue_update', { key: issue, fields: { labels: [...before, marker] } }), 'issue_update'), /^Updated .+: Labels$/, 'issue_update');
    if (!labelsOf(await issueText(call, issue)).includes(marker)) throw new Error('Smoke label was not observed');
  }, async () => {
    const current = labelsOf(await issueText(call, issue));
    const missing = before.filter((label) => !current.includes(label));
    let cleanupError: unknown;
    if (current.includes(marker)) {
      try {
        requireMatch(checked(await call('issue_update', { key: issue, fields: { labels: current.filter((label) => label !== marker) } }), 'issue_update cleanup'), /^Updated .+: Labels$/, 'issue_update cleanup');
      } catch (e) { cleanupError = e; }
    }
    let final: string[];
    try { final = labelsOf(await issueText(call, issue)); } catch (e) {
      throw new Error(`${cleanupError ? `${errorText(cleanupError)}; ` : ''}label verification failed: ${errorText(e)}`);
    }
    if (cleanupError) throw new Error(`${errorText(cleanupError)}; final labels: ${final.join(', ') || '-'}`);
    if (final.includes(marker)) throw new Error('Smoke label remains; manual cleanup required');
    if (missing.length || before.some((label) => !final.includes(label))) throw new Error('An original label was removed concurrently; manual inspection required');
  });
}

function statusOf(issue: string): string {
  const status = /(?:^|\n)Status: (.+?) \|/.exec(issue)?.[1];
  if (!status || status === '-') throw new Error('Missing issue status');
  return status;
}

interface Transition { id: string; name: string; to: { name: string } }
async function transitionsOf(call: Call, issue: string): Promise<Transition[]> {
  const response = checked(await call('smoke_list_transitions', { key: issue }), 'read transitions');
  const data: unknown = JSON.parse(response);
  if (!Array.isArray(data) || !data.every((item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    const t = item as { id?: unknown; name?: unknown; to?: { name?: unknown } };
    return typeof t.id === 'string' && typeof t.name === 'string' && t.name !== '' && typeof t.to?.name === 'string' && t.to.name !== '';
  })) throw new Error('Invalid transition list');
  return data as Transition[];
}
function unambiguousTransition(transitions: Transition[], current: string, destination: string): Transition | undefined {
  const candidates = transitions.filter((t) => t.to.name.toLowerCase() === destination.toLowerCase());
  return candidates.find((t) => transitions.filter((x) => x.name.toLowerCase() === t.name.toLowerCase()).length === 1 && t.name.toLowerCase() !== current.toLowerCase());
}
export async function runTransitionSmoke(call: Call, issue: string): Promise<string> {
  const status = statusOf(await issueText(call, issue));
  const transitions = await transitionsOf(call, issue);
  const target = transitions.find((t) => t.to.name.toLowerCase() !== status.toLowerCase()
    && unambiguousTransition(transitions, status, t.to.name)?.id === t.id);
  if (!target) throw new Error(`Scratch issue has no unambiguous transition away from ${status}`);
  let finalStatus = 'unknown';
  await withCleanup(async () => {
    requireMatch(checked(await call('issue_transition', { key: issue, to: target.name }), 'issue_transition'), new RegExp(`^${escapeRegExp(issue)}: ${escapeRegExp(status)} -> ${escapeRegExp(target.to.name)}$`), 'issue_transition');
    if (statusOf(await issueText(call, issue)) !== target.to.name) throw new Error('Issue status changed unexpectedly after transition');
  }, async () => {
    let problem: unknown;
    try {
      const current = statusOf(await issueText(call, issue));
      if (current === target.to.name) {
        const reverse = unambiguousTransition(await transitionsOf(call, issue), current, status);
        if (!reverse) throw new Error('No unambiguous reverse transition; manual restore required');
        requireMatch(checked(await call('issue_transition', { key: issue, to: reverse.name }), 'reverse transition'), new RegExp(`^${escapeRegExp(issue)}: ${escapeRegExp(target.to.name)} -> ${escapeRegExp(status)}$`), 'reverse transition');
      } else if (current !== status) {
        throw new Error(`Issue status changed concurrently to ${current}; manual restore required`);
      }
    } catch (e) { problem = e; }
    try { finalStatus = statusOf(await issueText(call, issue)); } catch (e) {
      throw new Error(`${problem ? `${errorText(problem)}; ` : ''}final issue status unknown: ${errorText(e)}`);
    }
    if (problem) throw new Error(`${errorText(problem)}; final issue status: ${finalStatus}`);
    if (finalStatus !== status) throw new Error(`Issue not restored; final issue status: ${finalStatus}`);
  });
  return finalStatus;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function runCommentSmoke(call: Call, issue: string, marker: string): Promise<void> {
  safeMarker(marker);
  try {
    requireMatch(checked(await call('issue_comment', { key: issue, markdown: marker }), 'issue_comment'), /^Comment \d+ added to /, 'issue_comment');
  } catch (e) {
    throw new Error(`Permanent comment may exist on ${issue}; inspect before retrying (${marker}): ${errorText(e)}`);
  }
}
