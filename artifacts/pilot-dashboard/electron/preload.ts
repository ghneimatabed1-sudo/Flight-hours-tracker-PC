import { contextBridge, ipcRenderer } from "electron";

const api = {
  hardwareFingerprint: () => ipcRenderer.invoke("rjaf:fingerprint"),
  appVersion: () => ipcRenderer.invoke("rjaf:appVersion"),
  offlineQueuePath: () => ipcRenderer.invoke("rjaf:offlineQueuePath"),
  isPackaged: () => ipcRenderer.invoke("rjaf:isPackaged"),
  pickBackupFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("rjaf:pickBackupFolder"),
  writeBackupFile: (folder: string, filename: string, content: string): Promise<string> =>
    ipcRenderer.invoke("rjaf:writeBackupFile", folder, filename, content),
};

contextBridge.exposeInMainWorld("rjafElectron", api);
