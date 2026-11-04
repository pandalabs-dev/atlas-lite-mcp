import { describe, expect, it } from 'vitest';
import { buildJql, isJql } from '../../src/jira/jql.js';

describe('buildJql', () => {
  it('turns plain text into a text search ordered by updated', () => {
    expect(buildJql('login fails on "Safari"')).toBe('text ~ "login fails on \\"Safari\\"" ORDER BY updated DESC');
    expect(isJql('login is broken')).toBe(false);
    expect(isJql('status = Done')).toBe(true);
  });

  it('prefixes the default project and keeps ORDER BY outside the parentheses', () => {
    expect(buildJql('status = Done ORDER BY created DESC', 'DEMO')).toBe('project = "DEMO" AND (status = Done) ORDER BY created DESC');
    expect(buildJql('ORDER BY created DESC', 'DEMO')).toBe('project = "DEMO" ORDER BY created DESC');
    expect(buildJql('broken login', 'DEMO')).toBe('project = "DEMO" AND (text ~ "broken login") ORDER BY updated DESC');
    expect(buildJql('project = QA AND status = Done', 'DEMO')).toBe('project = QA AND status = Done');
    expect(buildJql('summary ~ "order by me"', 'DEMO')).toBe('project = "DEMO" AND (summary ~ "order by me")');
  });

  it('passes JQL through unchanged without a default project', () => {
    expect(buildJql('status = Done ORDER BY created DESC')).toBe('status = Done ORDER BY created DESC');
    expect(isJql('assignee is EMPTY')).toBe(true);
  });
});
