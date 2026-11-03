const ORDER_BY = /^order\s+by\b/i;

/**
 * Splits a CQL or JQL query at its last `ORDER BY` outside double-quoted strings (`\"` escapes
 * honoured). Both parts are trimmed; `orderBy` keeps the `ORDER BY ...` text and is '' when absent.
 * The one ORDER BY helper, shared by buildCql and buildJql.
 */
export function splitOrderBy(query: string): { where: string; orderBy: string } {
  let at = -1;
  let inQuote = false;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (inQuote) {
      if (ch === '\\') i++;
      else if (ch === '"') inQuote = false;
    } else if (ch === '"') {
      inQuote = true;
    } else if ((i === 0 || !/\w/.test(query[i - 1] ?? '')) && ORDER_BY.test(query.slice(i))) {
      at = i;
    }
  }
  if (at === -1) return { where: query.trim(), orderBy: '' };
  return { where: query.slice(0, at).trim(), orderBy: query.slice(at).trim() };
}
