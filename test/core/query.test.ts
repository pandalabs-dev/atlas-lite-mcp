import { describe, expect, it } from 'vitest';
import { splitOrderBy } from '../../src/core/query.js';

describe('splitOrderBy', () => {
  it('keeps ORDER BY inside single-quoted literals, including escaped quotes', () => {
    expect(splitOrderBy("summary ~ 'order by me'")).toEqual({ where: "summary ~ 'order by me'", orderBy: '' });
    expect(splitOrderBy("summary ~ 'a \\' order by' ORDER BY key")).toEqual({ where: "summary ~ 'a \\' order by'", orderBy: 'ORDER BY key' });
  });

  it('splits ORDER BY outside double quotes only', () => {
    expect(splitOrderBy('title ~ "Costs" ORDER BY lastmodified DESC')).toEqual({ where: 'title ~ "Costs"', orderBy: 'ORDER BY lastmodified DESC' });
    expect(splitOrderBy('ORDER BY created DESC')).toEqual({ where: '', orderBy: 'ORDER BY created DESC' });
    expect(splitOrderBy('summary ~ "order by me"')).toEqual({ where: 'summary ~ "order by me"', orderBy: '' });
    expect(splitOrderBy('summary ~ "a \\" order by" order by key')).toEqual({ where: 'summary ~ "a \\" order by"', orderBy: 'order by key' });
  });

  it('trims both parts and needs ORDER BY as whole words', () => {
    expect(splitOrderBy('  status = Done  ')).toEqual({ where: 'status = Done', orderBy: '' });
    expect(splitOrderBy('reorder by = 1')).toEqual({ where: 'reorder by = 1', orderBy: '' });
    expect(splitOrderBy('a = 1 order\n  by  b')).toEqual({ where: 'a = 1', orderBy: 'order\n  by  b' });
  });

  it('splits at the last ORDER BY outside quotes', () => {
    expect(splitOrderBy('title ~ "x" order by a order by b')).toEqual({ where: 'title ~ "x" order by a', orderBy: 'order by b' });
  });
});
