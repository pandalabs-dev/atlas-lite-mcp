import { describe, expect, it } from 'vitest';
import { buildJql, isJql } from '../../src/jira/jql.js';

describe('buildJql', () => {
  it('turns plain text into a text search ordered by updated', () => {
    expect(buildJql('login fails on "Safari"')).toBe('text ~ "login fails on \\"Safari\\"" ORDER BY updated DESC');
    expect(isJql('login is broken')).toBe(false);
    expect(isJql('status = Done')).toBe(true);
  });

  it('prefixes the default project and keeps ORDER BY outside the parentheses', () => {
    expect(buildJql('status = Done ORDER BY created DESC', 'GUM')).toBe('project = "GUM" AND (status = Done) ORDER BY created DESC');
    expect(buildJql('ORDER BY created DESC', 'GUM')).toBe('project = "GUM" ORDER BY created DESC');
    expect(buildJql('broken login', 'GUM')).toBe('project = "GUM" AND (text ~ "broken login") ORDER BY updated DESC');
    expect(buildJql('project = QA AND status = Done', 'GUM')).toBe('project = QA AND status = Done');
    expect(buildJql('summary ~ "order by me"', 'GUM')).toBe('project = "GUM" AND (summary ~ "order by me")');
  });

  it('passes JQL through unchanged without a default project', () => {
    expect(buildJql('status = Done ORDER BY created DESC')).toBe('status = Done ORDER BY created DESC');
    expect(isJql('assignee is EMPTY')).toBe(true);
  });
});
