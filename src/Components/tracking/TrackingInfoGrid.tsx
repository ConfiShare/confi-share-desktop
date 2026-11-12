import React from 'react';

export interface TrackingInfoItem {
  label: string;
  value: React.ReactNode;
  /** Span both columns (for long values like document names). */
  wide?: boolean;
}

/** Label/value grid in the same card style as the About page sections. */
export function TrackingInfoGrid({ items }: { items: TrackingInfoItem[] }) {
  return (
    <dl
      className="grid grid-cols-2 gap-x-4 gap-y-3 bg-white rounded-xl border border-gray-100"
      style={{ padding: '0.9rem 1rem' }}
    >
      {items.map((item) => (
        <div key={item.label} className={`min-w-0 ${item.wide ? 'col-span-2' : ''}`}>
          <dt className="text-xs text-gray-400 font-medium tracking-wide mb-0.5">{item.label}</dt>
          <dd className="text-sm font-medium text-gray-900 wrap-break-word">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
