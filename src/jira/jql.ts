import { hasScopeClause, splitOrderBy } from '../core/query.js';

const JQL = /[=~<>]|\b(?:not\s+)?in\s*\(|\bis\s+(?:not\s+)?(?:empty|null)\b/i;

function looksLikeJql(where: string, orderBy: string): boolean {
  return orderBy !== '' || JQL.test(where);
}

/** True when the query reads as JQL rather than plain text. */
export function isJql(q: string): boolean {
  const { where, orderBy } = splitOrderBy(q);
  return looksLikeJql(where, orderBy);
}

/** A JQL string literal: `\` and `"` escaped, wrapped in double quotes. */
export function quote(s: string): string {
  return `"${s.replace(/[\\"]/g, '\\$&')}"`;
}

/**
 * Plain text becomes `text ~ "..." ORDER BY updated DESC`; JQL passes through. A default project
 * scopes the query unless it already has a project clause, and is prepended to the WHERE part only.
 */
export function buildJql(query: string, defaultProject?: string): string {
  let { where, orderBy } = splitOrderBy(query);
  if (!looksLikeJql(where, orderBy)) {
    where = `text ~ ${quote(where)}`;
    orderBy = 'ORDER BY updated DESC';
  }
  if (defaultProject !== undefined && !hasScopeClause(where, 'project')) {
    const project = `project = ${quote(defaultProject)}`;
    where = where === '' ? project : `${project} AND (${where})`;
  }
  return orderBy === '' ? where : `${where} ${orderBy}`;
}
