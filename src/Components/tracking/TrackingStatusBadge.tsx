import type { TrackingStatus } from '../../types';
import { TRACKING_STATUS_LABELS } from './trackingFormat';

/** Same shape/size as the existing StatusBadge, with tracking-specific states. */
const CONFIGS: Record<TrackingStatus, { bg: string; text: string }> = {
  shared: { bg: 'bg-gray-100', text: 'text-gray-600' },
  opened: { bg: 'bg-sky-50', text: 'text-sky-700' },
  activated: { bg: 'bg-[#059669]', text: 'text-white' },
  expired: { bg: 'bg-yellow-50', text: 'text-yellow-600' },
  access_denied: { bg: 'bg-red-500', text: 'text-white' },
};

export function TrackingStatusBadge({ status }: { status: TrackingStatus }) {
  const { bg, text } = CONFIGS[status];
  return (
    <span
      style={{ padding: '0.1rem 0.3rem' }}
      className={`inline-flex items-center whitespace-nowrap rounded text-xs font-light ${bg} ${text}`}
    >
      {TRACKING_STATUS_LABELS[status]}
    </span>
  );
}
