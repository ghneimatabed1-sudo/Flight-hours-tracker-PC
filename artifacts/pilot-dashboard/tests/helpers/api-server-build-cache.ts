// Cache the compiled api-server bundle across multi-PC test reruns so a
// developer iterating only pays the ~30-45s esbuild cost when something
// in `artifacts/api-server` actually changed.
//
// Cache key = sha256 of every `src/**/*.ts` file plus `package.json` and
// `build.mjs` for the api-server. Cache layout mirrors a finished build
// directory at `<cacheRoot>/<sha>/` (index.mjs + pino worker shims +
// .map files), so we can point the spawned api-server child straight at
// it without copying anything back into `artifacts/api-server/dist`.
//
// Workspace dep changes (e.g. `lib/api-zod`) do *not* invalidate the
// cache by design — the task scope is api-server source only. Manual
// cache nuke: `rm -rf node_modules/.cache/multi-pc-test-build`.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, relative } from "node:path";

export type EnsureBuiltOpts = {
  /** Absolute path to `artifacts/api-server`. */
  apiServerDir: string;
  /** Where cached bundles live, e.g. `node_modules/.cache/multi-pc-test-build`. */
  cacheRoot: string;
  /** Absolute path to the api-server's `dist` output dir (build target). */
  destDist: string;
  /**
   * Synchronous build hook. Called only on cache miss. Must populate
   * `destDist` with `index.mjs` (+ pino shims) and throw on failure.
   */
  build: () => void;
};

export type EnsureBuiltResult = {
  /** Directory containing `index.mjs` to spawn the api-server from. */
  distDir: string;
  /** True if the cached bundle was reused. */
  cacheHit: boolean;
  /** sha256 cache key the lookup resolved to. */
  cacheKey: string;
};

function listSourceFiles(srcDir: string): string[] {
  const out: string[] = [];
  const stack = [srcDir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let ents;
    try {
      ents = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const p = join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile() && p.endsWith(".ts")) {
        out.push(p);
      }
    }
  }
  return out.sort();
}

/**
 * Deterministic sha256 over api-server build inputs. Exposed for the
 * cache-invalidation smoke test in
 * `tests/api-server-build-cache.test.ts`.
 */
export function computeApiServerCacheKey(apiServerDir: string): string {
  const srcDir = join(apiServerDir, "src");
  const files: string[] = listSourceFiles(srcDir);
  for (const extra of ["package.json", "build.mjs"]) {
    const p = join(apiServerDir, extra);
    if (existsSync(p)) files.push(p);
  }
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(relative(apiServerDir, f));
    hash.update("\0");
    hash.update(readFileSync(f));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function copyDirSync(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name);
    const d = join(dst, e.name);
    if (e.isDirectory()) copyDirSync(s, d);
    else if (e.isFile()) copyFileSync(s, d);
  }
}

/**
 * Look up the cached bundle for the current api-server source state. On
 * cache miss, run `opts.build()` and atomically promote its output into
 * `<cacheRoot>/<sha>/`. Returns the dist dir to spawn from.
 */
export function ensureApiServerBuiltCached(
  opts: EnsureBuiltOpts,
): EnsureBuiltResult {
  const cacheKey = computeApiServerCacheKey(opts.apiServerDir);
  const cachedDir = join(opts.cacheRoot, cacheKey);
  const cachedEntry = join(cachedDir, "index.mjs");
  if (existsSync(cachedEntry)) {
    return { distDir: cachedDir, cacheHit: true, cacheKey };
  }

  opts.build();
  if (!existsSync(join(opts.destDist, "index.mjs"))) {
    throw new Error(
      "api-server build did not produce dist/index.mjs — refusing to cache",
    );
  }

  // Atomic promote: copy to a sibling tmp dir, then rename onto the
  // cache slot. Two concurrent test runs racing the same key both end
  // up with a valid bundle either way; rename is atomic on the same fs.
  mkdirSync(opts.cacheRoot, { recursive: true });
  const tmp = `${cachedDir}.tmp-${process.pid}-${Date.now()}`;
  rmSync(tmp, { recursive: true, force: true });
  copyDirSync(opts.destDist, tmp);
  rmSync(cachedDir, { recursive: true, force: true });
  renameSync(tmp, cachedDir);
  return { distDir: cachedDir, cacheHit: false, cacheKey };
}
