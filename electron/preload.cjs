const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("helixDesktop", {
  getInfo: () => ipcRenderer.invoke("desktop:get-info"),
  chooseDataRoot: () => ipcRenderer.invoke("desktop:choose-data-root"),
  revealDataRoot: () => ipcRenderer.invoke("desktop:reveal-data-root"),
  restart: () => ipcRenderer.invoke("desktop:restart"),
  checkForUpdate: (force = false) =>
    ipcRenderer.invoke("desktop:check-update", Boolean(force)),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  openReleases: () => ipcRenderer.invoke("desktop:open-releases"),
  onUpdateProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("desktop:update-progress", handler);
    return () => ipcRenderer.removeListener("desktop:update-progress", handler);
  },
  onUpdateAvailable: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("desktop:update-available", handler);
    return () => ipcRenderer.removeListener("desktop:update-available", handler);
  },
});
