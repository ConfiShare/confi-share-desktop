import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { AuthAlert, AuthSubmitButton, AuthTextField, AuthTextLink } from './AuthFormControls';
import { validateEmail, validateOtp } from './authValidation';
import { useAuth } from '../../store/authContext';
import { authService } from '../../services/authService';

/** POST /auth/verify-email with the 5-digit code; "Resend" = POST /auth/resend-otp. */
export function VerifyEmailPage() {
  const { goTo, notice, prefillEmail } = useAuth();
  const [email, setEmail] = useState(prefillEmail);
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; code?: string | null }>({});
  const [formError, setFormError] = useState('');
  const [info, setInfo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors = { email: validateEmail(email), code: validateOtp(code) };
    setErrors(nextErrors);
    setFormError('');
    setInfo('');
    if (nextErrors.email || nextErrors.code) return;

    setIsSubmitting(true);
    try {
      await authService.verifyEmail(email.trim(), code.trim());
      goTo('login', {
        email: email.trim(),
        notice: { kind: 'success', message: 'Email verified. Sign in to continue.' },
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to verify your email. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    const emailError = validateEmail(email);
    setErrors({ email: emailError });
    setFormError('');
    setInfo('');
    if (emailError) return;

    setIsResending(true);
    try {
      await authService.resendVerificationCode(email.trim());
      setInfo(`A new code was sent to ${email.trim()}. It is valid for 5 minutes.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to resend the code. Please try again.');
    } finally {
      setIsResending(false);
    }
  }

  const busy = isSubmitting || isResending;

  return (
    <AuthLayout
      title="Verify your email"
      subtitle="Enter the 5-digit code we emailed you. You need to verify before signing in."
      footer={
        <AuthTextLink onClick={() => goTo('login', { email: email.trim() })} disabled={busy}>
          <span className="inline-flex items-center gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Back to sign in
          </span>
        </AuthTextLink>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {notice && !info && !formError && <AuthAlert kind={notice.kind}>{notice.message}</AuthAlert>}
        {info && <AuthAlert kind="success">{info}</AuthAlert>}
        {formError && <AuthAlert kind="error">{formError}</AuthAlert>}

        <AuthTextField
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          disabled={busy}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((prev) => ({ ...prev, email: null }));
          }}
        />

        <AuthTextField
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="5-digit code"
          maxLength={5}
          value={code}
          disabled={busy}
          error={errors.code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ''));
            setErrors((prev) => ({ ...prev, code: null }));
          }}
          autoFocus
        />

        <div className="flex justify-end -mt-1 mb-6 text-sm">
          <AuthTextLink onClick={handleResend} disabled={busy}>
            {isResending ? 'Sending...' : 'Resend code'}
          </AuthTextLink>
        </div>

        <AuthSubmitButton isLoading={isSubmitting} loadingLabel="Verifying...">
          Verify email
        </AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}
