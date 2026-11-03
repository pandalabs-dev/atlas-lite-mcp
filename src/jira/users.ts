import { AtlasError } from '../core/errors.js';
import type { SiteRuntime } from '../core/runtime.js';

interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active?: boolean;
}

const MAX_CANDIDATES = 5;

function candidates(users: JiraUser[]): string {
  const shown = users.slice(0, MAX_CANDIDATES).map((u) => (u.emailAddress ? `${u.displayName} (${u.emailAddress})` : u.displayName));
  const more = users.length - MAX_CANDIDATES;
  return more > 0 ? `${shown.join(', ')} (and ${more} more)` : shown.join(', ');
}

/**
 * Resolves a display name or email to one active user: an exact case-insensitive match on either wins,
 * else a single search result; several candidates fail with the list (spec 6.5).
 */
export async function findUser(rt: SiteRuntime, query: string): Promise<{ accountId: string; displayName: string }> {
  const wanted = query.trim();
  const found = await rt.http.request<JiraUser[]>('jira', 'GET', '/rest/api/3/user/search', { query: { query: wanted } });
  const active = (Array.isArray(found) ? found : []).filter((u) => u.active !== false);
  const lower = wanted.toLowerCase();
  const exact = active.filter((u) => u.displayName.toLowerCase() === lower || u.emailAddress?.toLowerCase() === lower);
  const pool = exact.length > 0 ? exact : active;
  const user = pool[0];
  if (user === undefined) throw new AtlasError(`No Jira user matches "${wanted}".`);
  if (pool.length > 1) throw new AtlasError(`"${wanted}" matches ${pool.length} users: ${candidates(pool)}. Use an email.`);
  return { accountId: user.accountId, displayName: user.displayName };
}
