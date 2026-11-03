import { plural } from './format.js';

/** Content the markdown view cannot express, shown as `{{atlas:N}} [hint]` and restored on write. */
export interface Placeholder<T = unknown> {
  /** 1-based counter over the whole body. */
  n: number;
  /** Short human hint shown after the token; never contains `[`, `]`, newlines or URLs. */
  hint: string;
  /** The original content (storage markup, ADF node, ...). */
  original: T;
  /** True when the original stands on its own as a block rather than inside a paragraph. */
  block: boolean;
}

/** A token plus its optional hint; group 1 is N. */
export const TOKEN_RE = /\{\{atlas:(\d+)\}\}(?: \[[^\]\n]*\])?/g;

/** `{{atlas:3}} [macro: toc]` */
export function tokenText(p: Placeholder): string {
  return `{{atlas:${p.n}}} [${p.hint}]`;
}

/** `Dropped: 2 items: [macro: toc], {{atlas:9}} [unknown token]`, or null when nothing was dropped. */
export function formatDropped(dropped: Placeholder[], unknown: number[]): string | null {
  const items = [...dropped.map((p) => `[${p.hint}]`), ...unknown.map((n) => `{{atlas:${n}}} [unknown token]`)];
  if (items.length === 0) return null;
  return `Dropped: ${plural(items.length, 'item')}: ${items.join(', ')}`;
}

/**
 * In-memory token maps keyed by a caller-built key such as `confluence:page:<site>:<id>`.
 * A map is rebuilt when the stored version differs; the least recently used key is evicted beyond the limit.
 */
export class PlaceholderStore<T extends Placeholder> {
  private readonly entries = new Map<string, { version: string; map: Map<number, T> }>();

  constructor(private readonly maxEntries = 100) {}

  getOrBuild(key: string, version: string, build: () => T[]): Map<number, T> {
    const hit = this.entries.get(key);
    this.entries.delete(key);
    const entry = hit && hit.version === version ? hit : { version, map: new Map(build().map((p) => [p.n, p] as const)) };
    this.entries.set(key, entry);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(oldest);
    }
    return entry.map;
  }
}
