export interface Call {
  method: string;
  url: string;
  /** Request headers with lower-cased names. */
  headers: Record<string, string>;
  /** Parsed JSON request body, undefined when none. Typed any so tests read properties directly. */
  body: any;
}

export interface Reply {
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
}

export interface Route extends Reply {
  method: string;
  /** String: exact URL pathname. RegExp: tested against pathname plus search. */
  path: string | RegExp;
  /** How many times the route answers before it is used up; unlimited when absent. */
  times?: number;
  reply?: (call: Call) => Reply;
}

/** A fake fetch that answers from routes in order and records every call. Unmatched calls throw. */
export function mockFetch(routes: Route[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const left = routes.map((r) => r.times);

  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    const raw = init?.body;
    const call: Call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url: url.toString(),
      headers,
      body: typeof raw === 'string' ? JSON.parse(raw) : undefined,
    };
    calls.push(call);

    const index = routes.findIndex((r, i) => {
      if (r.method.toUpperCase() !== call.method) return false;
      const remaining = left[i];
      if (remaining !== undefined && remaining <= 0) return false;
      return typeof r.path === 'string' ? r.path === url.pathname : r.path.test(url.pathname + url.search);
    });
    const route = routes[index];
    if (route === undefined) throw new Error(`mockFetch: no route for ${call.method} ${call.url}`);
    const remaining = left[index];
    if (remaining !== undefined) left[index] = remaining - 1;

    const reply = route.reply ? route.reply(call) : route;
    const responseHeaders: Record<string, string> = { ...reply.headers };
    if (reply.json !== undefined) responseHeaders['content-type'] ??= 'application/json';
    return new Response(reply.json === undefined ? null : JSON.stringify(reply.json), {
      status: reply.status ?? 200,
      headers: responseHeaders,
    });
  };

  return { fetch: fake as typeof fetch, calls };
}
