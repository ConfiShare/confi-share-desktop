import {
  Send,
  Eye,
  KeyRound,
  Clock,
  ShieldX,
  Ban,
  History,
  type LucideIcon,
} from 'lucide-react';
import type { DocumentActivity, TrackingActivityType } from '../../types';
import { TrackingStatusBadge } from './TrackingStatusBadge';
import { TrackingEmptyState, TrackingErrorState, TrackingLoadingState } from './TrackingStateViews';
import { ACTIVITY_LABELS, formatDateTime } from './trackingFormat';

const ACTIVITY_ICONS: Record<TrackingActivityType, { Icon: LucideIcon; tone: string }> = {
  shared: { Icon: Send, tone: 'bg-gray-100 text-gray-500' },
  opened: { Icon: Eye, tone: 'bg-sky-50 text-sky-600' },
  activated: { Icon: KeyRound, tone: 'bg-emerald-50 text-[#059669]' },
  expired: { Icon: Clock, tone: 'bg-yellow-50 text-yellow-600' },
  access_denied: { Icon: ShieldX, tone: 'bg-red-50 text-red-500' },
  revoked: { Icon: Ban, tone: 'bg-red-50 text-red-500' },
};

interface DocumentActivityHistoryProps {
  activity: DocumentActivity[] | null;
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
  emptyDescription?: string;
}

/** Vertical timeline of tracking activity (newest first). */
export function DocumentActivityHistory({
  activity,
  isLoading,
  error,
  onRetry,
  emptyDescription = 'Activity will appear here when someone opens this document or is blocked from opening it.',
}: DocumentActivityHistoryProps) {
  if (isLoading) return <TrackingLoadingState />;
  if (error) return <TrackingErrorState message={error} onRetry={onRetry} />;
  if (!activity || activity.length === 0) {
    return (
      <TrackingEmptyState
        icon={<History className="w-6 h-6" />}
        title="No activity yet"
        description={emptyDescription}
      />
    );
  }

  return (
    <ol className="relative">
      {activity.map((item, index) => {
        const { Icon, tone } = ACTIVITY_ICONS[item.type];
        const isLast = index === activity.length - 1;
        return (
          <li key={item.id} className="relative flex gap-3" style={{ paddingBottom: isLast ? 0 : '1.1rem' }}>
            {!isLast && <span className="absolute left-4 top-9 bottom-0 w-px bg-gray-200" aria-hidden />}
            <div className={`relative z-10 w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${tone}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-sm font-medium text-gray-900">{ACTIVITY_LABELS[item.type]}</p>
                <TrackingStatusBadge status={item.statusAfter} />
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate" title={item.recipientEmail}>
                {item.actorName ? `${item.actorName} · ` : ''}
                {item.recipientEmail}
              </p>
              {item.summary && (
                <p className="text-xs text-gray-600 mt-0.5 leading-relaxed wrap-break-word">{item.summary}</p>
              )}
              <p className="text-[11px] text-gray-400 mt-0.5">
                <time dateTime={item.occurredAt.toISOString()}>{formatDateTime(item.occurredAt)}</time>
                {item.deviceId && <> · Device {item.deviceId}</>}
                {item.ip && <> · IP {item.ip}</>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
