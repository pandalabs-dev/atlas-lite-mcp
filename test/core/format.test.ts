import { describe, expect, it } from 'vitest';
import { mdTable, plural, versionLine } from '../../src/core/format.js';

describe('format helpers', () => {
  it('pluralises', () => {
    expect(plural(1, 'item')).toBe('1 item');
    expect(plural(2, 'item')).toBe('2 items');
    expect(plural(0, 'item')).toBe('0 items');
  });

  it('formats tables and version lines', () => {
    expect(mdTable(['id', 'title'], [['1', 'a|b']])).toBe('| id | title |\n| --- | --- |\n| 1 | a\\|b |');
    expect(versionLine('Updated', 'Costs', 13, 14, '1 replacement')).toBe('Updated "Costs" v13 -> v14 (1 replacement)');
  });

  it('omits the extra part when not given', () => {
    expect(versionLine('Appended to', 'Costs', 13, 14)).toBe('Appended to "Costs" v13 -> v14');
  });

  it('keeps each row on one line', () => {
    expect(mdTable(['a'], [['x\ny']])).toBe('| a |\n| --- |\n| x y |');
  });
});
