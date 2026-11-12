import type { DocumentActivity, TrackingActivityType, TrackingStatus } from '../../types';

export interface ActivitySummary {
  recipientEmail?: string;
  sharedAt?: Date;
  lastOpenedAt?: Date;
  lastActivatedAt?: Date;
  currentStatus?: TrackingStatus;
}

/** Derive key dates from an activity list (any order). */
export function summarizeActivity(activity: DocumentActivity[]): ActivitySummary {
  const newestFirst = [...activity].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const latest = (types: TrackingActivityType[]) =>
    newestFirst.find((a) => types.includes(a.type))?.occurredAt;
  const shared = [...newestFirst].reverse().find((a) => a.type === 'shared');
  return {
    recipientEmail: shared?.recipientEmail ?? newestFirst[0]?.recipientEmail,
    sharedAt: shared?.occurredAt,
    // Opening in the app IS an activation (document.activated); viewing on the
    // website is document.viewed_online. Both count as "opened".
    lastOpenedAt: latest(['activated', 'opened']),
    lastActivatedAt: latest(['activated']),
    currentStatus: newestFirst[0]?.statusAfter,
  };
}

export const TRACKING_STATUS_LABELS: Record<TrackingStatus, string> = {
  shared: 'Shared',
  opened: 'Opened',
  activated: 'Activated',
  expired: 'Expired',
  access_denied: 'Access Denied',
};

export const TRACKING_STATUS_ORDER: TrackingStatus[] = [
  'shared',
  'opened',
  'activated',
  'expired',
  'access_denied',
];

export const ACTIVITY_LABELS: Record<TrackingActivityType, string> = {
  shared: 'Document shared',
  opened: 'Viewed online',
  activated: 'Opened in the app',
  expired: 'Offline access expired',
  access_denied: 'Blocked attempt to open',
  revoked: 'Blocked: access removed',
};

export function formatDateTime(date: Date | undefined): string {
  if (!date) return '—';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(date: Date | undefined): string {
  if (!date) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatRelative(date: Date | undefined, now: Date = new Date()): string {
  if (!date) return '—';
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(date);
}
