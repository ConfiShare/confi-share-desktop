// import { ipcRenderer, contextBridge } from 'electron'

// // --------- Expose some API to the Renderer process ---------
// contextBridge.exposeInMainWorld('ipcRenderer', {
//   on(...args: Parameters<typeof ipcRenderer.on>) {
//     const [channel, listener] = args
//     return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
//   },
//   off(...args: Parameters<typeof ipcRenderer.off>) {
//     const [channel, ...omit] = args
//     return ipcRenderer.off(channel, ...omit)
//   },
//   send(...args: Parameters<typeof ipcRenderer.send>) {
//     const [channel, ...omit] = args
//     return ipcRenderer.send(channel, ...omit)
//   },
//   invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
//     const [channel, ...omit] = args
//     return ipcRenderer.invoke(channel, ...omit)
//   },

//   // You can expose other APTs you need here.
//   // ...
// })


const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event: any, ...args: any[]) => (listener as any)(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

// Specifically expose DRM and Secure Storage APIs for clarity in the renderer
contextBridge.exposeInMainWorld('drmApi', {
  decryptCDC: (container: any, passKey: string) => ipcRenderer.invoke('drm:decrypt-cdc', container, passKey),
  decryptPayload: (container: any, contentKey: string) => ipcRenderer.invoke('drm:decrypt-payload', container, contentKey),
  setSecureData: (docId: string, key: string, value: string) => ipcRenderer.invoke('secure:set-data', docId, key, value),
  getSecureData: (docId: string, key: string) => ipcRenderer.invoke('secure:get-data', docId, key),
  removeDocData: (docId: string) => ipcRenderer.invoke('secure:remove-doc-data', docId),
  // File & List Persistence
  saveList: (documents: any[]) => ipcRenderer.invoke('docs:save-list', documents),
  loadList: () => ipcRenderer.invoke('docs:load-list'),
  saveFileLocally: (docId: string, fileName: string, arrayBuffer: ArrayBuffer) => ipcRenderer.invoke('docs:save-file-locally', docId, fileName, arrayBuffer),
  readLocalFile: (localPath: string) => ipcRenderer.invoke('docs:read-local-file', localPath),
  convertToPdf: (docId: string, base64Data: string, originalName: string, originalMime: string) => ipcRenderer.invoke('drm:convert-office-to-pdf', docId, base64Data, originalName, originalMime),
})

contextBridge.exposeInMainWorld('confiShare', {
  openFile: (path: string, passKey?: string) => ipcRenderer.invoke('open-cdc-file', path, passKey),
  closeSession: (sessionDir: string) => ipcRenderer.invoke('close-cdc-session', sessionDir),
})
