import type { Site } from './config.js';
import { AtlasError } from './errors.js';

/** The answer to every call while no site is configured. */
export const NO_SITES = 'No Atlassian sites are configured. Run "npx atlas-lite-mcp init" or set ATLASSIAN_URL, ATLASSIAN_EMAIL and ATLASSIAN_TOKEN.';

export interface SiteRequest {
  /** Explicit site, by name or hostname. */
  site?: string;
  /** Host of a URL argument; it selects the site. */
  host?: string;
}

/**
 * Picks the site for a call: the URL host wins, then an explicit site by name or hostname,
 * then the only configured site. Throws for unavailable sites too.
 */
export function resolveSite(sites: Site[], req: SiteRequest): Site {
  if (sites.length === 0) {
    throw new AtlasError(NO_SITES);
  }
  const names = sites.map((s) => s.name).join(', ');

  let chosen: Site | undefined;
  if (req.host !== undefined) {
    const host = req.host.toLowerCase();
    chosen = sites.find((s) => s.host.toLowerCase() === host);
    if (chosen === undefined) throw new AtlasError(`No configured site for ${host}; configured: ${names}.`);
    if (req.site !== undefined && findSite(sites, req.site) !== chosen) {
      throw new AtlasError(`URL belongs to ${host} but site "${req.site}" was given; omit site or pass ${chosen.name}.`);
    }
  } else if (req.site !== undefined) {
    chosen = findSite(sites, req.site);
    if (chosen === undefined) throw new AtlasError(`No configured site named "${req.site}"; pass site as one of: ${names}.`);
  } else if (sites.length === 1) {
    chosen = sites[0];
  }
  if (chosen === undefined) throw new AtlasError(`Several sites are configured; pass site as one of: ${names}.`);

  if (chosen.unavailable !== undefined) {
    throw new AtlasError(`Site ${chosen.name} is unavailable: ${chosen.unavailable}.`);
  }
  return chosen;
}

/** Name match wins over host match, so a name that equals another site's host resolves to the named site. */
function findSite(sites: Site[], ref: string): Site | undefined {
  const wanted = ref.trim().toLowerCase();
  return sites.find((s) => s.name.toLowerCase() === wanted) ?? sites.find((s) => s.host.toLowerCase() === wanted);
}
