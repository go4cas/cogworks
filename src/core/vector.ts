/**
 * Pure-JS vector similarity search.
 *
 * v1: scans the candidate set in-process and ranks by cosine similarity. Fine
 * for collections up to a few tens of thousands of rows on a single host;
 * larger fan-outs should adopt the `sqlite-vec` extension when we wire that
 * in. The query API is shaped so the implementation can be swapped without
 * breaking callers.
 *
 * Distance metric: cosine similarity (1 - cosine_distance). Returned scores
 * are in [-1, 1]; higher = more similar. Zero-norm vectors score 0 against
 * any other vector.
 */

export interface VectorSearchInput {
  /** The query vector. Length must match the candidate vectors' dimensions. */
  query: ArrayLike<number>;
  /**
   * Candidate rows to rank. Each carries the row's id + its vector. Caller
   * is responsible for fetching candidates (with whatever filter / auth scope
   * makes sense in context) before passing them in.
   */
  candidates: Array<{ id: string; vector: ArrayLike<number> }>;
  /** Top-K to return. Default 10, max 1000. */
  limit?: number;
  /**
   * Optional minimum similarity score; rows below this are dropped. Useful
   * for quality filtering when you'd rather return zero results than weak ones.
   */
  minScore?: number;
}

export interface VectorMatch {
  id: string;
  /** Cosine similarity in [-1, 1]; higher is more similar. */
  score: number;
}

/** Cosine similarity over any indexable numeric sequence (number[] or Float32Array). */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── parsed-vector cache ─────────────────────────────────────────────────────
// Vectors are stored as JSON text, so a naive scan re-parses every candidate on
// every query. This caches the parsed Float32Array per row, keyed
// "<collection>:<field>" → id → { h: content-hash, v }. An entry is reused only
// while the raw JSON is byte-identical, so any edit (even two within the same
// second — no `updated_at` seconds window) invalidates it. Hashing is O(len),
// far cheaper than the JSON.parse + array build it skips.
interface CachedVec {
  h: number;
  v: Float32Array;
}
const vecCache = new Map<string, Map<string, CachedVec>>();
let vecCacheCap = 100_000;

/** FNV-1a 32-bit — a fast content fingerprint (collision → at worst one stale reparse-miss). */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Bound cache entries per (collection:field). Excess evicts oldest-inserted. */
export function setVectorCacheCap(n: number): void {
  vecCacheCap = Math.max(0, n);
}

/** Drop cached vectors — a whole key ("col:field") or everything. */
export function clearVectorCache(key?: string): void {
  if (key) vecCache.delete(key);
  else vecCache.clear();
}

/**
 * Parse a stored JSON vector, reusing the cached Float32Array when the raw JSON
 * is unchanged. Returns null on a malformed / non-numeric value (the row is
 * skipped, mirroring the old per-row try/catch).
 */
export function parseVectorCached(key: string, id: string, rawJson: string): Float32Array | null {
  const h = hashStr(rawJson);
  let m = vecCache.get(key);
  if (!m) {
    m = new Map();
    vecCache.set(key, m);
  } else {
    const hit = m.get(id);
    if (hit && hit.h === h) return hit.v;
  }
  let arr: unknown;
  try {
    arr = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const v = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    v[i] = x;
  }
  // Evict oldest-inserted when at cap (Map preserves insertion order).
  if (vecCacheCap > 0 && m.size >= vecCacheCap && !m.has(id)) {
    const oldest = m.keys().next().value;
    if (oldest !== undefined) m.delete(oldest);
  }
  m.set(id, { h, v });
  return v;
}

export function topK(input: VectorSearchInput): VectorMatch[] {
  const limit = Math.max(1, Math.min(1000, input.limit ?? 10));
  const minScore = input.minScore;
  const out: VectorMatch[] = [];
  for (const c of input.candidates) {
    let score: number;
    try {
      score = cosineSimilarity(input.query, c.vector);
    } catch {
      continue; // dimension mismatch — silently skip the bad row
    }
    if (minScore !== undefined && score < minScore) continue;
    out.push({ id: c.id, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/**
 * Parse a JSON-encoded vector from the URL query (`?nearVector=[0.1,0.2,…]`).
 * Returns the parsed array or throws a `VectorParseError` with a caller-friendly
 * message — endpoints translate that into a 422 response.
 */
export class VectorParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorParseError";
  }
}

export function parseVectorParam(raw: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VectorParseError("nearVector must be a JSON-encoded number[]");
  }
  if (!Array.isArray(parsed)) {
    throw new VectorParseError("nearVector must be a JSON array");
  }
  const out: number[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const v = parsed[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new VectorParseError(`nearVector[${i}] must be a finite number`);
    }
    out.push(v);
  }
  return out;
}
