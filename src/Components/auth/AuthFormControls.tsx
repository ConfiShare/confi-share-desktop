import React, { useId, useState } from 'react';
import { Eye, EyeOff, Loader2, CircleCheck, CircleAlert, Info, Check } from 'lucide-react';
import { PASSWORD_RULES } from './authValidation';

const inputBase =
  'w-full h-12 text-sm text-gray-700 rounded-xl placeholder-gray-400 outline-none border transition-colors bg-white disabled:bg-gray-50 disabled:text-gray-400';

function inputBorder(error?: string | null) {
  return error ? 'border-red-400' : 'border-gray-200 focus:border-[#059669]';
}

interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string | null;
}

export function AuthTextField({ label, error, ...inputProps }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-xs text-gray-500 font-medium tracking-wide mb-1.5">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        style={{ padding: '0 1rem' }}
        className={`${inputBase} ${inputBorder(error)}`}
        {...inputProps}
      />
      {error && (
        <p id={errorId} className="text-xs text-red-500 mt-1.5">
          {error}
        </p>
      )}
    </div>
  );
}

type PasswordFieldProps = Omit<TextFieldProps, 'type'>;

export function PasswordField({ label, error, ...inputProps }: PasswordFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const [visible, setVisible] = useState(false);

  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-xs text-gray-500 font-medium tracking-wide mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          style={{ padding: '0 3rem 0 1rem' }}
          className={`${inputBase} ${inputBorder(error)}`}
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer transition-colors"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
        </button>
      </div>
      {error && (
        <p id={errorId} className="text-xs text-red-500 mt-1.5">
          {error}
        </p>
      )}
    </div>
  );
}

/** Live checklist of password requirements. */
export function PasswordRequirements({ password }: { password: string }) {
  return (
    <ul className="-mt-2 mb-4 space-y-1">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-1.5 text-xs ${met ? 'text-[#059669]' : 'text-gray-400'}`}
          >
            <Check className={`w-3.5 h-3.5 ${met ? 'opacity-100' : 'opacity-30'}`} />
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

interface SubmitButtonProps {
  isLoading: boolean;
  loadingLabel: string;
  children: React.ReactNode;
}

export function AuthSubmitButton({ isLoading, loadingLabel, children }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={isLoading}
      className="w-full h-14 flex items-center justify-center gap-2 cursor-pointer bg-[#059669] hover:bg-green-700 active:bg-green-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
    >
      {isLoading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

interface AuthAlertProps {
  kind: 'error' | 'success' | 'info';
  children: React.ReactNode;
}

export function AuthAlert({ kind, children }: AuthAlertProps) {
  const styles = {
    error: { box: 'bg-red-50 text-red-600', Icon: CircleAlert },
    success: { box: 'bg-emerald-50 text-[#047857]', Icon: CircleCheck },
    info: { box: 'bg-gray-50 text-gray-500', Icon: Info },
  }[kind];
  const { Icon } = styles;

  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-xl mb-5 text-xs leading-relaxed ${styles.box}`}
      style={{ padding: '0.75rem 1rem' }}
    >
      <Icon className="w-4 h-4 shrink-0 mt-px" />
      <div>{children}</div>
    </div>
  );
}

interface TextLinkProps {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export function AuthTextLink({ onClick, children, disabled }: TextLinkProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-medium text-[#059669] hover:text-green-700 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}
