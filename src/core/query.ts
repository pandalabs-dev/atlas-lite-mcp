const ORDER_BY = /^order\s+by\b/i;

/**
 * Splits a CQL or JQL query at its last `ORDER BY` outside single- or double-quoted strings (escapes
 * honoured). Both parts are trimmed; `orderBy` keeps the `ORDER BY ...` text and is '' when absent.
 * The one ORDER BY helper, shared by buildCql and buildJql.
 */
export function splitOrderBy(query: string): { where: string; orderBy: string } {
  let at = -1;
  for (const i of outsideQuotes(query)) {
    if ((i === 0 || !/\w/.test(query[i - 1] ?? '')) && ORDER_BY.test(query.slice(i))) {
      at = i;
    }
  }
  if (at === -1) return { where: query.trim(), orderBy: '' };
  return { where: query.slice(0, at).trim(), orderBy: query.slice(at).trim() };
}

/** Finds a project/space predicate without treating search text as a scope clause. */
export function hasScopeClause(query: string, field: 'project' | 'space'): boolean {
  const name = field === 'space' ? 'space(?:\\.key)?' : 'project';
  const clause = new RegExp(`^(?:${name}\\b|"${name}"|'${name}')\\s*(?:!?=|in\\b|not\\s+in\\b)`, 'i');
  for (const i of outsideQuotes(query)) {
    if (!/[\w.]/.test(query[i - 1] ?? '') && clause.test(query.slice(i))) return true;
  }
  return false;
}

/** Includes opening quotes so a quoted field name can still start a predicate. */
function* outsideQuotes(query: string): Generator<number> {
  let quote: string | undefined;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (quote !== undefined) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
    } else {
      yield i;
      if (ch === '"' || ch === "'") quote = ch;
    }
  }
}
