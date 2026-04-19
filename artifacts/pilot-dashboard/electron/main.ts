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
    backgroundColor: "#0a1226",
    title: "Hawk Eye",
    icon: path.join(__dirname, "..", "public", "brand", "hawkeye-logo.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);

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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
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
