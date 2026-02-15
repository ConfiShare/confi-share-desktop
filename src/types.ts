export type DocumentStatus = 'active' | 'offline' | 'code_expired' | 'revoked';

export interface ConfiDocument {
  id: string;
  name: string;
  displayName: string;
  status: DocumentStatus;
  expiresAt: Date;
  accessCode: string;
  sizeKb?: number;
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