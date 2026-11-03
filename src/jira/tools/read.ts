import { z } from 'zod';
import { AtlasError } from '../../core/errors.js';
import { mdTable } from '../../core/format.js';
import { formatDropped } from '../../core/placeholders.js';
import type { Runtime, SiteRuntime } from '../../core/runtime.js';
import { defineTool, siteParam, type ToolDef } from '../../core/tools.js';
import { parseIssueRef } from '../../core/url.js';
import { markdownToAdf } from '../adf/fromMarkdown.js';
import { adfToMarkdown, type AdfDoc, type AdfPlaceholder } from '../adf/toMarkdown.js';
import { addComment, doTransition, getIssue, getTransitions, listFields, searchIssues, type JiraIssue } from '../api.js';
import { displayValue } from '../fields.js';
import { buildJql } from '../jql.js';

const DEFAULT_FIELDS = ['summary', 'issuetype', 'status', 'priority', 'assignee', 'reporter', 'labels', 'parent', 'created', 'updated'];
const DEFAULT_LIMIT = 20;
const HAS_TOKEN = /\{\{atlas:\d+\}\}/;

const keyParam = z.string().describe('Issue key or URL');

interface JiraComment {
  id: string;
  author?: { displayName?: string };
  created?: string;
  body?: AdfDoc;
}

/** Resolves an issue key or URL to its site runtime and key; a URL host selects the site (spec 6.3). */
export function issueTarget(args: { key: string; site?: string }, rt: Runtime): { srt: SiteRuntime; key: string } {
  const ref = parseIssueRef(args.key);
  const srt = rt.resolve({ ...(args.site !== undefined && { site: args.site }), ...(ref.host !== undefined && { host: ref.host }) });
  return { srt, key: ref.key };
}

function date(value: unknown): string {
  return typeof value === 'string' && value !== '' ? value.slice(0, 10) : '-';
}

function commentsOf(issue: JiraIssue): JiraComment[] | undefined {
  const comments: unknown = issue.fields.comment?.comments;
  return Array.isArray(comments) ? (comments as JiraComment[]) : undefined;
}

/** Description and comments as markdown; tokens share one sequence, description first (spec 6.7). */
function renderIssue(issue: JiraIssue): { description: string; comments: { comment: JiraComment; markdown: string }[]; placeholders: AdfPlaceholder[] } {
  const description = adfToMarkdown(issue.fields.description);
  const placeholders = [...description.placeholders];
  const comments = (commentsOf(issue) ?? []).map((comment) => {
    const rendered = adfToMarkdown(comment.body, placeholders.length + 1);
    placeholders.push(...rendered.placeholders);
    return { comment, markdown: rendered.markdown };
  });
  return { description: description.markdown, comments, placeholders };
}

/**
 * The issue-wide token map for this issue version, keyed by its `updated` timestamp. An issue fetched
 * without comments gets its own version, so a description-only map is never served for a request that
 * needs comment tokens; a changed `updated` rebuilds the map from the fetched issue.
 */
export function issuePlaceholders(rt: Runtime, srt: SiteRuntime, issue: JiraIssue): Map<number, AdfPlaceholder> {
  const updated = String(issue.fields.updated ?? '');
  const version = commentsOf(issue) === undefined ? `${updated}:no-comments` : updated;
  return rt.placeholders
    .get<AdfPlaceholder>('jira')
    .getOrBuild(`jira:issue:${srt.site.name}:${issue.key}`, version, () => renderIssue(issue).placeholders);
}

/** Extra field names or ids resolved to field ids and display names; unknown names fail. */
async function resolveExtras(srt: SiteRuntime, names: string[]): Promise<{ id: string; name: string }[]> {
  if (names.length === 0) return [];
  const all = await listFields(srt);
  return names.map((raw) => {
    const wanted = raw.trim().toLowerCase();
    const field = all.find((f) => f.id.toLowerCase() === wanted) ?? all.find((f) => f.name.toLowerCase() === wanted);
    if (field === undefined) throw new AtlasError(`Unknown field "${raw.trim()}".`);
    return { id: field.id, name: field.name };
  });
}

