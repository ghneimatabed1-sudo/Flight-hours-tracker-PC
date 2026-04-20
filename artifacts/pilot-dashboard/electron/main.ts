/**
 * Electron main process for RJAF Squadron Ops desktop app.
 *
 * This file is bundled and packaged with electron-builder to produce a real
 * Windows .exe installer (NSIS). It is NOT used in development inside Replit
 * (where the renderer is served by Vite directly).
 *
 * Build the .exe on a Windows host:
 *   1. pnpm install
 *   2. pnpm --filter @workspace/pilot-dashboard run build
 *   3. pnpm --filter @workspace/pilot-dashboard run electron:build
 *
 * See ELECTRON_BUILD.md for the full instructions including installer
 * password protection, code signing, and electron-updater configuration.
 */
import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

function hardwareFingerprint(): string {
  const cpus = os.cpus().map(c => c.model).join("|");
  const macs: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const list = ifaces[name];
    if (!list) continue;
    for (const info of list) {
      if (info.mac && info.mac !== "00:00:00:00:00:00") macs.push(info.mac);
    }
  }
  const macSeed = macs.sort().join("|");
  const seed = `${os.hostname()}|${os.platform()}|${os.arch()}|${cpus}|${macSeed}|${os.totalmem()}`;
  return "FP-" + crypto.createHash("sha256").update(seed).digest("hex").slice(0, 24).toUpperCase();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    // Launch maximized (NOT fullscreen) so operators get the whole
    // dashboard on any monitor while keeping the standard title bar
    // controls — minimize, maximize/restore and close — visible.
    show: false,
    backgroundColor: "#0a1226",
    title: "Hawk Eye",
    icon: path.join(__dirname, "..", "public", "brand", "hawkeye-logo.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox:false because sandbox:true under file:// can silently
      // refuse to evaluate ES module scripts loaded by Vite (Chromium
      // treats them as cross-origin), producing a black window with no
      // error in the renderer console. The preload still uses
      // contextBridge so the security posture remains correct.
      sandbox: false,
      // Required so Chromium will evaluate Vite's ES module bundle
      // when it's loaded from a file:// URL. Without this, Electron 32+
      // blocks the script with no visible error and the window stays
      // blank. We only ever load local files (no remote content), so
      // this does not increase real attack surface.
      webSecurity: false,
    },
  });

  Menu.setApplicationMenu(null);

  // Reveal the window only once the renderer paints its first frame so
  // operators don't see a flash of empty chrome before full-screen kicks in.
  // SAFETY NET: if `ready-to-show` doesn't fire within 4 seconds (slow
  // network blocking on Google Fonts, renderer hang, etc.), force-show
  // the window anyway so operators are never staring at an invisible
  // process that's only visible in Task Manager.
  let shown = false;
  const showOnce = (reason: string) => {
    if (shown || !mainWindow) return;
    shown = true;
    try {
      mainWindow.maximize();
      mainWindow.show();
      mainWindow.focus();
    } catch (e) {
      logErr("show-failed", `${reason}: ${(e as Error).message}`);
    }
  };
  mainWindow.once("ready-to-show", () => showOnce("ready-to-show"));
  setTimeout(() => {
    if (!shown) {
      logErr(
        "ready-to-show-timeout",
        "Renderer did not signal ready within 4s — forcing window visible. Open DevTools (Ctrl+Shift+I) for details.",
      );
      showOnce("timeout");
      try { mainWindow?.webContents.openDevTools({ mode: "detach" }); } catch { /* ignore */ }
    }
  }, 4000);

  // ── Diagnostics so we never ship another silent blue-screen ─────────
  // If the renderer fails to load (bad path, missing asset, ESM blocked
  // under file://) or crashes, write a log under userData and pop a
  // dialog so the operator can take a screenshot for support.
  const logFile = path.join(app.getPath("userData"), "renderer-error.log");
  const logErr = (label: string, detail: string) => {
    const line = `[${new Date().toISOString()}] ${label}: ${detail}\n`;
    try { fs.appendFileSync(logFile, line); } catch { /* best effort */ }
    if (!isDev) {
      try { mainWindow?.webContents.openDevTools({ mode: "detach" }); } catch { /* ignore */ }
      dialog.showErrorBox(
        "Hawk Eye — startup error",
        `${label}\n\n${detail}\n\nA log was written to:\n${logFile}\n\n` +
        `Please send this file to the Super Admin.`,
      );
    }
  };

  // Types are loose here because electron typings aren't included in this
  // project's tsconfig (matches the rest of this file).
  mainWindow.webContents.on("did-fail-load", ((_e: unknown, code: number, desc: string, url: string) => {
    logErr("did-fail-load", `code=${code} url=${url} ${desc}`);
  }) as never);
  mainWindow.webContents.on("render-process-gone", ((_e: unknown, details: { reason: string; exitCode: number }) => {
    logErr("render-process-gone", `reason=${details.reason} exitCode=${details.exitCode}`);
  }) as never);
  mainWindow.webContents.on("preload-error", ((_e: unknown, preloadPath: string, error: Error) => {
    logErr("preload-error", `${preloadPath}: ${error.message}`);
  }) as never);

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173/");
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
    if (!fs.existsSync(indexPath)) {
      logErr("missing-index", `index.html not found at ${indexPath}`);
      return;
    }
    mainWindow.loadFile(indexPath).catch((err: Error) => {
      logErr("loadFile-rejected", err?.message || String(err));
    });
  }

  // ── Navigation hardening ────────────────────────────────────────────
  // Defence-in-depth on top of the renderer-side CSP. The renderer must
  // never navigate the BrowserWindow itself away from our local
  // file:// bundle, and external links should only open in the user's
  // real browser when they are explicitly safe schemes.
  const SAFE_OPEN_SCHEMES = new Set(["https:", "http:", "mailto:"]);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (SAFE_OPEN_SCHEMES.has(u.protocol)) shell.openExternal(url);
    } catch { /* malformed URL — refuse silently */ }
    return { action: "deny" };
  });
  // Block ALL in-window navigation away from the local bundle. The
  // dashboard is a single-page app — every legitimate navigation is a
  // hash change, never a full page load. If anything tries to navigate
  // the window itself (clicked anchor, JS redirect, devtools) we refuse.
  mainWindow.webContents.on("will-navigate", ((evt: { preventDefault: () => void }, url: string) => {
    try {
      const u = new URL(url);
      // Allow same-origin file:// (our own bundle) and the dev server
      // when running unpackaged. Everything else is blocked + opened
      // externally if it's a safe scheme.
      if (u.protocol === "file:") return;
      if (isDev && u.origin === "http://localhost:5173") return;
      evt.preventDefault();
      if (SAFE_OPEN_SCHEMES.has(u.protocol)) shell.openExternal(url);
    } catch {
      evt.preventDefault();
    }
  }) as never);
  // Block attaching new webviews — we don't use them anywhere.
  mainWindow.webContents.on("will-attach-webview", ((evt: { preventDefault: () => void }) => {
    evt.preventDefault();
  }) as never);
}

