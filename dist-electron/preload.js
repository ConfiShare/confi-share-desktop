const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  }
});
contextBridge.exposeInMainWorld("drmApi", {
  decryptCDC: (container, passKey) => ipcRenderer.invoke("drm:decrypt-cdc", container, passKey),
  decryptPayload: (container, contentKey) => ipcRenderer.invoke("drm:decrypt-payload", container, contentKey),
  setSecureData: (docId, key, value) => ipcRenderer.invoke("secure:set-data", docId, key, value),
  getSecureData: (docId, key) => ipcRenderer.invoke("secure:get-data", docId, key),
  removeDocData: (docId) => ipcRenderer.invoke("secure:remove-doc-data", docId),
  // File & List Persistence
  saveList: (documents) => ipcRenderer.invoke("docs:save-list", documents),
  loadList: () => ipcRenderer.invoke("docs:load-list"),
  saveFileLocally: (docId, fileName, arrayBuffer) => ipcRenderer.invoke("docs:save-file-locally", docId, fileName, arrayBuffer),
  readLocalFile: (localPath) => ipcRenderer.invoke("docs:read-local-file", localPath),
  convertToPdf: (docId, base64Data, originalName, originalMime) => ipcRenderer.invoke("drm:convert-office-to-pdf", docId, base64Data, originalName, originalMime)
});
contextBridge.exposeInMainWorld("windowControls", {
  setContentProtection: (enable) => ipcRenderer.invoke("window:set-content-protection", enable)
});
contextBridge.exposeInMainWorld("confiShare", {
  openFile: (path, passKey) => ipcRenderer.invoke("open-cdc-file", path, passKey),
  closeSession: (sessionDir) => ipcRenderer.invoke("close-cdc-session", sessionDir)
});
//# sourceMappingURL=preload.js.map
reload.js.map
