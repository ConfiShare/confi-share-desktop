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
  removeDocData: (docId) => ipcRenderer.invoke("secure:remove-doc-data", docId)
});
//# sourceMappingURL=preload.js.map
reload.js.map
