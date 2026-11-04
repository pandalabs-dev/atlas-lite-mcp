import { describe, expect, it, vi } from 'vitest';
import { formatDropped, type Placeholder, PlaceholderStore, TOKEN_RE, tokenText } from '../../src/core/placeholders.js';

const p = (n: number, hint: string): Placeholder<string> => ({ n, hint, original: `<x n="${n}"/>`, block: false });

describe('placeholders', () => {
  it('renders a token with its hint', () => {
    expect(tokenText(p(3, 'macro: toc'))).toBe('{{atlas:3}} [macro: toc]');
  });

  it('TOKEN_RE matches tokens with and without a hint', () => {
    const text = 'a {{atlas:3}} [macro: toc] b {{atlas:12}} c';
    expect([...text.matchAll(TOKEN_RE)].map((m) => [m[0], m[1]])).toEqual([
      ['{{atlas:3}} [macro: toc]', '3'],
      ['{{atlas:12}}', '12'],
    ]);
  });

  it('formats dropped lines', () => {
    expect(formatDropped([p(1, 'macro: toc'), p(2, 'image: screenshot.png')], [])).toBe(
      'Dropped: 2 items: [macro: toc], [image: screenshot.png]',
    );
    expect(formatDropped([], [9])).toBe('Dropped: 1 item: {{atlas:9}} [unknown token]');
    expect(formatDropped([p(1, 'macro: toc')], [9])).toBe('Dropped: 2 items: [macro: toc], {{atlas:9}} [unknown token]');
    expect(formatDropped([], [])).toBeNull();
  });

  it('PlaceholderStore rebuilds on version change and caches otherwise', () => {
    const s = new PlaceholderStore<Placeholder<string>>();
    const build = vi.fn(() => [p(1, 'x')]);
    const key = 'confluence:page:northstar:1';
    const first = s.getOrBuild(key, '13', build);
    expect(s.getOrBuild(key, '13', build)).toBe(first);
    expect(s.getOrBuild(key, '14', build).get(1)?.hint).toBe('x');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('PlaceholderStore evicts the least recently used key beyond its limit', () => {
    const s = new PlaceholderStore<Placeholder<string>>(2);
    const build = vi.fn(() => [p(1, 'x')]);
    s.getOrBuild('a', '1', build);
    s.getOrBuild('b', '1', build);
    s.getOrBuild('a', '1', build);
    s.getOrBuild('c', '1', build);
    expect(build).toHaveBeenCalledTimes(3);
    s.getOrBuild('a', '1', build);
    expect(build).toHaveBeenCalledTimes(3);
    s.getOrBuild('b', '1', build);
    expect(build).toHaveBeenCalledTimes(4);
  });
});
