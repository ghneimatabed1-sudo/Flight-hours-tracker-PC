import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { startOutboxWorker } from "./lib/offlineQueue";

// Visible diagnostic overlay shown if anything synchronous below throws or
// if the bundle errors during evaluation. Without this the user sees a
// pure black window and has no way to know what went wrong.
function showFatal(err: unknown): void {
  const root = document.getElementById("root");
  const msg = err instanceof Error ? `${err.name}: ${err.message}\n\n${err.stack ?? ""}` : String(err);
  const html = `
    <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0a1226;color:#e6c97a;font-family:Inter,system-ui,sans-serif;padding:32px;text-align:center;">
      <div style="max-width:760px;">
        <div style="font-size:14px;letter-spacing:0.32em;text-transform:uppercase;color:#e6c97a;opacity:0.85;margin-bottom:16px;">Hawk Eye — startup error</div>
        <div style="font-size:13px;line-height:1.6;color:#e6e6e6;background:rgba(255,255,255,0.04);border:1px solid rgba(230,201,122,0.25);border-radius:8px;padding:18px;text-align:left;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-height:60vh;overflow:auto;">${msg.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))}</div>
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-top:18px;">Press Ctrl+Shift+I for DevTools · Send this screen to Super Admin</div>
      </div>
    </div>`;
  if (root) root.innerHTML = html;
  else document.body.innerHTML = html;
}

window.addEventListener("error", (e) => {
  // Only show overlay if React hasn't rendered anything yet.
  const root = document.getElementById("root");
  if (root && root.children.length === 0) showFatal(e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  const root = document.getElementById("root");
  if (root && root.children.length === 0) showFatal(e.reason);
});

try {
  // The outbox worker is best-effort — never let it block React mounting.
  try { startOutboxWorker(); } catch (e) { console.warn("outbox worker failed:", e); }
  createRoot(document.getElementById("root")!).render(<App />);
} catch (err) {
  showFatal(err);
}