const issueGet = defineTool({
  name: 'issue_get',
  description: 'Read a Jira issue: key fields and description as markdown.',
  shape: {
    key: keyParam,
    fields: z.array(z.string()).optional().describe('Extra field names or ids'),
    include_comments: z.boolean().optional(),
    site: siteParam,
  },
  async run(args, rt) {
    const { srt, key } = issueTarget(args, rt);
    const extras = (await resolveExtras(srt, args.fields ?? [])).filter((f) => !DEFAULT_FIELDS.includes(f.id) && f.id !== 'description');
    const request = [...DEFAULT_FIELDS, 'description', ...new Set(extras.map((f) => f.id))];
    if (args.include_comments) request.push('comment');
    const issue = await getIssue(srt, key, request);
    const f = issue.fields;

    const lines = [
      `${issue.key} [${displayValue(f.issuetype)}] ${displayValue(f.summary)}`,
      `Status: ${displayValue(f.status)} | Priority: ${displayValue(f.priority)} | Assignee: ${displayValue(f.assignee)} | Reporter: ${displayValue(f.reporter)}`,
      `Labels: ${displayValue(f.labels)} | Parent: ${displayValue(f.parent)} | Created: ${date(f.created)} | Updated: ${date(f.updated)}`,
      ...extras.map((x) => `${x.name}: ${displayValue(f[x.id])}`),
    ];
    const rendered = renderIssue(issue);
    if (rendered.description !== '') lines.push('', rendered.description);
    if (args.include_comments) {
      lines.push('', `Comments (${rendered.comments.length}):`);
      for (const { comment, markdown } of rendered.comments) {
        lines.push('', `### ${comment.author?.displayName ?? '-'}, ${date(comment.created)} (id ${comment.id})`, markdown);
      }
    }
    return lines.join('\n');
  },
});

const issueSearch = defineTool({
  name: 'issue_search',
  description: 'Search issues by JQL or plain text.',
  shape: {
    query: z.string(),
    limit: z.number().int().positive().optional().describe('Default 20'),
    site: siteParam,
  },
  async run(args, rt) {
    const srt = rt.resolve(args.site === undefined ? {} : { site: args.site });
    const issues = await searchIssues(srt, buildJql(args.query, srt.site.defaultJiraProject), args.limit ?? DEFAULT_LIMIT);
    if (issues.length === 0) return 'No issues found.';
    return mdTable(
      ['key', 'type', 'status', 'assignee', 'summary'],
      issues.map((i) => [i.key, displayValue(i.fields.issuetype), displayValue(i.fields.status), displayValue(i.fields.assignee), displayValue(i.fields.summary)]),
    );
  },
});

const issueTransition = defineTool({
  name: 'issue_transition',
  description: 'Move an issue to a status.',
  shape: { key: keyParam, to: z.string().describe('Status or transition name'), site: siteParam },
  async run(args, rt) {
    const { srt, key } = issueTarget(args, rt);
    const to = args.to.trim();
    const wanted = to.toLowerCase();
    const current = displayValue((await getIssue(srt, key, ['status'])).fields.status);
    if (current.toLowerCase() === wanted) return `${key} is already ${current}.`;

    const transitions = await getTransitions(srt, key);
    const byName = transitions.find((t) => t.name.toLowerCase() === wanted);
    const byStatus = transitions.filter((t) => t.to.name.toLowerCase() === wanted);
    if (byName === undefined && byStatus.length > 1) {
      throw new AtlasError(`Several transitions lead to "${to}": ${byStatus.map((t) => t.name).join(', ')}; pass the transition name.`);
    }
    const transition = byName ?? byStatus[0];
    if (transition === undefined) {
      const available = transitions.map((t) => `${t.name} (${t.to.name})`).join(', ');
      throw new AtlasError(`No transition to "${to}" from ${current}. Available: ${available || 'none'}.`);
    }
    await doTransition(srt, key, transition.id);
    return `${key}: ${current} -> ${transition.to.name}`;
  },
});

const issueComment = defineTool({
  name: 'issue_comment',
  description: 'Comment on an issue in markdown.',
  shape: { key: keyParam, markdown: z.string(), site: siteParam },
  async run(args, rt) {
    const { srt, key } = issueTarget(args, rt);
    // Tokens restore against the current issue version, so the map is rebuilt from a fresh read (spec 6.7).
    const tokens = HAS_TOKEN.test(args.markdown)
      ? issuePlaceholders(rt, srt, await getIssue(srt, key, ['description', 'comment', 'updated']))
      : undefined;
    const { doc, unknown } = markdownToAdf(args.markdown, tokens);
    const id = await addComment(srt, key, doc);
    const line = `Comment ${id} added to ${key}`;
    const note = formatDropped([], unknown);
    return note === null ? line : `${line}\n${note}`;
  },
});

export const readTools: ToolDef[] = [issueGet, issueSearch, issueTransition, issueComment];
