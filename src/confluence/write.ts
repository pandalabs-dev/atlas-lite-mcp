import { AtlasError } from '../core/errors.js';
import type { SiteRuntime } from '../core/runtime.js';
import { getPage, putPage, type PageData } from './api.js';
import { assertWellFormed } from './storage/edit.js';

export type PageTransform = (page: PageData) => { storage: string; note?: string };

export interface WriteResult {
  /** The page as fetched for the write that landed. */
  page: PageData;
  from: number;
  to: number;
  /** True when the transform left the body as it was; nothing was written and `to === from`. */
  unchanged: boolean;
  note?: string;
}

/**
 * The one Confluence write path (spec 6.1): fetch storage and version, apply a pure transform,
 * check well-formedness, PUT version + 1 with `atlas-lite-mcp <tool>`. On 409 it re-fetches once,
 * re-applies the transform and retries. A transform that leaves the body as it was writes nothing.
 */
export async function writePage(rt: SiteRuntime, pageId: string, tool: string, transform: PageTransform): Promise<WriteResult> {
  const message = `atlas-lite-mcp ${tool}`;

  const first = await getPage(rt, pageId);
  try {
    return await attempt(rt, first, transform(first), message);
  } catch (e) {
    if (!isConflict(e)) throw e;
  }

  const page = await getPage(rt, pageId);
  let change: ReturnType<PageTransform>;
  try {
    change = transform(page);
  } catch (e) {
    if (e instanceof AtlasError) throw new AtlasError(`Page "${page.title}" changed during the edit and the change no longer applies: ${e.message}`);
    throw e;
  }
  try {
    return await attempt(rt, page, change, message);
  } catch (e) {
    if (isConflict(e)) throw new AtlasError(`Page "${page.title}" is being edited by someone else; try again.`, { status: 409 });
    throw e;
  }
}

async function attempt(rt: SiteRuntime, page: PageData, change: ReturnType<PageTransform>, message: string): Promise<WriteResult> {
  let result: WriteResult;
  if (change.storage === page.storage) {
    result = { page, from: page.version, to: page.version, unchanged: true };
  } else {
    assertWellFormed(change.storage);
    const to = await putPage(rt, page, change.storage, message);
    result = { page, from: page.version, to, unchanged: false };
  }
  if (change.note !== undefined) result.note = change.note;
  return result;
}

function isConflict(e: unknown): boolean {
  return e instanceof AtlasError && e.status === 409;
}
