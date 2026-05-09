export type DocumentStatus = 'active' | 'offline' | 'code_expired' | 'revoked';

export interface CdcContainerMeta {
  // Used when we render the unlocked document blob.
  mime: string;
}

export type CdcContainer = { meta: CdcContainerMeta } & Record<string, unknown>;

export interface ConfiDocument {
  id: string;
  realDocId?: string;     // The actual mongoose ID from the backend
  localPath?: string;     // Local internal path to the stored file
  name: string;
  displayName: string;
  status: DocumentStatus;
  expiresAt: Date;
  accessCode: string;
  sizeKb?: number;
  fileObject?: File;       // the actual imported File (transient)
  fileUrl?: string;        // object URL created from fileObject/localPath for rendering
  totalPages?: number;     // total page count extracted from the file
  cdcContainer?: CdcContainer; // the raw .cdc JSON container
  isLocked?: boolean;      // whether the document is currently locked
}

export type ModalType =
  | null
  | 'import_choose'
  | 'import_confirm'
  | 'import_success'
  | 'enter_access_code'
  | 'view_access_code'
  | 'access_revoked';

export interface ModalState {
  type: ModalType;
  documentId?: string;
  pendingFile?: File | null;
}