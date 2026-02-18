import { useState } from 'react';
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { ConfiDocument } from '../types';

interface DocumentViewerProps {
  doc: ConfiDocument;
}

export function DocumentViewer({ doc }: DocumentViewerProps) {
  const [zoom, setZoom] = useState(100);
  const [page, setPage] = useState(1);

  const totalPages = doc.totalPages ?? 1;
  const isPdf = doc.name.toLowerCase().endsWith('.pdf') || doc.fileObject?.type === 'application/pdf';

  function zoomIn() {
    setZoom((z) => Math.min(z + 25, 200));
  }

  function zoomOut() {
    setZoom((z) => Math.max(z - 25, 50));
  }

  function prevPage() {
    setPage((p) => Math.max(p - 1, 1));
  }

  function nextPage() {
    setPage((p) => Math.min(p + 1, totalPages));
  }

  // Build the iframe src with the page anchor for PDFs
  const iframeSrc = doc.fileUrl
    ? isPdf
      ? `${doc.fileUrl}#page=${page}&zoom=${zoom}&toolbar=0&navpanes=0&scrollbar=0`
      : doc.fileUrl
    : null;

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 shrink-0">
        {/* Left: filename + badge */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-gray-800 truncate max-w-xs">{doc.name}</span>
          <StatusBadge status={doc.status} />
        </div>

        {/* Right: zoom controls */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={zoomOut}
            disabled={zoom <= 50}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-6 h-6 text-gray-600" />
          </button>
          <span className="text-sm font-medium text-gray-700 w-12 text-center select-none tabular-nums">
            {zoom}%
          </span>
          <button
            onClick={zoomIn}
            disabled={zoom >= 200}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-6 h-6 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Document render area */}
      <div className="flex-1 overflow-hidden relative">
        {iframeSrc ? (
          <iframe
            key={`${doc.id}-${page}-${zoom}`}
            src={iframeSrc}
            className="w-full h-full border-0"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
              width: zoom > 100 ? `${(100 / zoom) * 100}%` : '100%',
              height: zoom > 100 ? `${(100 / zoom) * 100}%` : '100%',
            }}
            title={doc.name}
          />
        ) : (
          /* No file URL — shouldn't happen after proper import but handle gracefully */
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <FileText className="w-12 h-12 opacity-30" />
            <p className="text-sm">Unable to render document</p>
          </div>
        )}
      </div>

      {/* Bottom pagination — only show for PDFs with known page count */}
      {isPdf && (
        <div className="flex items-center justify-center gap-4 py-4 bg-gray-50 border-t border-gray-100 shrink-0">
          <button
            onClick={prevPage}
            disabled={page <= 1}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-6 h-6 text-gray-600" />
          </button>
          <span className="text-sm text-gray-600 select-none tabular-nums">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={nextPage}
            disabled={page >= totalPages}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next page"
          >
            <ChevronRight className="w-6 h-6 text-gray-600" />
          </button>
        </div>
      )}
    </div>
  );
}