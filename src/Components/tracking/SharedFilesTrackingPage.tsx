import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Search, FileText, Inbox, SearchX, RotateCw } from 'lucide-react';
import type { TrackingStatus } from '../../types';
import { trackingService } from '../../services/trackingService';
import { useAsyncData } from '../../hooks/useAsyncData';
import { TrackingStatusBadge } from './TrackingStatusBadge';
import { DocumentTrackingDetails } from './DocumentTrackingDetails';
import {
  TrackingEmptyState,
  TrackingErrorState,
  TrackingLoadingState,
} from './TrackingStateViews';
import {
  ACTIVITY_LABELS,
  TRACKING_STATUS_LABELS,
  TRACKING_STATUS_ORDER,
  formatDate,
  formatRelative,
} from './trackingFormat';

interface SharedFilesTrackingPageProps {
  onBack: () => void;
}

type StatusFilter = 'all' | TrackingStatus;

/**
 * Shared file tracking view inside the main content area.
 * Wide windows: list + details side by side. Narrow windows: details replace the list.
 */
export function SharedFilesTrackingPage({ onBack }: SharedFilesTrackingPageProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => trackingService.listSharedDocuments(), []);
  const { data: records, isLoading, error, reload } = useAsyncData(load);

  const filtered = useMemo(() => {
    if (!records) return [];
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.documentName.toLowerCase().includes(q) ||
        r.recipient.email.toLowerCase().includes(q) ||
        (r.recipient.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [records, query, statusFilter]);

  // With the details panel docked (xl+), the list is narrower: drop the
  // "Date shared" column (it is in the details panel) until 2xl widths.
  const dateColumnClass = selectedId ? 'hidden 2xl:table-cell' : 'hidden lg:table-cell';
  const nameCellClass = selectedId ? 'max-w-[200px]' : 'max-w-[260px]';
  const recordCount = records?.length ?? 0;
  const hasRecords = recordCount > 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-hidden min-w-0">
      {/* Header — same treatment as the About ConfiShare page */}
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-gray-100 shrink-0">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-4 h-4 text-gray-700" />
        </button>
        <h1 className="text-base font-semibold text-gray-900">Shared file tracking</h1>
        {recordCount > 0 && (
          <span className="text-xs text-gray-400">
            {recordCount} share{recordCount === 1 ? '' : 's'}
          </span>
        )}
        <button
          onClick={reload}
          disabled={isLoading}
          className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 cursor-pointer disabled:opacity-50 transition-colors"
          aria-label="Refresh"
          title="Refresh"
        >
          <RotateCw className={`w-4 h-4 text-gray-700 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* List */}
        <section
          className={`${selectedId ? 'hidden xl:flex' : 'flex'} emerald-scrollbar flex-1 flex-col min-w-0 overflow-y-auto`}
          style={{ padding: '1.25rem 1.5rem' }}
          aria-label="Shared documents"
        >
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div
              className={`flex items-center gap-2 h-10 flex-1 min-w-[220px] max-w-md rounded-xl border transition-colors ${
                query ? 'border-[#059669] bg-white' : 'border-gray-200 bg-white'
              }`}
              style={{ padding: '0 0.75rem' }}
            >
              <Search className="w-4.5 h-4.5 text-gray-400 shrink-0" />
              <input
                type="text"
                placeholder="Search by document or recipient"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none"
                aria-label="Search shared documents"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="h-10 rounded-xl border border-gray-200 bg-white text-sm text-gray-700 outline-none cursor-pointer focus:border-[#059669]"
              style={{ padding: '0 0.75rem' }}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              {TRACKING_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {TRACKING_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {isLoading ? (
              <TrackingLoadingState label="Loading shared documents..." />
            ) : error ? (
              <TrackingErrorState message={error} onRetry={reload} />
            ) : !hasRecords ? (
              <TrackingEmptyState
                icon={<Inbox className="w-6 h-6" />}
                title="No shared documents yet"
                description="Documents you share from your ConfiShare account will appear here with each recipient and their latest activity."
              />
            ) : filtered.length === 0 ? (
              <TrackingEmptyState
                icon={<SearchX className="w-6 h-6" />}
                title="No matching documents"
                description="Try a different search term or status filter."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-400 font-medium tracking-wide">
                      <th className="font-medium" style={{ padding: '0.7rem 1rem' }}>Document</th>
                      <th className="font-medium" style={{ padding: '0.7rem 1rem' }}>Recipient</th>
                      <th className={`font-medium ${dateColumnClass}`} style={{ padding: '0.7rem 1rem' }}>
                        Date shared
                      </th>
                      <th className="font-medium" style={{ padding: '0.7rem 1rem' }}>Status</th>
                      <th className="font-medium hidden md:table-cell" style={{ padding: '0.7rem 1rem' }}>
                        Last activity
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((r) => {
                      const isSelected = r.id === selectedId;
                      return (
                        <tr
                          key={r.id}
                          onClick={() => setSelectedId(r.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedId(r.id);
                            }
                          }}
                          tabIndex={0}
                          aria-selected={isSelected}
                          className={`cursor-pointer transition-colors outline-none focus-visible:bg-gray-50 ${
                            isSelected ? 'bg-emerald-50/60' : 'hover:bg-gray-50'
                          }`}
                        >
                          <td style={{ padding: '0.75rem 1rem' }} className={nameCellClass}>
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="shrink-0 w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center">
                                <FileText className="w-4.5 h-4.5 text-gray-500" />
                              </div>
                              <span className="text-sm font-medium text-gray-900 truncate" title={r.documentName}>
                                {r.documentName}
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }} className="max-w-[220px]">
                            {r.recipient.name && (
                              <p className="text-sm text-gray-900 truncate">{r.recipient.name}</p>
                            )}
                            <p className="text-xs text-gray-500 truncate" title={r.recipient.email}>
                              {r.recipient.email}
                            </p>
                          </td>
                          <td
                            style={{ padding: '0.75rem 1rem' }}
                            className={`${dateColumnClass} text-sm text-gray-600 whitespace-nowrap`}
                          >
                            {formatDate(r.sharedAt)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <TrackingStatusBadge status={r.status} />
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }} className="hidden md:table-cell">
                            <p className="text-sm text-gray-600 whitespace-nowrap">{formatRelative(r.lastActivityAt)}</p>
                            {r.lastActivityType && (
                              <p className="text-xs text-gray-400 whitespace-nowrap">
                                {ACTIVITY_LABELS[r.lastActivityType]}
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Details */}
        {selectedId && (
          <aside
            className="flex-1 xl:flex-none xl:w-[400px] min-w-0 bg-gray-50 xl:border-l border-gray-100"
            aria-label="Tracking details"
          >
            <DocumentTrackingDetails
              key={selectedId}
              recordId={selectedId}
              onClose={() => setSelectedId(null)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
