import { describe, expect, it } from 'vitest';
import { AtlasError } from '../../src/core/errors.js';
import { parseIssueRef, parsePageRef } from '../../src/core/url.js';

describe('parsePageRef', () => {
  it.each([
    ['https://x.atlassian.net/wiki/spaces/SD/pages/23560194/Title', '23560194'],
    ['https://x.atlassian.net/wiki/spaces/SD/pages/23560194', '23560194'],
    ['https://x.atlassian.net/wiki/pages/viewpage.action?pageId=23560194', '23560194'],
    ['https://x.atlassian.net/wiki/pages/edit-v2/23560194', '23560194'],
    ['https://x.atlassian.net/wiki/spaces/SD/pages/edit-v2/23560194?draftShareId=1', '23560194'],
    ['https://x.atlassian.net/wiki/spaces/~5b12/pages/42/Personal', '42'],
    ['23560194', '23560194'],
    ['  23560194 ', '23560194'],
  ])('page ref %s', (input, id) => {
    expect(parsePageRef(input).id).toBe(id);
  });

  it('returns the host for page URLs', () => {
    expect(parsePageRef('https://x.atlassian.net/wiki/pages/viewpage.action?pageId=1')).toEqual({ id: '1', host: 'x.atlassian.net' });
    expect(parsePageRef('https://X.Atlassian.net/wiki/spaces/SD/pages/7').host).toBe('x.atlassian.net');
  });

  it('returns no host for a bare id', () => {
    expect(parsePageRef('23560194')).toEqual({ id: '23560194' });
  });

  it('rejects tiny links with a pointer to the full URL', () => {
    expect(() => parsePageRef('https://x.atlassian.net/wiki/x/AbCd')).toThrow(/Tiny links are not supported; open the page and copy its full URL/);
  });

  it('rejects unrecognised page input', () => {
    expect(() => parsePageRef('hello')).toThrow(/Not a Confluence page URL or id: "hello"/);
  });

  it.each([
    'https://x.atlassian.net/wiki/spaces/SD/overview',
    'https://x.atlassian.net/wiki/pages/viewpage.action?pageId=abc',
    'https://x.atlassian.net/wiki/spaces/SD/pages/123abc',
    'ftp://x.atlassian.net/wiki/spaces/SD/pages/1',
    '',
  ])('rejects non-page input %s', (input) => {
    expect(() => parsePageRef(input)).toThrow(/Not a Confluence page URL or id/);
  });

  it('throws AtlasError', () => {
    expect(() => parsePageRef('hello')).toThrow(AtlasError);
  });
});

describe('parseIssueRef', () => {
  it.each([
    ['https://x.atlassian.net/browse/KEY-123', 'KEY-123'],
    ['https://x.atlassian.net/browse/key-123?focusedCommentId=5', 'KEY-123'],
    ['https://x.atlassian.net/jira/software/projects/GUM/boards/1?selectedIssue=GUM-7', 'GUM-7'],
    ['gum_2-15', 'GUM_2-15'],
    ['KEY-123', 'KEY-123'],
    [' KEY-123 ', 'KEY-123'],
  ])('issue ref %s', (input, key) => {
    expect(parseIssueRef(input).key).toBe(key);
  });

  it('returns the host for issue URLs and none for bare keys', () => {
    expect(parseIssueRef('https://x.atlassian.net/browse/KEY-123')).toEqual({ key: 'KEY-123', host: 'x.atlassian.net' });
    expect(parseIssueRef('KEY-123')).toEqual({ key: 'KEY-123' });
  });

  it('rejects keys that do not match [A-Z][A-Z0-9_]+-\\d+', () => {
    expect(() => parseIssueRef('1A-2')).toThrow(/Not a Jira issue URL or key/);
  });

  it.each([
    'K-1',
    'KEY-',
    'KEY-12a',
    'hello',
    'https://x.atlassian.net/browse/1A-2',
    'https://x.atlassian.net/jira/software/projects/GUM/boards/1',
  ])('rejects non-issue input %s', (input) => {
    expect(() => parseIssueRef(input)).toThrow(/Not a Jira issue URL or key/);
  });
});
