/** Writes one line to stderr. stdout belongs to the MCP protocol. */
export function log(line: string): void {
  process.stderr.write(line + '\n');
}
