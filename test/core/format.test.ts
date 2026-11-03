import { describe, expect, it } from 'vitest';
import { plural } from '../../src/core/format.js';

describe('format helpers', () => {
  it('pluralises', () => {
    expect(plural(1, 'item')).toBe('1 item');
    expect(plural(2, 'item')).toBe('2 items');
    expect(plural(0, 'item')).toBe('0 items');
  });
});
