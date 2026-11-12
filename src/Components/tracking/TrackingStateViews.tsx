import React from 'react';
import { Loader2, ShieldAlert, RotateCw, Info } from 'lucide-react';

export function TrackingLoadingState({ label = 'Loading activity...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center" style={{ padding: '2.5rem 1rem' }}>
      <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export function TrackingEmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: '2.5rem 1rem' }}>
      <div className="w-12 h-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="text-sm font-medium text-gray-700">{title}</p>
      <p className="text-xs text-gray-400 mt-1 max-w-xs leading-relaxed">{description}</p>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function TrackingErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: '2.5rem 1rem' }}>
      <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center mb-3">
        <ShieldAlert className="w-6 h-6" />
      </div>
      <p className="text-sm font-medium text-gray-700">Couldn&apos;t load tracking data</p>
      <p className="text-xs text-gray-400 mt-1 max-w-xs leading-relaxed">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#059669] hover:text-green-700 cursor-pointer transition-colors"
        >
          <RotateCw className="w-4 h-4" />
          Try again
        </button>
      )}
    </div>
  );
}

/** Neutral info note (e.g. what the document sender can see). */
export function TrackingInfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-xl bg-gray-100 text-xs text-gray-500 leading-relaxed"
      style={{ padding: '0.6rem 0.85rem' }}
    >
      <Info className="w-4 h-4 shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}
