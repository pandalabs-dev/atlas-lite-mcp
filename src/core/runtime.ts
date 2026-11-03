import type { LoadedConfig, Site } from './config.js';
import { AtlasError } from './errors.js';
import { createHttpClient, type HttpClient, type HttpDeps } from './http.js';
import { PlaceholderStore, type Placeholder } from './placeholders.js';
import { resolveSite, type SiteRequest } from './sites.js';

/** Everything a tool needs for one site. `cache` keys use the form `product:kind:site:...`. */
export interface SiteRuntime {
  site: Site;
  http: HttpClient;
  cache: Map<string, unknown>;
}

export interface Runtime {
  /** Picks the site for a call (spec 6.3); throws the config error when the config could not be loaded. */
  resolve(req: SiteRequest): SiteRuntime;
  sites(): Site[];
  /** One placeholder store per product name, so core never depends on product types. */
  placeholders: { get<T extends Placeholder>(product: string): PlaceholderStore<T> };
  configError?: string;
}

export function createRuntime(cfg: LoadedConfig | { error: string }, deps: HttpDeps = {}): Runtime {
  const configError = 'error' in cfg ? cfg.error : undefined;
  const sites = 'error' in cfg ? [] : cfg.sites;
  const siteRuntimes = new Map<Site, SiteRuntime>();
  const stores = new Map<string, PlaceholderStore<Placeholder>>();

  const rt: Runtime = {
    resolve(req) {
      if (configError !== undefined) throw new AtlasError(configError);
      const site = resolveSite(sites, req);
      let srt = siteRuntimes.get(site);
      if (srt === undefined) {
        srt = { site, http: createHttpClient(site, deps), cache: new Map() };
        siteRuntimes.set(site, srt);
      }
      return srt;
    },
    sites: () => sites,
    placeholders: {
      get<T extends Placeholder>(product: string): PlaceholderStore<T> {
        let store = stores.get(product);
        if (store === undefined) {
          store = new PlaceholderStore<Placeholder>();
          stores.set(product, store);
        }
        return store as unknown as PlaceholderStore<T>;
      },
    },
  };
  if (configError !== undefined) rt.configError = configError;
  return rt;
}
