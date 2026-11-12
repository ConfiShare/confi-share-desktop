import React, { useState } from 'react';
import { ArrowLeft, CircleCheck } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import {
  AuthAlert,
  AuthSubmitButton,
  AuthTextField,
  AuthTextLink,
  PasswordField,
  PasswordRequirements,
} from './AuthFormControls';
import {
  parseResetInput,
  validateEmail,
  validateNewPassword,
  validatePasswordConfirmation,
} from './authValidation';
import { useAuth } from '../../store/authContext';
import { authService } from '../../services/authService';

type Field = 'email' | 'link' | 'password' | 'confirm';

/** POST /auth/reset-password { email, token, newPassword }. */
export function ResetPasswordPage() {
  const { goTo, prefillEmail } = useAuth();
  const [email, setEmail] = useState(prefillEmail);
  const [link, setLink] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string | null>>>({});
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  function clearError(field: Field) {
    setErrors((prev) => ({ ...prev, [field]: null }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseResetInput(link);
    const resolvedEmail = (email.trim() || parsed.email || '').trim();
    const nextErrors = {
      email: validateEmail(resolvedEmail),
      link: parsed.token ? null : 'Paste the reset link (or token) from the email',
      password: validateNewPassword(password),
      confirm: validatePasswordConfirmation(password, confirm),
    };
    setErrors(nextErrors);
    setFormError('');
    if (Object.values(nextErrors).some(Boolean)) return;

    setIsSubmitting(true);
    try {
      await authService.resetPassword({ email: resolvedEmail, token: parsed.token, newPassword: password });
      setEmail(resolvedEmail);
      setPassword('');
      setConfirm('');
      setIsDone(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to reset your password. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function backToLogin(withSuccess: boolean) {
    goTo('login', {
      email: email.trim(),
      notice: withSuccess
        ? { kind: 'success', message: 'Your password has been reset. Sign in with your new password.' }
        : undefined,
    });
  }

  if (isDone) {
    return (
      <AuthLayout title="Password reset">
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
            <CircleCheck className="w-7 h-7 text-[#059669]" />
          </div>
          <p className="text-sm text-gray-500 leading-relaxed mb-6">
            Your password has been updated. You can now sign in with your new password.
          </p>
          <button
            type="button"
            onClick={() => backToLogin(true)}
            className="w-full h-14 flex items-center justify-center cursor-pointer bg-[#059669] hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
          >
            Back to sign in
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Paste the reset link from your email (valid for 5 minutes) and choose a new password."
      footer={
        <AuthTextLink onClick={() => backToLogin(false)} disabled={isSubmitting}>
          <span className="inline-flex items-center gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Back to sign in
          </span>
        </AuthTextLink>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {formError && <AuthAlert kind="error">{formError}</AuthAlert>}

        <AuthTextField
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          disabled={isSubmitting}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError('email');
          }}
        />

        <AuthTextField
          label="Reset link or token"
          placeholder="Paste the link from the email"
          value={link}
          disabled={isSubmitting}
          error={errors.link}
          onChange={(e) => {
            setLink(e.target.value);
            clearError('link');
          }}
          autoFocus
        />

        <PasswordField
          label="New password"
          autoComplete="new-password"
          placeholder="Create a new password"
          value={password}
          disabled={isSubmitting}
          error={errors.password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearError('password');
          }}
        />
        <PasswordRequirements password={password} />

        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          placeholder="Re-enter your new password"
          value={confirm}
          disabled={isSubmitting}
          error={errors.confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            clearError('confirm');
          }}
        />

        <div className="mt-6">
          <AuthSubmitButton isLoading={isSubmitting} loadingLabel="Resetting password...">
            Reset password
          </AuthSubmitButton>
        </div>
      </form>
    </AuthLayout>
  );
}
