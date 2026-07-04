/**
 * Typed client-SDK generator (roadmap F-3).
 *
 *   GET /api/v1/sdk/types.ts  → a self-contained TypeScript module: one type
 *   per collection (record / create / update shapes), a `CogworksSchema`
 *   registry, and a thin typed fetch client.
 *
 * Like `core/openapi.ts` (F-2), this is derived from the DATA MODEL — each
 * collection's field defs → TS types — so it stays in sync with collections
 * automatically. Field-inclusion rules mirror `openapi.ts` exactly (system +
 * password fields are dropped from read types; system + autodate from write
 * types) so the two generated surfaces never disagree.
 *
 * ponytail: auth implicit fields (email/verified) follow F-2's behavior — only
 * what `parseFields(col.fields)` returns is emitted. If that ever needs the
 * implicit fields, fix it once in both generators.
 */
import type { Collection } from "../db/schema.ts";
import { parseFields, type FieldDef, type FieldType } from "./collections.ts";

/** PascalCase TS type name from a collection name (`blog_posts` → `BlogPosts`). */
function typeName(name: string): string {
  const pascal = name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");
  // Guard against a leading digit or empty result producing an invalid identifier.
  return /^[A-Za-z_]/.test(pascal) ? pascal : `Col_${pascal}`;
}

/** Object-key form: a bare identifier when valid, else a quoted string key. */
function propKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/** Map one field to its TypeScript type (read shape). */
function fieldToTs(field: FieldDef): string {
  const o = field.options ?? {};
  const arr = (t: string) => `${t}[]`;
  switch (field.type as FieldType) {
    case "text":
    case "editor":
    case "email":
    case "url":
    case "password":
      return "string";
    case "number":
      return "number";
    case "bool":
      return "boolean";
    case "date":
    case "autodate":
      return "number"; // unix seconds
    case "json":
      return "unknown";
    case "vector":
      return "number[]";
    case "geoPoint":
      return "{ lat: number; lon: number }";
    case "file":
      return o.multiple ? arr("string") : "string";
    case "relation":
      return o.multiple ? arr("string") : "string";
    case "select": {
      const values = Array.isArray(o.values) ? o.values : [];
      const base = values.length ? values.map((v) => JSON.stringify(v)).join(" | ") : "string";
      // Parenthesize a union before `[]` so `("a" | "b")[]` binds correctly.
      return o.multiple ? (values.length ? `(${base})[]` : "string[]") : base;
    }
    default:
      return "unknown";
  }
}

/** Read type: record meta + all non-system, non-password fields. */
function recordBody(fields: FieldDef[]): string {
  const lines = [
    "  id: string;",
    "  collectionId: string;",
    "  collectionName: string;",
    "  created: number;",
    "  updated: number;",
  ];
  for (const f of fields) {
    if (f.system || f.type === "password") continue;
    lines.push(`  ${propKey(f.name)}: ${fieldToTs(f)};`);
  }
  return lines.join("\n");
}

/** Write type: non-system, non-autodate fields. `optionalAll` forces `?` (update). */
function writeBody(fields: FieldDef[], optionalAll: boolean): string {
  const lines: string[] = [];
  for (const f of fields) {
    if (f.system || f.type === "autodate") continue;
    const optional = optionalAll || !f.required;
    lines.push(`  ${propKey(f.name)}${optional ? "?" : ""}: ${fieldToTs(f)};`);
  }
  return lines.length ? lines.join("\n") : "  // (no writable fields)";
}

export interface SdkOptions {
  serverUrl: string;
  version: string;
}

const PREAMBLE = (version: string) => `/**
 * Cogworks typed client — GENERATED from your collections. Do not edit by hand.
 * Re-fetch from GET /api/v1/sdk/types.ts whenever your schema changes.
 * Server version: ${version}
 */

export interface ListResult<T> {
  data: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  nextCursor?: string | null;
}

export interface ListQuery {
  page?: number;
  perPage?: number;
  filter?: string;
  sort?: string;
  expand?: string;
  fields?: string;
  skipTotal?: boolean;
  search?: string;
  cursor?: string;
}
`;

const CLIENT = (serverUrl: string) => `
export interface CogworksClientOptions {
  /** Base URL of the API, e.g. "${serverUrl}". Defaults to the generating server. */
  baseUrl?: string;
  /** Bearer token (admin JWT, user JWT, or a cwat_ API token). */
  token?: string;
  /** Custom fetch (e.g. for Node < 18 or tests). Defaults to global fetch. */
  fetch?: typeof fetch;
}

export class CogworksError extends Error {
  constructor(
    public status: number,
    public code: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "CogworksError";
  }
}

export class Cogworks {
  private baseUrl: string;
  private token?: string;
  private fetchImpl: typeof fetch;

  constructor(opts: CogworksClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? ${JSON.stringify(serverUrl)}).replace(/\\/$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /** Set/replace the bearer token used for subsequent requests. */
  setToken(token?: string): void {
    this.token = token;
  }

  private async req<T>(method: string, path: string, body?: unknown, query?: Record<string, unknown>): Promise<T> {
    let url = this.baseUrl + path;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += "?" + s;
    }
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = "Bearer " + this.token;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      throw new CogworksError(res.status, json?.code, json?.error ?? json?.message ?? res.statusText);
    }
    return json as T;
  }

  /** Typed handle for one collection's record CRUD. */
  collection<K extends keyof CogworksSchema>(name: K) {
    const base = "/api/v1/" + String(name);
    return {
      list: (query?: ListQuery) =>
        this.req<ListResult<CogworksSchema[K]["record"]>>("GET", base, undefined, query as Record<string, unknown>),
      getOne: (id: string, query?: Pick<ListQuery, "expand" | "fields">) =>
        this.req<{ data: CogworksSchema[K]["record"] }>("GET", base + "/" + encodeURIComponent(id), undefined, query as Record<string, unknown>),
      create: (data: CogworksSchema[K]["create"]) =>
        this.req<{ data: CogworksSchema[K]["record"] }>("POST", base, data),
      update: (id: string, data: CogworksSchema[K]["update"]) =>
        this.req<{ data: CogworksSchema[K]["record"] }>("PATCH", base + "/" + encodeURIComponent(id), data),
      delete: (id: string) =>
        this.req<void>("DELETE", base + "/" + encodeURIComponent(id)),
    };
  }
}
`;

/** Assemble the full generated TypeScript module from the collection set. */
export function buildSdkTypes(collections: Collection[], opts: SdkOptions): string {
  const blocks: string[] = [PREAMBLE(opts.version)];
  const registry: string[] = ["export interface CogworksSchema {"];

  for (const col of collections) {
    const fields = parseFields(col.fields);
    const T = typeName(col.name);
    const isView = col.type === "view";

    blocks.push(`export interface ${T} {\n${recordBody(fields)}\n}`);
    if (!isView) {
      blocks.push(`export interface ${T}Create {\n${writeBody(fields, false)}\n}`);
      blocks.push(`export interface ${T}Update {\n${writeBody(fields, true)}\n}`);
      registry.push(
        `  ${propKey(col.name)}: { record: ${T}; create: ${T}Create; update: ${T}Update };`,
      );
    } else {
      // Views are read-only: create/update alias `never`.
      registry.push(`  ${propKey(col.name)}: { record: ${T}; create: never; update: never };`);
    }
  }

  registry.push("}");
  blocks.push(registry.join("\n"));
  blocks.push(CLIENT(opts.serverUrl));
  return blocks.join("\n\n") + "\n";
}
