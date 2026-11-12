import { useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import type { ConfiDocument } from '../../types';
import { trackingService } from '../../services/trackingService';
import { useAsyncData } from '../../hooks/useAsyncData';
import { StatusBadge } from '../StatusBadge';
import { DocumentActivityHistory } from './DocumentActivityHistory';
import { TrackingInfoNote } from './TrackingStateViews';
import { TrackingInfoGrid } from './TrackingInfoGrid';
import { TrackingStatusBadge } from './TrackingStatusBadge';
import { formatDateTime, summarizeActivity } from './trackingFormat';

interface DocumentActivityPanelProps {
  doc: ConfiDocument;
  onClose: () => void;
}

/**
 * Activity / tracking side panel for the existing document details view
 * (DocumentViewer). Data: GET /audit-log for this document. The audit log is
 * only readable by the document's owner (and their team); for anyone else
 * the API returns no entries.
 */
export function DocumentActivityPanel({ doc, onClose }: DocumentActivityPanelProps) {
  // The backend document id comes from the decrypted container.
  const backendDocId = doc.realDocId;
  const load = useCallback(() => trackingService.getDocumentActivity(backendDocId ?? ''), [backendDocId]);
  const { data: activity, isLoading, error, reload } = useAsyncData(backendDocId ? load : null);
  const summary = useMemo(() => summarizeActivity(activity ?? []), [activity]);

  const hasActivity = !isLoading && !error && (activity?.length ?? 0) > 0;

  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 w-full max-w-[360px] lg:static lg:z-auto lg:w-[340px] shrink-0 flex flex-col bg-gray-50 border-l border-gray-200 shadow-xl lg:shadow-none"
      aria-label="Document activity"
    >
      <div
        className="flex items-center gap-2 bg-white border-b border-gray-100 shrink-0"
        style={{ padding: '0.75rem 1rem' }}
      >
        <h2 className="flex-1 text-sm font-semibold text-gray-900">Tracking &amp; activity</h2>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 bg-gray-100 hover:bg-gray-50 cursor-pointer transition-colors text-gray-500"
          aria-label="Close activity panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="emerald-scrollbar flex-1 overflow-y-auto" style={{ padding: '1rem' }}>
        <div className="mb-4">
          <TrackingInfoNote>
            The sender of this document can see that you opened it, when, and from which device and IP
            address.
          </TrackingInfoNote>
        </div>

        <p className="text-sm text-gray-400 font-normal mb-2 px-1">Document</p>
        <TrackingInfoGrid
          items={[
            { label: 'Document name', value: doc.name, wide: true },
            { label: 'Local status', value: <StatusBadge status={doc.status} /> },
            { label: 'Size', value: doc.sizeKb ? `${doc.sizeKb.toLocaleString()} KB` : '—' },
          ]}
        />

        {hasActivity && (
          <>
            <p className="text-sm text-gray-400 font-normal mt-5 mb-2 px-1">Tracking</p>
            <TrackingInfoGrid
              items={[
                { label: 'Latest viewer', value: summary.recipientEmail ?? '—', wide: true },
                {
                  label: 'Tracking status',
                  value: summary.currentStatus ? <TrackingStatusBadge status={summary.currentStatus} /> : '—',
                },
                { label: 'Last opened', value: formatDateTime(summary.lastOpenedAt) },
                { label: 'Last activated', value: formatDateTime(summary.lastActivatedAt) },
              ]}
            />
          </>
        )}

        <p className="text-sm text-gray-400 font-normal mt-5 mb-2 px-1">Activity history</p>
        <div className="bg-white rounded-xl border border-gray-100" style={{ padding: '1rem' }}>
          <DocumentActivityHistory
            activity={activity}
            isLoading={isLoading}
            error={error}
            onRetry={reload}
            emptyDescription="Only the document's owner can see who opened it. If you shared this document, activity appears here once someone opens it."
          />
        </div>
      </div>
    </aside>
  );
}
