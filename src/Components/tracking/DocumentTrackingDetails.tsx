import { useCallback } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { trackingService } from '../../services/trackingService';
import { useAsyncData } from '../../hooks/useAsyncData';
import { DocumentActivityHistory } from './DocumentActivityHistory';
import { TrackingStatusBadge } from './TrackingStatusBadge';
import { TrackingErrorState, TrackingLoadingState } from './TrackingStateViews';
import { TrackingInfoGrid } from './TrackingInfoGrid';
import { formatDateTime } from './trackingFormat';

interface DocumentTrackingDetailsProps {
  recordId: string;
  onClose: () => void;
}

/** Tracking details + full activity history for one shared document. */
export function DocumentTrackingDetails({ recordId, onClose }: DocumentTrackingDetailsProps) {
  const load = useCallback(() => trackingService.getDocumentTracking(recordId), [recordId]);
  const { data: detail, isLoading, error, reload } = useAsyncData(load);

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-2 bg-white border-b border-gray-100 shrink-0"
        style={{ padding: '0.85rem 1rem' }}
      >
        {/* Back on narrow windows (details replace the list), close on wide ones */}
        <button
          type="button"
          onClick={onClose}
          className="xl:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
          aria-label="Back to shared files"
        >
          <ArrowLeft className="w-4 h-4 text-gray-700" />
        </button>
        <h2 className="flex-1 text-base font-semibold text-gray-900 truncate">Tracking details</h2>
        <button
          type="button"
          onClick={onClose}
          className="hidden xl:flex w-8 h-8 items-center justify-center rounded-full border border-gray-200 bg-gray-100 hover:bg-gray-50 cursor-pointer transition-colors text-gray-500"
          aria-label="Close tracking details"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="emerald-scrollbar flex-1 overflow-y-auto" style={{ padding: '1rem' }}>
        {isLoading && !detail ? (
          <TrackingLoadingState label="Loading tracking details..." />
        ) : error ? (
          <TrackingErrorState message={error} onRetry={reload} />
        ) : detail ? (
          <>
            <p className="text-base text-gray-400 font-normal mb-2 px-1">Document</p>
            <TrackingInfoGrid
              items={[
                { label: 'Document name', value: detail.record.documentName, wide: true },
                { label: 'File type', value: detail.fileType ?? '—' },
                {
                  label: 'Access',
                  value:
                    detail.record.accessMode === 'restricted'
                      ? 'Restricted'
                      : detail.record.accessMode === 'open'
                        ? 'Open'
                        : '—',
                },
                {
                  label: 'Current status',
                  value: <TrackingStatusBadge status={detail.record.status} />,
                  wide: true,
                },
              ]}
            />

            <p className="text-base text-gray-400 font-normal mt-5 mb-2 px-1">Sharing</p>
            <TrackingInfoGrid
              items={[
                {
                  label: 'Shared recipient',
                  value: (
                    <>
                      {detail.record.recipient.name && <span className="block">{detail.record.recipient.name}</span>}
                      <span className="block text-gray-500 font-normal">{detail.record.recipient.email}</span>
                    </>
                  ),
                  wide: true,
                },
                { label: 'Date shared', value: formatDateTime(detail.record.sharedAt) },
                { label: 'Last opened', value: formatDateTime(detail.lastOpenedAt) },
                { label: 'Last activated', value: formatDateTime(detail.lastActivatedAt) },
                { label: 'Last activity', value: formatDateTime(detail.record.lastActivityAt) },
              ]}
            />

            <p className="text-base text-gray-400 font-normal mt-5 mb-2 px-1">Activity history</p>
            <div className="bg-white rounded-xl border border-gray-100" style={{ padding: '1rem' }}>
              <DocumentActivityHistory activity={detail.activity} isLoading={false} error={null} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
