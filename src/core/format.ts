/** `1 item`, `2 items`, `0 items`. */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** A markdown table; `|` in cells is escaped and newlines become spaces so each row stays on one line. */
export function mdTable(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map((c) => c.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

/** `Updated "Costs" v13 -> v14 (1 replacement)`. */
export function versionLine(verb: string, title: string, from: number, to: number, extra?: string): string {
  return `${verb} "${title}" v${from} -> v${to}${extra ? ` (${extra})` : ''}`;
}
