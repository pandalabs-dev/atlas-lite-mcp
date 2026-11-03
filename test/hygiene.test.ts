import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = [
  ...walk(join(root, 'src')),
  ...walk(join(root, 'test')),
  ...['README.md', 'LICENSE', 'package.json'].map((f) => join(root, f)).filter((f) => existsSync(f)),
].map((f) => relative(root, f));

const read = (f: string): string => readFileSync(join(root, f), 'utf8');

describe('repository hygiene', () => {
  it('scans the source and test trees', () => {
    expect(files).toContain('package.json');
    expect(files).toContain(join('test', 'hygiene.test.ts'));
  });

  it('contains no en or em dash characters', () => {
    for (const f of files) expect(read(f), f).not.toMatch(/[\u2013\u2014]/);
  });

  it('never uses the DELETE HTTP method', () => {
    for (const f of files.filter((f) => !f.endsWith('hygiene.test.ts'))) expect(read(f), f).not.toMatch(/['"`]DELETE['"`]/);
  });

  it.skipIf(process.env.ATLAS_ALLOW_NETWORK === '1')('blocks the global fetch in unit tests', () => {
    expect(() => fetch('https://example.com')).toThrow(/Network disabled in unit tests/);
  });
});
