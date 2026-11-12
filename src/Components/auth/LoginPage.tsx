import React, { useState } from 'react';
import { AuthLayout } from './AuthLayout';
import { AuthAlert, AuthSubmitButton, AuthTextField, AuthTextLink, PasswordField } from './AuthFormControls';
import { validateEmail, validateLoginPassword } from './authValidation';
import { useAuth } from '../../store/authContext';
import { authService } from '../../services/authService';

export function LoginPage() {
  const { goTo, completeLogin, notice, prefillEmail } = useAuth();
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors = { email: validateEmail(email), password: validateLoginPassword(password) };
    setErrors(nextErrors);
    setFormError('');
    if (nextErrors.email || nextErrors.password) return;

    setIsSubmitting(true);
    try {
      const session = await authService.login({ email: email.trim(), password });
      setPassword('');
      await completeLogin(session);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // The API refuses login until the email is verified; offer the code screen.
  const looksUnverified = /verif/i.test(formError);

  return (
    <AuthLayout
      title="Sign in to ConfiShare"
      subtitle="Access and manage your protected documents."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <AuthTextLink onClick={() => goTo('signup', { email: email.trim() })} disabled={isSubmitting}>
            Create account
          </AuthTextLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {notice && <AuthAlert kind={notice.kind}>{notice.message}</AuthAlert>}
        {formError && (
          <AuthAlert kind="error">
            {formError}
            {looksUnverified && (
              <>
                {' '}
                <AuthTextLink onClick={() => goTo('verify_email', { email: email.trim() })}>
                  Verify your email
                </AuthTextLink>
              </>
            )}
          </AuthAlert>
        )}
        {!formError && (
          <AuthAlert kind="info">
            Sign in once while online. After that you can open your documents offline, and document
            opens are recorded under your account.
          </AuthAlert>
        )}

        <AuthTextField
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          disabled={isSubmitting}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((prev) => ({ ...prev, email: null }));
          }}
          autoFocus
        />

        <PasswordField
          label="Password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          disabled={isSubmitting}
          error={errors.password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((prev) => ({ ...prev, password: null }));
          }}
        />

        <div className="flex justify-end -mt-1 mb-6 text-sm">
          <AuthTextLink
            onClick={() => goTo('forgot_password', { email: email.trim() })}
            disabled={isSubmitting}
          >
            Forgot password?
          </AuthTextLink>
        </div>

        <AuthSubmitButton isLoading={isSubmitting} loadingLabel="Signing in...">
          Sign in
        </AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}
