"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  }
});
electron.contextBridge.exposeInMainWorld("drmApi", {
  decryptCDC: (container, passKey) => electron.ipcRenderer.invoke("drm:decrypt-cdc", container, passKey),
  setSecureData: (docId, key, value) => electron.ipcRenderer.invoke("secure:set-data", docId, key, value),
  getSecureData: (docId, key) => electron.ipcRenderer.invoke("secure:get-data", docId, key),
  removeDocData: (docId) => electron.ipcRenderer.invoke("secure:remove-doc-data", docId)
});
//# sourceMappingURL=preload.cjs.map
pcRenderer.invoke("secure:set-data", docId, key, value),
      getSecureData: (docId, key) => ipcRenderer.invoke("secure:get-data", docId, key),
      removeDocData: (docId) => ipcRenderer.invoke("secure:remove-doc-data", docId)
    });
  }
});
export default require_preload();
//# sourceMappingURL=preload.cjs.map
