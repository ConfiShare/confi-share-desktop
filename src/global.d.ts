export {}

declare global {
  interface Window {
    drmApi: {
      decryptCDC: (container: any, passKey: string) => Promise<{ decryptedPayload: string; contentKey: string }>;
      decryptPayload: (container: any, contentKey: string) => Promise<string>;
      setSecureData: (docId: string, key: string, value: string) => Promise<boolean>;
      getSecureData: (docId: string, key: string) => Promise<string | null>;
      removeDocData: (docId: string) => Promise<boolean>;
      saveList: (documents: any[]) => Promise<boolean>;
      loadList: () => Promise<any[]>;
      saveFileLocally: (docId: string, fileName: string, arrayBuffer: ArrayBuffer) => Promise<string>;
      readLocalFile: (localPath: string) => Promise<Uint8Array>;
    };
    ipcRenderer: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      send: (channel: string, ...args: any[]) => void;
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
      off: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
    };
  }
}
