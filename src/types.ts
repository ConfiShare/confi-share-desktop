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
  pendingFiles?: File[] | null;
  importSummary?: {
    importedCount: number;
    failedCount: number;
  };
}

// ---------------------------------------------------------------------------
// Shared-file tracking: UI view models mapped from the API
// (GET /drm recipients, GET /audit-log entries) in services/trackingService.ts
// ---------------------------------------------------------------------------

export type DocumentAccessMode = 'open' | 'restricted';

export type TrackingStatus =
  | 'shared'
  | 'opened'
  | 'activated'
  | 'expired'
  | 'access_denied';

export type TrackingActivityType =
  | 'shared'
  | 'opened'
  | 'activated'
  | 'expired'
  | 'access_denied'
  | 'revoked';

export interface TrackingRecipient {
  name?: string;
  email: string;
}

export interface SharedDocumentRecord {
  id: string;
  docId: string;
  documentName: string;
  accessMode?: DocumentAccessMode;
  recipient: TrackingRecipient;
  sharedAt: Date;
  status: TrackingStatus;
  lastActivityAt?: Date;
  lastActivityType?: TrackingActivityType;
}

export interface DocumentActivity {
  id: string;
  recipientEmail: string;
  type: TrackingActivityType;
  occurredAt: Date;
  /** Document status immediately after this activity. */
  statusAfter: TrackingStatus;
  actorName?: string;
  /** Ready-to-show sentence from the audit log. */
  summary?: string;
  deviceId?: string;
  ip?: string;
}

export interface DocumentTrackingDetail {
  record: SharedDocumentRecord;
  fileType?: string;
  sizeKb?: number;
  lastOpenedAt?: Date;
  lastActivatedAt?: Date;
  /** Newest first. */
  activity: DocumentActivity[];
}
