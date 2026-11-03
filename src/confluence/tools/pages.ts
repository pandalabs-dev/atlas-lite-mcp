import { z } from 'zod';
import { AtlasError } from '../../core/errors.js';
import { plural, versionLine } from '../../core/format.js';
import { formatDropped } from '../../core/placeholders.js';
import type { Runtime, SiteRuntime } from '../../core/runtime.js';
import { defineTool, siteParam, type ToolDef } from '../../core/tools.js';
import { parsePageRef } from '../../core/url.js';
import { getPage, spaceKeyForId, type PageData } from '../api.js';
import { storageToMarkdown } from '../convert/toMarkdown.js';
import { parseStorage } from '../storage/dom.js';
import { findReplace } from '../storage/edit.js';
import { collectStoragePlaceholders, type StoragePlaceholder } from '../storage/placeholders.js';
import { appendMarkdown, replaceSection } from '../storage/rewrite.js';
import { findSection, outline } from '../storage/sections.js';
import { writePage, type WriteResult } from '../write.js';

const urlParam = z.string().describe('Page URL or id');

/** Resolves a page URL or id to its site runtime and page id; a URL host selects the site (spec 6.3). */
export function pageTarget(args: { url?: string; id?: string; site?: string }, rt: Runtime): { srt: SiteRuntime; id: string } {
  const input = args.url ?? args.id;
  if (input === undefined) throw new AtlasError('Pass url or id.');
  const ref = parsePageRef(input);
  const srt = rt.resolve({ ...(args.site !== undefined && { site: args.site }), ...(ref.host !== undefined && { host: ref.host }) });
  return { srt, id: ref.id };
}

/**
 * The page-wide token map for this page version. A map stored for another version, or none at all
 * (a fresh process), is rebuilt from the current storage, so tokens always restore against it (spec 6.7).
 */
function tokenMap(rt: Runtime, srt: SiteRuntime, page: PageData, build?: () => StoragePlaceholder[]): Map<number, StoragePlaceholder> {
  const key = `confluence:page:${srt.site.name}:${page.id}`;
  return rt.placeholders
    .get<StoragePlaceholder>('confluence')
    .getOrBuild(key, String(page.version), build ?? (() => collectStoragePlaceholders(page.storage, parseStorage(page.storage))));
}

/** `Updated "Costs" v13 -> v14 (extra)`, or `No change to "Costs" (v13)` when nothing was written. */
function writeLine(verb: string, noChange: string, title: string, r: WriteResult, extra?: string): string {
  return r.unchanged ? `${noChange} "${title}" (v${r.from})` : versionLine(verb, title, r.from, r.to, extra);
}

function withNote(line: string, note: string | undefined): string {
  return note === undefined ? line : `${line}\n${note}`;
}

const pageGet = defineTool({
  name: 'page_get',
  description: 'Read a Confluence page as markdown, storage XHTML, or an outline of headings and tables.',
  shape: {
    url: z.string().optional().describe('Page URL or id'),
    id: z.string().optional().describe('Page id'),
    format: z.enum(['markdown', 'storage', 'outline']).optional().describe('Default markdown'),
    section: z.string().optional().describe('Heading text'),
    site: siteParam,
  },
  async run(args, rt) {
    const format = args.format ?? 'markdown';
    const { srt, id } = pageTarget(args, rt);
    if (args.section !== undefined && format === 'outline') throw new AtlasError('Pass section with format markdown or storage, not outline.');
    const page = await getPage(srt, id);
    const section = args.section === undefined ? undefined : findSection(page.storage, parseStorage(page.storage), args.section);
    const spaceKey = await spaceKeyForId(srt, page.spaceId);

    let body: string;
    if (format === 'outline') {
      body = outline(page.storage);
    } else if (format === 'storage') {
      body = section === undefined ? page.storage : page.storage.slice(section.start, section.end);
    } else {
      const within = section === undefined ? undefined : { start: section.start, end: section.end };
      const { markdown, placeholders } = storageToMarkdown(page.storage, within === undefined ? undefined : { within });
      tokenMap(rt, srt, page, () => placeholders);
      body = markdown.trim();
    }
    const title = section === undefined ? page.title : `${page.title} > ${section.heading.text}`;
    return [`# ${title}`, `Page ${page.id} in ${spaceKey}, v${page.version}`, '', body].join('\n');
  },
});

const pageEdit = defineTool({
  name: 'page_edit',
  description: 'Exact find and replace on the page storage XHTML.',
  shape: {
    url: urlParam,
    find: z.string(),
    replace: z.string(),
    all: z.boolean().optional().describe('Replace every match'),
    site: siteParam,
  },
  async run(args, rt) {
    const { srt, id } = pageTarget(args, rt);
    let count = 0;
    const r = await writePage(srt, id, 'page_edit', (page) => {
      const edit = findReplace(page.storage, args.find, args.replace, args.all ?? false);
      count = edit.count;
      return { storage: edit.storage };
    });
    return writeLine('Updated', 'No change to', r.page.title, r, plural(count, 'replacement'));
  },
});

const pageUpdateSection = defineTool({
  name: 'page_update_section',
  description: 'Replace the content under a heading with markdown; keep {{atlas:N}} tokens to preserve macros.',
  shape: { url: urlParam, heading: z.string(), markdown: z.string(), site: siteParam },
  async run(args, rt) {
    const { srt, id } = pageTarget(args, rt);
    const r = await writePage(srt, id, 'page_update_section', (page) => {
      const { storage, dropped, unknown } = replaceSection(page.storage, args.heading, args.markdown, tokenMap(rt, srt, page));
      const note = formatDropped(dropped, unknown);
      return note === null ? { storage } : { storage, note };
    });
    const heading = args.heading.trim();
    return withNote(writeLine(`Updated section "${heading}" in`, `No change to section "${heading}" in`, r.page.title, r), r.note);
  },
});

const pageAppend = defineTool({
  name: 'page_append',
  description: 'Append markdown to the end of a page.',
  shape: { url: urlParam, markdown: z.string(), site: siteParam },
  async run(args, rt) {
    const { srt, id } = pageTarget(args, rt);
    const r = await writePage(srt, id, 'page_append', (page) => {
      const { storage, unknown } = appendMarkdown(page.storage, args.markdown, tokenMap(rt, srt, page));
      const note = formatDropped([], unknown);
      return note === null ? { storage } : { storage, note };
    });
    return withNote(writeLine('Appended to', 'No change to', r.page.title, r), r.note);
  },
});

export const pageTools: ToolDef[] = [pageGet, pageEdit, pageUpdateSection, pageAppend];
