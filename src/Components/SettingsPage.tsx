import { ChevronRight, Mail, ArrowLeft } from "lucide-react";

interface SettingsPageProps {
  onBack: () => void;
}

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <div className="mb-2">
      <p className="text-base text-gray-400 font-normal mb-3 px-1">{title}</p>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-100">
        {children}
      </div>
    </div>
  );
}

interface SettingsRowProps {
  title: string;
  description: string;
  onClick?: () => void;
  children?: React.ReactNode;
}

function SettingsRow({
  title,
  description,
  onClick,
  children,
}: SettingsRowProps) {
  const isClickable = !!onClick;

  return (
    <div
      onClick={onClick}
      style={{ padding: "0.6rem" }}
      className={`flex items-center justify-between px-6 py-4 ${
        isClickable ? "cursor-pointer hover:bg-gray-50 transition-colors" : ""
      }`}
    >
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-base font-semibold text-gray-900 mb-1">{title}</p>
        <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
        {children}
      </div>
      {isClickable && (
        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
      )}
    </div>
  );
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-gray-100 shrink-0">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-4 h-4 text-gray-700" />
        </button>
        <h1 className="text-base font-semibold text-gray-900">About ConfiShare</h1>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto">
          {/* Security */}
          <SettingsSection title="Security">
            <SettingsRow
              title="How security works"
              description="Every document is protected with a unique access code. Only recipients with the correct code can view the document contents."
            />
          </SettingsSection>

          {/* Support */}
          <SettingsSection title="Support">
            <SettingsRow
              title="Help & Support"
              description="Need help opening a document or renewing access? Our support team is here to help you"
            >
              <a
                href="mailto:support@confishare.io"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center font-medium justify-between gap-1.5 mt-2 text-sm text-[#059669] hover:text-green-700 transition-colors"
              >
                <Mail className="w-5 h-5" />
                support@confishare.io
              </a>
            </SettingsRow>
          </SettingsSection>

          {/* Legal */}
          <SettingsSection title="Legal">
            <SettingsRow
              title="Privacy Policy"
              description="Learn how we handle your data and protect your privacy."
              onClick={() =>
                window.open("https://confishare.io/terms-of-service/", "_blank")
              }
            />
            <SettingsRow
              title="Terms of Service"
              description="Read the terms that govern your use of Confishare"
              onClick={() =>
                window.open("https://confishare.io/policy/", "_blank")
              }
            />
          </SettingsSection>

          {/* More Info */}
          <SettingsSection title="More Info">
            <SettingsRow
              title="More Info"
              description="Confishare is a secure document viewer designed to give you trusted, controlled access to sensitive files across desktop devices."
            />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
