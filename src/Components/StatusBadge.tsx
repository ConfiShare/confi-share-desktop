import type { DocumentStatus } from "../types";
import { getStatusLabel } from "../store/AppContext";

interface StatusBadgeProps {
  status: DocumentStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const configs: Record<DocumentStatus, { bg: string; text: string }> = {
    active: { bg: "bg-green-100", text: "text-green-500" },
    offline: { bg: "bg-gray-100", text: "text-gray-500" },
    code_expired: { bg: "bg-yellow-50", text: "text-yellow-600" },
    revoked: { bg: "bg-red-100", text: "text-red-500" },
  };

  const { bg, text } = configs[status];

  return (
    <span
    style={{
      padding:"0.1rem 0.3rem"
    }}
      className={`inline-flex items-center px-6 py-4 rounded text-xs font-light ${bg} ${text}`}
    >
      {getStatusLabel(status)}
    </span>
  );
}
