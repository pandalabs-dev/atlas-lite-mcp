import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** Reads `test/fixtures/<name>` as UTF-8. */
export function fixture(name: string): string {
  return readFileSync(root + name, 'utf8');
}
