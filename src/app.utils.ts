import type { DocumentStatus } from './types';

export function getStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'active': return 'Active';
    case 'offline': return 'Offline';
    case 'code_expired': return 'Code Expired';
    case 'revoked': return 'Revoked';
    default: return status;
  }
}

export function formatExpiry(date: Date): string {
  const now = new Date();
  const isExpired = date < now;
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  return `Offline access ${isExpired ? 'expired' : 'expires'} ${month} ${day}, ${year}`;
}
