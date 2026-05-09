export {}

declare global {
  interface Window {
    drmApi: {
      decryptCDC: (container: unknown, passKey: string) => Promise<{ decryptedPayload: string; contentKey: string }>;
      decryptPayload: (container: unknown, contentKey: string) => Promise<string>;
      setSecureData: (docId: string, key: string, value: string) => Promise<boolean>;
      getSecureData: (docId: string, key: string) => Promise<string | null>;
      removeDocData: (docId: string) => Promise<boolean>;
      saveList: (documents: unknown[]) => Promise<boolean>;
      loadList: () => Promise<unknown[]>;
      saveFileLocally: (docId: string, fileName: string, arrayBuffer: ArrayBuffer) => Promise<string>;
      readLocalFile: (localPath: string) => Promise<Uint8Array>;
    };
    ipcRenderer: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      send: (channel: string, ...args: unknown[]) => void;
      on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
      off: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
    };
  }
}
