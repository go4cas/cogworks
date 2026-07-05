/**
 * Static-site serving — opt-in via `COGWORKS_PUBLIC_DIR`. When set, GET/HEAD
 * requests that match no API, admin, auth, or custom route fall through to a
 * file served from that directory (wired as the app's `notFound` handler in
 * server.ts). Disabled by default: no public dir, no static serving.
 *
 * Resolution for `/foo`:
 *   1. exact file            `public/foo`
 *   2. extensionless → .html `public/foo.html`
 *   3. directory index       `public/foo/index.html`
 * A trailing-slash or root path goes straight to the directory index. With SPA
 * mode (`COGWORKS_PUBLIC_SPA`), an unmatched extensionless path serves the root
 * `index.html` so client-side routers can take over.
 */
import { existsSync, statSync } from "node:fs";
import { join, resolve, sep, extname } from "node:path";

let publicRoot = "";
let spaFallback = false;

/** Configure the static root. Empty `dir` disables serving. Called once at boot. */
export function setPublicDir(dir: string, spa = false): void {
  publicRoot = dir ? resolve(dir) : "";
  spaFallback = spa;
}

export function publicServingEnabled(): boolean {
  return publicRoot !== "" && existsSync(publicRoot);
}

/** Resolve a URL path to an absolute path inside the root, or null if it escapes. */
function resolveInRoot(pathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  // Leading "." keeps `join` relative even for an absolute-looking `rel`.
  const full = resolve(join(publicRoot, `.${rel.startsWith("/") ? rel : `/${rel}`}`));
  if (full !== publicRoot && !full.startsWith(publicRoot + sep)) return null;
  return full;
}

function fileIfExists(p: string): string | null {
  try {
    if (existsSync(p) && statSync(p).isFile()) return p;
  } catch {
    /* stat failed */
  }
  return null;
}

/**
 * Serve a static file for `pathname` from the public root. Returns a `Response`
 * or `null` (→ let the caller emit its normal 404). HTML is sent `no-cache`;
 * other assets get a short `max-age`. Content-type is inferred by `Bun.file`.
 */
export function servePublicFile(pathname: string): Response | null {
  if (!publicServingEnabled()) return null;
  const base = resolveInRoot(pathname);
  if (base === null) return null;

  let target: string | null;
  if (pathname === "" || pathname.endsWith("/")) {
    target = fileIfExists(join(base, "index.html"));
  } else {
    target =
      fileIfExists(base) ?? fileIfExists(`${base}.html`) ?? fileIfExists(join(base, "index.html"));
  }

  // SPA fallback: an unmatched, extensionless path serves the root index.
  if (!target && spaFallback && !extname(pathname)) {
    target = fileIfExists(join(publicRoot, "index.html"));
  }

  if (!target) return null;
  const res = new Response(Bun.file(target));
  res.headers.set("cache-control", target.endsWith(".html") ? "no-cache" : "public, max-age=3600");
  return res;
}
