// Smoke test for the api-server build cache that backs the multi-PC
// real-process test. Spec: when an api-server source file changes the
// cache key changes (cache miss → real build runs); when nothing
// changes the cache key is stable (cache hit → build is skipped).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeApiServerCacheKey,
  ensureApiServerBuiltCached,
} from "./helpers/api-server-build-cache";

type Fixture = {
  root: string;
  apiServerDir: string;
  cacheRoot: string;
  destDist: string;
  cleanup: () => void;
};

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "build-cache-test-"));
  const apiServerDir = join(root, "api-server");
  const cacheRoot = join(root, ".cache");
  const destDist = join(apiServerDir, "dist");
  mkdirSync(join(apiServerDir, "src", "lib"), { recursive: true });
  writeFileSync(
    join(apiServerDir, "package.json"),
    JSON.stringify({ name: "fake", version: "0.0.0" }),
  );
  writeFileSync(join(apiServerDir, "build.mjs"), "// fake build script\n");
  writeFileSync(join(apiServerDir, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(
    join(apiServerDir, "src", "lib", "util.ts"),
    "export const y = 2;\n",
  );
  return {
    root,
    apiServerDir,
    cacheRoot,
    destDist,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function fakeBuild(destDist: string): () => void {
  return () => {
    mkdirSync(destDist, { recursive: true });
    writeFileSync(join(destDist, "index.mjs"), "// built bundle\n");
    writeFileSync(
      join(destDist, "pino-worker.mjs"),
      "// pino worker shim\n",
    );
  };
}

test("computeApiServerCacheKey is deterministic across calls", () => {
  const f = makeFixture();
  try {
    const a = computeApiServerCacheKey(f.apiServerDir);
    const b = computeApiServerCacheKey(f.apiServerDir);
    assert.equal(a, b, "key must be stable when nothing changes");
    assert.match(a, /^[0-9a-f]{64}$/);
  } finally {
    f.cleanup();
  }
});

test("computeApiServerCacheKey changes when a src/**/*.ts file changes", () => {
  const f = makeFixture();
  try {
    const before = computeApiServerCacheKey(f.apiServerDir);
    writeFileSync(
      join(f.apiServerDir, "src", "lib", "util.ts"),
      "export const y = 999;\n",
    );
    const after = computeApiServerCacheKey(f.apiServerDir);
    assert.notEqual(before, after, "touching a src .ts must invalidate");
  } finally {
    f.cleanup();
  }
});

test("computeApiServerCacheKey changes when package.json changes", () => {
  const f = makeFixture();
  try {
    const before = computeApiServerCacheKey(f.apiServerDir);
    writeFileSync(
      join(f.apiServerDir, "package.json"),
      JSON.stringify({ name: "fake", version: "0.0.1" }),
    );
    const after = computeApiServerCacheKey(f.apiServerDir);
    assert.notEqual(before, after, "package.json change must invalidate");
  } finally {
    f.cleanup();
  }
});

test("ensureApiServerBuiltCached: cold → build runs; warm → build skipped", () => {
  const f = makeFixture();
  try {
    let buildCalls = 0;
    const build = (): void => {
      buildCalls++;
      fakeBuild(f.destDist)();
    };

    const first = ensureApiServerBuiltCached({
      apiServerDir: f.apiServerDir,
      cacheRoot: f.cacheRoot,
      destDist: f.destDist,
      build,
    });
    assert.equal(buildCalls, 1, "cold cache must build once");
    assert.equal(first.cacheHit, false);
    assert.ok(
      existsSync(join(first.distDir, "index.mjs")),
      "cached dist must contain index.mjs",
    );
    assert.ok(
      existsSync(join(first.distDir, "pino-worker.mjs")),
      "auxiliary bundle files must be cached too",
    );

    const second = ensureApiServerBuiltCached({
      apiServerDir: f.apiServerDir,
      cacheRoot: f.cacheRoot,
      destDist: f.destDist,
      build,
    });
    assert.equal(buildCalls, 1, "warm cache must skip the build");
    assert.equal(second.cacheHit, true);
    assert.equal(second.distDir, first.distDir, "same key → same dir");
  } finally {
    f.cleanup();
  }
});

test("ensureApiServerBuiltCached: source change invalidates and rebuilds", () => {
  const f = makeFixture();
  try {
    let buildCalls = 0;
    const build = (): void => {
      buildCalls++;
      fakeBuild(f.destDist)();
    };

    const first = ensureApiServerBuiltCached({
      apiServerDir: f.apiServerDir,
      cacheRoot: f.cacheRoot,
      destDist: f.destDist,
      build,
    });
    assert.equal(buildCalls, 1);

    // No-op rerun: still 1.
    ensureApiServerBuiltCached({
      apiServerDir: f.apiServerDir,
      cacheRoot: f.cacheRoot,
      destDist: f.destDist,
      build,
    });
    assert.equal(buildCalls, 1, "second run with no changes hits cache");

    // Touch a source file → next call must rebuild.
    writeFileSync(
      join(f.apiServerDir, "src", "lib", "util.ts"),
      "export const y = 42;\n",
    );
    const after = ensureApiServerBuiltCached({
      apiServerDir: f.apiServerDir,
      cacheRoot: f.cacheRoot,
      destDist: f.destDist,
      build,
    });
    assert.equal(buildCalls, 2, "source change must trigger rebuild");
    assert.equal(after.cacheHit, false);
    assert.notEqual(after.distDir, first.distDir, "new key → new dir");

    // And then another no-op rerun hits the new cache slot.
    ensureApiServerBuiltCached({
      apiServerDir: f.apiServerDir,
      cacheRoot: f.cacheRoot,
      destDist: f.destDist,
      build,
    });
    assert.equal(buildCalls, 2, "rebuild result is itself cached");
  } finally {
    f.cleanup();
  }
});
