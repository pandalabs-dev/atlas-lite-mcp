import { z } from 'zod';
import { AtlasError } from '../../core/errors.js';
import { formatDropped } from '../../core/placeholders.js';
import { defineTool, siteParam, type ToolDef } from '../../core/tools.js';
import { markdownToAdf } from '../adf/fromMarkdown.js';
import { adfToMarkdown } from '../adf/toMarkdown.js';
import { createIssue, createMeta, deleteIssue, editMeta, getIssue, projectIssueTypes, updateIssue } from '../api.js';
import { formatMissing, missingRequired, resolveFields } from '../fields.js';
import { findUser } from '../users.js';
import { issuePlaceholders, issueTarget } from './read.js';

const fieldsParam = z.record(z.string(), z.unknown()).optional();

/** `\nDropped: ...` when something was dropped, else nothing. */
function droppedSuffix(note: string | null): string {
  return note === null ? '' : `\n${note}`;
}

const issueCreate = defineTool({
  name: 'issue_create',
  description: 'Create an issue; fields map names or ids to plain values.',
  shape: {
    project: z.string().optional().describe('Default from site'),
    type: z.string().describe('Issue type name'),
    summary: z.string(),
    description: z.string().optional().describe('Markdown'),
    fields: fieldsParam,
    labels: z.array(z.string()).optional(),
    assignee: z.string().optional().describe('Name or email'),
    site: siteParam,
  },
  async run(args, rt) {
    const srt = rt.resolve(args.site === undefined ? {} : { site: args.site });
    const project = (args.project?.trim() || srt.site.defaultJiraProject)?.toUpperCase();
    if (!project) throw new AtlasError(`Pass project; site ${srt.site.name} has no defaultJiraProject.`);

    const types = await projectIssueTypes(srt, project);
    const wanted = args.type.trim().toLowerCase();
    const type = types.find((t) => t.name.toLowerCase() === wanted);
    if (type === undefined) {
      throw new AtlasError(`No issue type "${args.type.trim()}" in ${project}. Types: ${types.map((t) => t.name).join(', ') || 'none'}.`);
    }

    const meta = await createMeta(srt, project, type.id);
    const label = `${project} ${type.name}`;
    const resolved = await resolveFields(srt, meta, args.fields ?? {}, label);
    const description = args.description === undefined ? undefined : markdownToAdf(args.description);
    const fields: Record<string, unknown> = {
      ...resolved.fields,
      project: { key: project },
      issuetype: { id: type.id },
      summary: args.summary,
      ...(description !== undefined && { description: description.doc }),
      ...(args.labels !== undefined && { labels: args.labels }),
      ...(args.assignee !== undefined && { assignee: { accountId: (await findUser(srt, args.assignee)).accountId } }),
    };

    const missing = missingRequired(meta, new Set(Object.keys(fields)));
    if (missing.length > 0) throw new AtlasError(formatMissing(label, missing));

    const { key } = await createIssue(srt, fields);
    return `Created ${key} ${srt.site.baseUrl}/browse/${key}${droppedSuffix(formatDropped([], description?.unknown ?? []))}`;
  },
});

const issueUpdate = defineTool({
  name: 'issue_update',
  description: 'Update issue fields, summary or description.',
  shape: {
    key: z.string().describe('Issue key or URL'),
    fields: fieldsParam.describe('Names or ids to plain values'),
    description: z.string().optional().describe('Markdown'),
    summary: z.string().optional(),
    site: siteParam,
  },
  async run(args, rt) {
    const input = args.fields ?? {};
    const hasFields = Object.keys(input).length > 0;
    if (!hasFields && args.summary === undefined && args.description === undefined) {
      throw new AtlasError('Nothing to update; pass fields, summary or description.');
    }
    const { srt, key } = issueTarget(args, rt);

    // Editmeta lists exactly the fields editable on this issue, so it replaces create metadata here.
    const resolved = hasFields ? await resolveFields(srt, await editMeta(srt, key), input, key) : { fields: {}, names: [] };
    const fields: Record<string, unknown> = { ...resolved.fields };
    // One name per field id; the plain summary and description arguments replace a same-id entry.
    const names = new Map(Object.keys(resolved.fields).map((id, i) => [id, resolved.names[i] ?? id] as const));
    if (args.summary !== undefined) {
      fields.summary = args.summary;
      names.set('summary', 'summary');
    }

    let note: string | null = null;
    if (args.description !== undefined) {
      // Tokens restore against the current issue version, so the map is rebuilt from a fresh read (spec 6.7).
      const issue = await getIssue(srt, key, ['description', 'comment', 'updated']);
      const tokens = issuePlaceholders(rt, srt, issue);
      const { doc, used, unknown } = markdownToAdf(args.description, tokens);
      // Description tokens come first in the issue-wide sequence; the rest belong to comments.
      const own = adfToMarkdown(issue.fields.description).placeholders.length;
      const dropped = [...tokens.values()].filter((p) => p.n <= own && !used.has(p.n));
      fields.description = doc;
      names.set('description', 'description');
      note = formatDropped(dropped, unknown);
    }

    await updateIssue(srt, key, fields);
    return `Updated ${key}: ${[...names.values()].join(', ')}${droppedSuffix(note)}`;
  },
});

const issueDelete = defineTool({
  name: 'issue_delete',
  description: 'Permanently delete a Jira issue. Subtasks require deleteSubtasks: true.',
  annotations: { readOnlyHint: false, destructiveHint: true },
  shape: {
    key: z.string().describe('Issue key or URL'),
    deleteSubtasks: z.boolean().optional().describe('Also delete subtasks; default false'),
    site: siteParam,
  },
  async run(args, rt) {
    const { srt, key } = issueTarget(args, rt);
    await deleteIssue(srt, key, args.deleteSubtasks);
    return `Deleted ${key} on ${srt.site.name}${args.deleteSubtasks ? ' including subtasks' : ''}.`;
  },
});

export const writeTools: ToolDef[] = [issueCreate, issueUpdate, issueDelete];
