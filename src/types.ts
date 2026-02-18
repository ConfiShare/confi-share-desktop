export type DocumentStatus = 'active' | 'offline' | 'code_expired' | 'revoked';

export interface ConfiDocument {
  id: string;
  name: string;
  displayName: string;
  status: DocumentStatus;
  expiresAt: Date;
  accessCode: string;
  sizeKb?: number;
  fileObject?: File;       // the actual imported File
  fileUrl?: string;        // object URL created from fileObject for rendering
  totalPages?: number;     // total page count extracted from the file
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