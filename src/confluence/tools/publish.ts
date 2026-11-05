import { z } from 'zod';
import { AtlasError } from '../../core/errors.js';
import { mdTable } from '../../core/format.js';
import { hasScopeClause, splitOrderBy } from '../../core/query.js';
import { defineTool, siteParam, type ToolDef } from '../../core/tools.js';
import { parsePageRef } from '../../core/url.js';
import { addFooterComment, createPage, getPage, searchPages, spaceIdForKey } from '../api.js';
import { markdownToStorage } from '../convert/fromMarkdown.js';
import { assertWellFormed } from '../storage/edit.js';
import { pageTarget } from './pages.js';

const CQL = /[=~<>]|\b(?:not\s+)?in\s*\(/i;
const DEFAULT_LIMIT = 10;

/** A CQL string literal: `\` and `"` escaped, wrapped in double quotes. */
function quote(s: string): string {
  return `"${s.replace(/[\\"]/g, '\\$&')}"`;
}

/**
 * Plain text becomes `type = page AND text ~ "..."`; CQL passes through. A known space scopes
 * the query unless it already has a space clause, and is prepended to the WHERE part only.
 */
export function buildCql(query: string, space?: string): string {
  const { where, orderBy } = splitOrderBy(query);
  const spaceClause = space === undefined ? undefined : `space = ${quote(space)}`;
  if (orderBy === '' && !CQL.test(where)) {
    return ['type = page', spaceClause, `text ~ ${quote(where)}`].filter((part) => part !== undefined).join(' AND ');
  }
  const scoped = spaceClause === undefined || hasScopeClause(where, 'space') ? where : where === '' ? spaceClause : `${spaceClause} AND (${where})`;
  return orderBy === '' ? scoped : `${scoped} ${orderBy}`;
}

/** Markdown from the model for a new page or comment, as checked storage XHTML. */
function toStorage(markdown: string): string {
  const storage = markdownToStorage(markdown);
  assertWellFormed(storage);
  return storage;
}

const pageCreate = defineTool({
  name: 'page_create',
  description: 'Create a page from markdown.',
  shape: {
    space: z.string().optional().describe('Space key; default from site'),
    title: z.string(),
    markdown: z.string(),
    parent: z.string().optional().describe('Parent page URL or id'),
    site: siteParam,
  },
  async run(args, rt) {
    const parent = args.parent === undefined ? undefined : parsePageRef(args.parent);
    const srt = rt.resolve({ ...(args.site !== undefined && { site: args.site }), ...(parent?.host !== undefined && { host: parent.host }) });
    const storage = toStorage(args.markdown);

    // An explicit space wins; otherwise a parent fixes the space, since a child lives in its parent's space.
    let spaceId: string;
    if (args.space !== undefined) spaceId = await spaceIdForKey(srt, args.space.trim());
    else if (parent !== undefined) spaceId = (await getPage(srt, parent.id)).spaceId;
    else if (srt.site.defaultConfluenceSpace !== undefined) spaceId = await spaceIdForKey(srt, srt.site.defaultConfluenceSpace);
    else throw new AtlasError(`No space for the new page; pass space or parent, or set defaultConfluenceSpace for site ${srt.site.name} in sites.json.`);

    const created = await createPage(srt, { spaceId, title: args.title, storage, ...(parent !== undefined && { parentId: parent.id }) });
    return `Created "${args.title}" ${created.id} v${created.version} ${created.url}`;
  },
});

const pageSearch = defineTool({
  name: 'page_search',
  description: 'Search pages by CQL or plain text.',
  shape: {
    query: z.string(),
    space: z.string().optional(),
    limit: z.number().int().positive().optional().describe('Default 10'),
    site: siteParam,
  },
  async run(args, rt) {
    const srt = rt.resolve(args.site === undefined ? {} : { site: args.site });
    // No site default here: a search spans all spaces unless space is given.
    const pages = await searchPages(srt, buildCql(args.query, args.space?.trim()), args.limit ?? DEFAULT_LIMIT);
    if (pages.length === 0) return 'No pages found.';
    return mdTable(['id', 'title', 'space', 'modified'], pages.map((p) => [p.id, p.title, p.space, p.modified]));
  },
});

const pageComment = defineTool({
  name: 'page_comment',
  description: 'Add a footer comment to a page.',
  shape: { url: z.string().describe('Page URL or id'), markdown: z.string(), site: siteParam },
  async run(args, rt) {
    const { srt, id } = pageTarget(args, rt);
    const storage = toStorage(args.markdown);
    const page = await getPage(srt, id);
    const commentId = await addFooterComment(srt, id, storage);
    return `Comment ${commentId} added to "${page.title}"`;
  },
});

export const publishTools: ToolDef[] = [pageCreate, pageSearch, pageComment];
