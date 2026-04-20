import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import crypto from "crypto";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// CSP plugin: in DEV, removes the meta tag entirely so Vite's HMR client
// (which injects inline scripts) keeps working in the iframe preview.
// In PROD build, hashes every inline <script> body in the emitted HTML
// and rewrites the meta tag's script-src directive with the actual hashes
// so the browser executes them. Without this the production app loads
// to a blank screen because the bundle's bootstrap inline scripts get
// blocked. Inline event handlers (onload="...") cannot be hashed —
// remove them or move them into the bundle.
function cspPlugin(): Plugin {
  return {
    name: "rjaf-csp",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const isDev = process.env.NODE_ENV !== "production";
        if (isDev) {
          // Strip the entire CSP meta tag so HMR/Replit overlays work.
          return html.replace(
            /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/i,
            "",
          );
        }
        // PROD: collect every inline <script> body, hash it, and inject
        // the list of hashes into script-src.
        const hashes: string[] = [];
        const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) {
          const body = m[1];
          if (!body.trim()) continue;
          const h = crypto.createHash("sha256").update(body, "utf8").digest("base64");
          hashes.push(`'sha256-${h}'`);
        }
        const tokens = ["'self'", ...hashes].join(" ");
        return html.replace(
          /(script-src)[^;]*;/i,
          `$1 ${tokens};`,
        );
      },
    },
  };
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    cspPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
