import React from 'react';
import { Info } from 'lucide-react';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Full-window wrapper for the authentication screens. Uses the same card
 * treatment as the app's Modal (white, rounded-2xl, 2rem padding) on the
 * gray-50 background used by the main content area.
 */
export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="emerald-scrollbar h-screen w-screen overflow-y-auto bg-gray-50">
      <div
        className="min-h-full flex flex-col items-center justify-center"
        style={{ padding: '2rem 1rem' }}
      >
        <img src="./logo-dark.svg" alt="Confi Share Logo" className="w-46 mb-6" />

        <div
          className="w-full max-w-[440px] bg-white rounded-2xl shadow-sm border border-gray-100"
          style={{ padding: '2rem' }}
        >
          <h1 className="text-[1.125rem] font-semibold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-1 leading-relaxed">{subtitle}</p>}
          <hr className="text-gray-300 my-5" />
          {children}
        </div>

        {footer && <div className="mt-5 text-sm text-gray-500 text-center">{footer}</div>}

        <div
          className="mt-6 flex items-center gap-2 text-xs text-gray-400 bg-white border border-gray-100 rounded-full"
          style={{ padding: '0.35rem 0.85rem' }}
          role="note"
        >
          <Info className="w-3.5 h-3.5 shrink-0" />
          Document senders can see when you open their documents, from which device and IP address.
        </div>
      </div>
    </div>
  );
}