app.whenReady().then(() => {
  createWindow();

  // Auto-update from the public Releases repo. The repo only contains the
  // compiled installer + latest.yml — never the source code. Pilots get a
  // popup when a newer version is published.
  if (!isDev) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdatesAndNotify().catch((err: Error) => {
      // eslint-disable-next-line no-console
      console.warn("Update check failed:", err.message);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("rjaf:fingerprint", () => hardwareFingerprint());
ipcMain.handle("rjaf:appVersion", () => app.getVersion());
ipcMain.handle("rjaf:offlineQueuePath", () => {
  const dir = path.join(app.getPath("userData"), "offline-queue");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
});
ipcMain.handle("rjaf:isPackaged", () => app.isPackaged);

// ── Backup file-system bridge ───────────────────────────────────────────
// Lets the renderer ask the user to pick a folder, and write the encrypted
// .rjafbackup file directly to disk. Without these handlers the renderer
// falls back to a normal browser download into the user's Downloads folder.
ipcMain.handle("rjaf:pickBackupFolder", async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Choose backup folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

ipcMain.handle(
  "rjaf:writeBackupFile",
  async (_evt, folder: string, filename: string, content: string) => {
    if (!folder || !filename) throw new Error("folder and filename are required");
    // Sanity: refuse path-traversal in filename, must stay flat in the chosen folder.
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      throw new Error("invalid filename");
    }
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const full = path.join(folder, filename);
    await fs.promises.writeFile(full, content, "utf8");
    return full;
  }
);
