import React, { useState } from 'react';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { AuthAlert, AuthSubmitButton, AuthTextField, AuthTextLink } from './AuthFormControls';
import { validateEmail } from './authValidation';
import { useAuth } from '../../store/authContext';
import { authService } from '../../services/authService';

/** POST /auth/forgot-password — emails a reset link valid for 5 minutes. */
export function ForgotPasswordPage() {
  const { goTo, prefillEmail } = useAuth();
  const [email, setEmail] = useState(prefillEmail);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emailError = validateEmail(email);
    setError(emailError);
    setFormError('');
    if (emailError) return;

    setIsSubmitting(true);
    try {
      await authService.requestPasswordReset(email.trim());
      setSentTo(email.trim());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to send reset link. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const footer = (
    <AuthTextLink onClick={() => goTo('login', { email: email.trim() })} disabled={isSubmitting}>
      <span className="inline-flex items-center gap-1.5">
        <ArrowLeft className="w-4 h-4" />
        Back to sign in
      </span>
    </AuthTextLink>
  );

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={footer}>
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
            <MailCheck className="w-7 h-7 text-[#059669]" />
          </div>
          <p className="text-sm text-gray-500 leading-relaxed mb-6">
            If an account exists for <span className="font-semibold text-gray-900">{sentTo}</span>, we&apos;ve
            sent a password reset link. It expires in 5 minutes. Copy the link from the email and paste it on
            the next screen.
          </p>

          <button
            type="button"
            onClick={() => goTo('reset_password', { email: sentTo })}
            className="w-full h-14 flex items-center justify-center cursor-pointer bg-[#059669] hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
          >
            I have the reset link
          </button>
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="mt-3 text-sm font-medium text-gray-500 hover:text-gray-700 cursor-pointer transition-colors"
          >
            Use a different email
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter the email you use for ConfiShare and we'll send you a reset link."
      footer={footer}
    >
      <form onSubmit={handleSubmit} noValidate>
        {formError && <AuthAlert kind="error">{formError}</AuthAlert>}

        <AuthTextField
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          disabled={isSubmitting}
          error={error}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          autoFocus
        />

        <div className="mt-6">
          <AuthSubmitButton isLoading={isSubmitting} loadingLabel="Sending link...">
            Send reset link
          </AuthSubmitButton>
        </div>
      </form>
    </AuthLayout>
  );
}
