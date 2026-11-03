import { AtlasError } from '../core/errors.js';
import type { SiteRuntime } from '../core/runtime.js';
import { markdownToAdf } from './adf/fromMarkdown.js';
import { adfToMarkdown, type AdfDoc } from './adf/toMarkdown.js';
import { findUser } from './users.js';

const NAME_KEYS = ['displayName', 'name', 'value', 'key'];
/** A token inside a field value cannot be restored on write, so only its hint is shown. */
const BARE_TOKEN = /\{\{atlas:\d+\}\} /g;

/** A plain-text view of a Jira field value; missing values are `-`. */
export function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length === 0 ? '-' : v.map(displayValue).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.type === 'doc') return adfToMarkdown(o as AdfDoc).markdown.replace(BARE_TOKEN, '') || '-';
    for (const key of NAME_KEYS) {
      const name = o[key];
      if (typeof name === 'string' || typeof name === 'number') return String(name);
    }
    return JSON.stringify(v);
  }
  return String(v);
}

/** One field of the create or edit screen, normalized from Jira's metadata. */
export interface FieldMeta {
  id: string;
  name: string;
  required: boolean;
  hasDefaultValue: boolean;
  schema: { type: string; items?: string; system?: string; custom?: string };
  allowedValues?: { id: string; name?: string; value?: string }[];
}

const MAX_ALLOWED = 10;
const SPRINT = 'com.pyxis.greenhopper.jira:gh-sprint';
/** Set by `issue_create` itself, so never reported as missing. */
const ALWAYS_SUPPLIED = new Set(['project', 'issuetype', 'summary']);

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

/** The string-valued entries of `obj` among `keys`, so absent keys stay absent. */
function strings<K extends string>(obj: Record<string, unknown>, keys: K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of keys) {
    const v = str(obj[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function toFieldMeta(id: string, raw: Record<string, unknown>): FieldMeta {
  const schema = (raw.schema ?? {}) as Record<string, unknown>;
  const meta: FieldMeta = {
    id,
    name: str(raw.name) ?? id,
    required: raw.required === true,
    hasDefaultValue: raw.hasDefaultValue === true,
    schema: { type: str(schema.type) ?? 'any', ...strings(schema, ['items', 'system', 'custom']) },
  };
  if (Array.isArray(raw.allowedValues)) {
    meta.allowedValues = (raw.allowedValues as Record<string, unknown>[]).map((a) => ({ id: str(a.id) ?? '', ...strings(a, ['name', 'value']) }));
  }
  return meta;
}

/** One page of `createmeta/{project}/issuetypes/{id}`; the list sits under `fields` or `results`. */
export function normalizeCreateMeta(json: unknown): FieldMeta[] {
  const page = (json ?? {}) as Record<string, unknown>;
  const list = page.fields ?? page.results;
  if (!Array.isArray(list)) return [];
  return (list as Record<string, unknown>[]).map((raw) => toFieldMeta(str(raw.fieldId) ?? str(raw.key) ?? '', raw));
}

/** `issue/{key}/editmeta`: an object keyed by field id. */
export function normalizeEditMeta(json: unknown): FieldMeta[] {
  const fields = ((json ?? {}) as Record<string, unknown>).fields;
  if (fields === null || typeof fields !== 'object') return [];
  return Object.entries(fields as Record<string, Record<string, unknown>>).map(([id, raw]) => toFieldMeta(id, raw));
}

function allowedLabel(a: { id: string; name?: string; value?: string }): string {
  return a.name ?? a.value ?? a.id;
}

/** Up to 10 allowed values joined by commas, then `(and N more)`. */
function allowedList(field: FieldMeta): string {
  const labels = (field.allowedValues ?? []).map(allowedLabel);
  const shown = labels.slice(0, MAX_ALLOWED).join(', ');
  return labels.length > MAX_ALLOWED ? `${shown} (and ${labels.length - MAX_ALLOWED} more)` : shown;
}

function allowedId(field: FieldMeta, v: unknown): { id: string } {
  const raw = String(v).trim();
  const wanted = raw.toLowerCase();
  const allowed = field.allowedValues ?? [];
  const hit = allowed.find((a) => allowedLabel(a).toLowerCase() === wanted) ?? allowed.find((a) => a.id === raw);
  if (hit === undefined) throw new AtlasError(`${field.name} has no value "${raw}". Allowed: ${allowedList(field)}.`);
  return { id: hit.id };
}

function isRichText(field: FieldMeta): boolean {
  const { system, custom } = field.schema;
  return system === 'description' || system === 'environment' || (custom?.includes('textarea') ?? false);
}

/** A plain value in the API shape for this field (value rules of spec 6.5). */
async function shapeValue(rt: SiteRuntime, field: FieldMeta, v: unknown): Promise<unknown> {
  const { type, items, system, custom } = field.schema;
  const list = Array.isArray(v) ? v : [v];
  if (custom === SPRINT) {
    const raw = String(v).trim();
    if (!/^\d+$/.test(raw)) throw new AtlasError(`${field.name} needs the numeric sprint id.`);
    return Number(raw);
  }
  if (system === 'parent') return { key: String(v).trim() };
  if (isRichText(field)) return markdownToAdf(String(v)).doc;
  if (type === 'array') {
    if (items === 'string') return list.map(String);
    if (items === 'user') return Promise.all(list.map(async (u) => ({ accountId: (await findUser(rt, String(u))).accountId })));
    if (field.allowedValues !== undefined) return list.map((x) => allowedId(field, x));
    return v;
  }
  if (field.allowedValues !== undefined) return allowedId(field, v);
  if (type === 'number') {
    const n = typeof v === 'number' ? v : String(v).trim() === '' ? NaN : Number(String(v).trim());
    if (Number.isNaN(n)) throw new AtlasError(`${field.name} needs a number.`);
    return n;
  }
  if (type === 'date' || type === 'datetime') return String(v);
  if (type === 'user') return { accountId: (await findUser(rt, String(v))).accountId };
  return v;
}

/**
 * Maps `fields` keys (ids or display names, case-insensitive) to field ids and plain values to the API
 * shape; `label` names the screen in errors, e.g. `GUM Bug`. `names` are the matched display names.
 * `rt` is only handed to `findUser` for user values.
 */
export async function resolveFields(
  rt: SiteRuntime,
  meta: FieldMeta[],
  input: Record<string, unknown>,
  label: string,
): Promise<{ fields: Record<string, unknown>; names: string[] }> {
  const fields: Record<string, unknown> = {};
  const names: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const wanted = key.trim().toLowerCase();
    const field = meta.find((f) => f.id.toLowerCase() === wanted) ?? meta.find((f) => f.name.toLowerCase() === wanted);
    if (field === undefined) throw new AtlasError(`Field "${key.trim()}" is not available for ${label}.`);
    fields[field.id] = await shapeValue(rt, field, value);
    names.push(field.name);
  }
  return { fields, names };
}

/** Required fields not in `supplied`; project, issue type, summary and fields with a default are skipped. */
export function missingRequired(meta: FieldMeta[], supplied: Set<string>): FieldMeta[] {
  return meta.filter((f) => f.required && !f.hasDefaultValue && !ALWAYS_SUPPLIED.has(f.id) && !supplied.has(f.id));
}

/** The `Not created:` answer listing each missing field with up to 10 allowed values. */
export function formatMissing(label: string, missing: FieldMeta[]): string {
  const lines = missing.map((f) => (f.allowedValues && f.allowedValues.length > 0 ? `- ${f.name}: ${allowedList(f)}` : `- ${f.name}`));
  return [`Not created: ${label} needs these fields:`, ...lines].join('\n');
}
