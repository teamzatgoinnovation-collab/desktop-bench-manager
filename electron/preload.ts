import { contextBridge, ipcRenderer } from "electron";

export type ZatGoBenchDesktopApi = {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<NodeJS.Platform>;
  getBenchUrl: () => Promise<string>;
  getBenchWebRoot: () => Promise<string>;
};

const api: ZatGoBenchDesktopApi = {
  getAppVersion: () => ipcRenderer.invoke("desktop:getAppVersion"),
  getPlatform: () => ipcRenderer.invoke("desktop:getPlatform"),
  getBenchUrl: () => ipcRenderer.invoke("desktop:getBenchUrl"),
  getBenchWebRoot: () => ipcRenderer.invoke("desktop:getBenchWebRoot"),
};

contextBridge.exposeInMainWorld("zatgoBenchDesktop", api);
