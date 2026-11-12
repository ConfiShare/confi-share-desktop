/**
 * Shared-file tracking: ConfiShare API v1.
 *
 *   GET /drm                       documents owned by the signed-in account,
 *                                  each with `accessMode` and `recipients[]`
 *   GET /drm/:docId                one document (same fields)
 *   GET /audit-log?resourceType=document&resourceId=<docId>
 *                                  who opened / was blocked, newest first
 *
 * All require `Authorization: Bearer <access_token>` (owner or team member).
 * For a document the user doesn't own, the audit log simply returns no items.
 */
import type {
  DocumentAccessMode,
  DocumentActivity,
  DocumentTrackingDetail,
  SharedDocumentRecord,
  TrackingActivityType,
  TrackingStatus,
} from '../types';
import { apiRequest, unwrapData } from './apiClient';

// ---- Raw API shapes (only the fields we use) -------------------------------

interface RawRecipient {
  _id?: string;
  /** normalized email (lowercase, Gmail dots/+tag removed) */
  email?: string;
  /** address exactly as the owner typed it: show this in UI */
  sentTo?: string;
  name?: string | null;
  userId?: string | null;
  sharedAt?: string;
  claimedAt?: string | null;
  revokedAt?: string | null;
}

interface RawDocument {
  _id?: string;
  id?: string;
  accessMode?: DocumentAccessMode;
  recipients?: RawRecipient[];
  [key: string]: unknown;
}

interface RawAuditEntry {
  _id?: string;
  action?: string;
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILED';
  reason?: string | null;
  actor?: { userId?: string | null; name?: string | null; email?: string | null };
  context?: { deviceId?: string | null; ip?: string | null };
  summary?: string;
  createdAt?: string;
}

// ---- Helpers ---------------------------------------------------------------

const ACTIVITY_PAGE_LIMIT = 100; // API max

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function docIdOf(doc: RawDocument): string {
  return String(doc._id ?? doc.id ?? '');
}

/**
 * The API docs don't list the document's file-name field, so check the
 * likely names and fall back to the id.
 * TODO(api): confirm the field name with the backend and simplify.
 */
