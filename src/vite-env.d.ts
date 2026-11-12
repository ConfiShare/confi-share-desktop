/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_AUTH_PREVIEW?: string;
  readonly VITE_ENABLE_TRACKING_PREVIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
