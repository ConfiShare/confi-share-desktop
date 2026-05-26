import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  FileText,
  Loader2,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

// Robust worker loading for Vite + TypeScript under Electron.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).toString();

interface PdfViewerProps {
  pdfData: Uint8Array | string; // ArrayBuffer/Uint8Array or Blob URL
  fileName: string;
  onPageChange?: (page: number, total: number) => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

/**
 * Individual virtualised PDF Page component.
 * Renders a placeholder of the exact dimensions, and only draws the high-DPI canvas once visible in viewport.
 */
interface PdfPageProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  isFullWidth: boolean;
  parentWidth: number;
  onVisible: (pageNumber: number) => void;
}

const PdfPage: React.FC<PdfPageProps> = React.memo(({
  pdfDoc,
  pageNumber,
  scale,
  isFullWidth,
  parentWidth,
  onVisible,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);

  // 1. Get original page dimensions on load to reserve exact visual space
  useEffect(() => {
    let active = true;
    pdfDoc.getPage(pageNumber).then((page) => {
      if (!active) return;
      const viewport = page.getViewport({ scale: 1 });
      setDimensions({ width: viewport.width, height: viewport.height });
    }).catch(err => {
      console.error(`Error loading page ${pageNumber} viewport:`, err);
    });
    return () => { active = false; };
  }, [pdfDoc, pageNumber]);

  // 2. Set up Intersection Observer for lazy rendering
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          setIsVisible(true);
          onVisible(pageNumber);
        } else {
          setIsVisible(false);
        }
      },
      { threshold: 0.1, rootMargin: '200px' } // Pre-render 200px before scrolling into view
    );

    if (pageRef.current) {
      observer.observe(pageRef.current);
    }

    return () => observer.disconnect();
  }, [pageNumber, onVisible]);

  // Compute calculated dimensions based on scale and layout constraints
  const displaySize = useMemo(() => {
    if (!dimensions) return { width: 300, height: 400, scale: scale };

    if (isFullWidth) {
      // Scale page to fit parent container width exactly, subtracting scrollbar/padding buffers
      const fitScale = (parentWidth - 48) / dimensions.width;
      return {
        width: parentWidth - 48,
        height: dimensions.height * fitScale,
        scale: fitScale,
      };
    }

    return {
      width: dimensions.width * scale,
      height: dimensions.height * scale,
      scale: scale,
    };
  }, [dimensions, scale, isFullWidth, parentWidth]);

  // 3. Render page canvas once it is visible and has dimensions
  useEffect(() => {
    if (!isVisible || !dimensions || !canvasRef.current) {
      // Keep rendered canvas if we want to cache, but cancel active rendering if scrolls out
      return;
    }

    let active = true;

    async function drawPage() {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (!active || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Cancel previous rendering task if it was still active
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        // Setup High DPI rendering scale
        const renderScale = displaySize.scale * window.devicePixelRatio;
        const viewport = page.getViewport({ scale: renderScale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${displaySize.width}px`;
        canvas.style.height = `${displaySize.height}px`;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        if (active) {
          setIsRendered(true);
        }
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error(`Page ${pageNumber} rendering failed:`, err);
        }
      }
    }

    drawPage();

    return () => {
      active = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [isVisible, dimensions, displaySize, pdfDoc, pageNumber]);

  return (
    <div
      ref={pageRef}
      className="relative bg-white shadow-md rounded border border-gray-200 transition-shadow hover:shadow-lg flex items-center justify-center select-none"
      style={{
        width: `${displaySize.width}px`,
        height: `${displaySize.height}px`,
        margin: '16px auto',
      }}
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none select-none"
        style={{
          width: `${displaySize.width}px`,
          height: `${displaySize.height}px`,
          display: isRendered ? 'block' : 'none',
        }}
      />
      {!isRendered && (
        <div className="absolute inset-0 bg-gray-50 flex flex-col items-center justify-center animate-pulse gap-2 rounded">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
          <span className="text-xs text-gray-400 font-medium">Loading Page {pageNumber}...</span>
        </div>
      )}
    </div>
  );
});

PdfPage.displayName = 'PdfPage';

export function PdfViewer({ pdfData, fileName, onPageChange }: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1.0);
  const [isFullWidth, setIsFullWidth] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(800);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  // 1. Initialise and load document
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPdfDoc(null);

    // If source is base64 string or file path, handle appropriately
    const loadingTask = pdfjsLib.getDocument(
      pdfData instanceof Uint8Array ? { data: pdfData } : pdfData
    );

    loadingTask.promise.then(
      (loadedDoc) => {
        if (!active) return;
        setPdfDoc(loadedDoc);
        setNumPages(loadedDoc.numPages);
        setLoading(false);
        if (onPageChange) onPageChange(1, loadedDoc.numPages);
      },
      (err) => {
        if (!active) return;
        console.error('Failed to load PDF document:', err);
        setError('Failed to open document. The file may be corrupted or invalid.');
        setLoading(false);
      }
    );

    return () => {
      active = false;
      loadingTask.destroy();
    };
  }, [pdfData, onPageChange]);

  // 2. Compute fit to container size
  const updateContainerWidth = useCallback(() => {
    if (scrollAreaRef.current) {
      setContainerWidth(scrollAreaRef.current.clientWidth);
    }
  }, []);

  useEffect(() => {
    updateContainerWidth();
    window.addEventListener('resize', updateContainerWidth);
    
    // ResizeObserver for accurate sizing inside dynamic flexbox grids
    let observer: ResizeObserver | null = null;
    if (scrollAreaRef.current) {
      observer = new ResizeObserver(() => updateContainerWidth());
      observer.observe(scrollAreaRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateContainerWidth);
      if (observer) observer.disconnect();
    };
  }, [updateContainerWidth]);

  // 3. Listen to page visibility changes from lazy page renders
  const handlePageVisible = useCallback((pageNumber: number) => {
    setCurrentPage(pageNumber);
    if (onPageChange && pdfDoc) {
      onPageChange(pageNumber, pdfDoc.numPages);
    }
  }, [pdfDoc, onPageChange]);

  // Keyboard navigation & Wheel controls
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (loading || !pdfDoc) return;
    
    const key = e.key;
    if (key === 'ArrowDown') {
      scrollAreaRef.current?.scrollBy({ top: 50, behavior: 'auto' });
    } else if (key === 'ArrowUp') {
      scrollAreaRef.current?.scrollBy({ top: -50, behavior: 'auto' });
    } else if (key === 'PageDown' || key === ' ') {
      e.preventDefault();
      const nextPageNum = Math.min(currentPage + 1, numPages);
      scrollToPage(nextPageNum);
    } else if (key === 'PageUp') {
      e.preventDefault();
      const prevPageNum = Math.max(currentPage - 1, 1);
      scrollToPage(prevPageNum);
    } else if (key === 'Home') {
      e.preventDefault();
      scrollToPage(1);
    } else if (key === 'End') {
      e.preventDefault();
      scrollToPage(numPages);
    }
  }, [currentPage, numPages, loading, pdfDoc]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  function scrollToPage(pageNum: number) {
    const pageEl = pageRefs.current[pageNum];
    if (pageEl && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({
        top: pageEl.offsetTop - 16,
        behavior: 'smooth',
      });
      setCurrentPage(pageNum);
    }
  }

  // Fullscreen management
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement === containerRef.current) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch (err) {
      console.error('Could not toggle full screen mode:', err);
    }
  }

  // Zoom handlers
  function zoomIn() {
    setIsFullWidth(false);
    setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM));
  }

  function zoomOut() {
    setIsFullWidth(false);
    setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM));
  }

  function fitToPage() {
    setIsFullWidth(false);
    setZoom(1.0);
  }

  function fitToWidth() {
    setIsFullWidth(true);
  }

  function handleContainerWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 gap-4 h-full">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-700">Decryption and secure processing active...</p>
          <p className="text-xs text-gray-400 mt-1">Please wait while we render your preview in memory.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6 h-full gap-3">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center text-red-600">
          <FileText className="w-7 h-7" />
        </div>
        <p className="text-sm font-semibold text-gray-800">{error}</p>
        <p className="text-xs text-gray-400 text-center max-w-sm">
          Please verify that the document password is correct or that the source file has not been corrupted.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col h-full bg-[#334155] overflow-hidden select-none relative"
      onContextMenu={(e) => e.preventDefault()}
      onWheel={handleContainerWheel}
    >
      {/* Sleek Dark-Glassmorphic Top Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-[#1e293b]/95 backdrop-blur border-b border-slate-700/60 shadow-md shrink-0 text-white z-10">
        {/* Left: filename info */}
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-sm font-medium truncate max-w-xs text-slate-100">{fileName}</span>
        </div>

        {/* Middle: Page navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => scrollToPage(Math.max(currentPage - 1, 1))}
            disabled={currentPage <= 1}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-5 h-5 text-slate-200" />
          </button>
          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-200 select-none">
            <span className="tabular-nums">{currentPage}</span>
            <span className="text-slate-500">/</span>
            <span className="tabular-nums">{numPages}</span>
          </div>
          <button
            onClick={() => scrollToPage(Math.min(currentPage + 1, numPages))}
            disabled={currentPage >= numPages}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Next page"
          >
            <ChevronRight className="w-5 h-5 text-slate-200" />
          </button>
        </div>

        {/* Right: Zoom + Fullscreen controls */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={fitToPage}
            disabled={zoom === 1.0 && !isFullWidth}
            className="px-2.5 h-8 rounded-lg text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed border border-slate-700/40"
          >
            Fit Page
          </button>
          <button
            onClick={fitToWidth}
            disabled={isFullWidth}
            className={`px-2.5 h-8 rounded-lg text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed border ${
              isFullWidth
                ? 'text-white bg-emerald-600 border-emerald-500 hover:bg-emerald-500'
                : 'text-slate-200 bg-slate-800 border-slate-700/40 hover:bg-slate-700'
            }`}
          >
            Fit Width
          </button>
          <div className="h-4 w-px bg-slate-700" />
          <button
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-4 h-4 text-slate-300" />
          </button>
          <span className="text-xs font-semibold text-slate-300 w-12 text-center select-none tabular-nums">
            {isFullWidth ? 'Auto' : `${Math.round(zoom * 100)}%`}
          </span>
          <button
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-4 h-4 text-slate-300" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700 transition-colors border border-slate-700/40 bg-slate-800 ml-1"
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4 text-slate-200" />
            ) : (
              <Maximize2 className="w-4 h-4 text-slate-200" />
            )}
          </button>
        </div>
      </div>

      {/* Main virtualised scroll viewport area */}
      <div
        ref={scrollAreaRef}
        className="flex-1 overflow-auto bg-[#475569]/90 relative p-4 flex flex-col items-center justify-start scroll-smooth"
        style={{
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
      >
        {pdfDoc &&
          Array.from({ length: numPages }, (_, index) => {
            const pageNum = index + 1;
            return (
              <div
                key={`${pageNum}-${zoom}-${isFullWidth}`}
                ref={(el) => {
                  pageRefs.current[pageNum] = el;
                }}
                className="w-full flex justify-center"
              >
                <PdfPage
                  pdfDoc={pdfDoc}
                  pageNumber={pageNum}
                  scale={zoom}
                  isFullWidth={isFullWidth}
                  parentWidth={containerWidth}
                  onVisible={handlePageVisible}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}
