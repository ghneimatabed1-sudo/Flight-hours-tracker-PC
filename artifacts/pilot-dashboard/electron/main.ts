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
import { app, BrowserWindow, Menu, shell, ipcMain } from "electron";
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
    title: "RJAF Squadron Ops",
    icon: path.join(__dirname, "..", "public", "brand", "emblem.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173/");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "public", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();

  if (!isDev) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
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
