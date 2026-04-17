import { contextBridge, ipcRenderer } from "electron";

const api = {
  hardwareFingerprint: () => ipcRenderer.invoke("rjaf:fingerprint"),
  appVersion: () => ipcRenderer.invoke("rjaf:appVersion"),
  offlineQueuePath: () => ipcRenderer.invoke("rjaf:offlineQueuePath"),
  isPackaged: () => ipcRenderer.invoke("rjaf:isPackaged"),
};

contextBridge.exposeInMainWorld("rjafElectron", api);