function docNameOf(doc: RawDocument): string {
  for (const key of ['fileName', 'originalName', 'originalFileName', 'filename', 'name', 'title']) {
    const value = doc[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return `Document ${docIdOf(doc).slice(-6)}`;
}

function fileTypeOf(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : undefined;
}

/** Same normalization the API applies to recipient emails. */
function normalizeEmail(email: string): string {
  const [rawLocal, rawDomain = ''] = email.trim().toLowerCase().split('@');
  let local = rawLocal;
  let domain = rawDomain;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

function recipientKey(r: RawRecipient): string {
  return normalizeEmail(r.email ?? r.sentTo ?? '');
}

function encodeRecordId(docId: string, r: RawRecipient): string {
  return `${docId}::${encodeURIComponent(recipientKey(r))}`;
}

function decodeRecordId(recordId: string): { docId: string; key: string } {
  const sep = recordId.indexOf('::');
  return { docId: recordId.slice(0, sep), key: decodeURIComponent(recordId.slice(sep + 2)) };
}

function toRecord(doc: RawDocument, r: RawRecipient): SharedDocumentRecord {
  const docId = docIdOf(doc);
  const sharedAt = toDate(r.sharedAt) ?? new Date(0);
  const claimedAt = toDate(r.claimedAt);
  const revokedAt = toDate(r.revokedAt);

  let status: TrackingStatus = 'shared';
  let lastActivityAt = sharedAt;
  let lastActivityType: TrackingActivityType = 'shared';
  if (claimedAt && claimedAt >= lastActivityAt) {
    status = 'activated';
    lastActivityAt = claimedAt;
    lastActivityType = 'activated';
  }
  if (revokedAt) {
    status = 'access_denied';
    if (revokedAt >= lastActivityAt) {
      lastActivityAt = revokedAt;
      lastActivityType = 'revoked';
    }
  }

  return {
    id: encodeRecordId(docId, r),
    docId,
    documentName: docNameOf(doc),
    accessMode: doc.accessMode,
    recipient: { name: r.name ?? undefined, email: r.sentTo ?? r.email ?? '' },
    sharedAt,
    status,
    lastActivityAt,
    lastActivityType,
  };
}

function mapAuditEntry(entry: RawAuditEntry, index: number): DocumentActivity {
  const denied = entry.outcome === 'DENIED';
  let type: TrackingActivityType;
  let statusAfter: TrackingStatus;
  if (denied) {
    type = entry.reason === 'RECIPIENT_REVOKED' ? 'revoked' : 'access_denied';
    statusAfter = 'access_denied';
  } else if (entry.action === 'document.viewed_online') {
    type = 'opened';
    statusAfter = 'opened';
  } else {
    // document.activated (opened in the app); unknown actions render generically via summary
    type = 'activated';
    statusAfter = 'activated';
  }

  return {
    id: entry._id ?? `audit-${index}`,
    recipientEmail: entry.actor?.email ?? 'Not signed in',
    actorName: entry.actor?.name ?? undefined,
    type,
    occurredAt: toDate(entry.createdAt) ?? new Date(0),
    statusAfter,
    summary: entry.summary,
    deviceId: entry.context?.deviceId ?? undefined,
    ip: entry.context?.ip ?? undefined,
  };
}

function asDocumentList(payload: unknown): RawDocument[] {
  if (Array.isArray(payload)) return payload as RawDocument[];
  const record = payload as { documents?: unknown; items?: unknown } | null;
  if (Array.isArray(record?.documents)) return record.documents as RawDocument[];
  if (Array.isArray(record?.items)) return record.items as RawDocument[];
  return [];
}

// ---- Service ---------------------------------------------------------------

export const trackingService = {
  /** One row per (document, recipient) the signed-in account has shared. */
  async listSharedDocuments(): Promise<SharedDocumentRecord[]> {
    const body = await apiRequest('/drm', { auth: 'required' });
    const docs = asDocumentList(unwrapData(body));
    return docs
      .flatMap((doc) => (doc.recipients ?? []).map((r) => toRecord(doc, r)))
      .sort((a, b) => b.sharedAt.getTime() - a.sharedAt.getTime());
  },

  /** Complete activity history for a document (audit log), newest first. */
  async getDocumentActivity(docId: string): Promise<DocumentActivity[]> {
    const body = await apiRequest('/audit-log', {
      auth: 'required',
      query: { resourceType: 'document', resourceId: docId, page: 1, limit: ACTIVITY_PAGE_LIMIT },
    });
    const data = unwrapData<{ items?: RawAuditEntry[] }>(body);
    return (data?.items ?? []).map(mapAuditEntry);
  },

  /** Document + one recipient + the document's full activity history. */
  async getDocumentTracking(recordId: string): Promise<DocumentTrackingDetail> {
    const { docId, key } = decodeRecordId(recordId);
    const [docBody, activity] = await Promise.all([
      apiRequest(`/drm/${encodeURIComponent(docId)}`, { auth: 'required' }),
      trackingService.getDocumentActivity(docId),
    ]);
    const doc = unwrapData<RawDocument>(docBody);
    const recipient = (doc.recipients ?? []).find((r) => recipientKey(r) === key);
    if (!recipient) throw new Error('This recipient is no longer on the document.');

    const record = toRecord(doc, recipient);
    const byRecipient = activity.filter(
      (a) => a.recipientEmail.includes('@') && normalizeEmail(a.recipientEmail) === key
    );
    const latest = (types: TrackingActivityType[]) =>
      byRecipient.find((a) => types.includes(a.type))?.occurredAt;
    const claimedAt = toDate(recipient.claimedAt);

    if (byRecipient[0] && byRecipient[0].occurredAt > (record.lastActivityAt ?? new Date(0))) {
      record.lastActivityAt = byRecipient[0].occurredAt;
      record.lastActivityType = byRecipient[0].type;
    }

    return {
      record,
      fileType: fileTypeOf(record.documentName),
      lastOpenedAt: latest(['activated', 'opened']) ?? claimedAt,
      lastActivatedAt: latest(['activated']) ?? claimedAt,
      activity,
    };
  },
};
