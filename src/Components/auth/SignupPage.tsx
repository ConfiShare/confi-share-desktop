import React, { useState } from 'react';
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
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
} from './authValidation';
import { useAuth } from '../../store/authContext';
import { authService } from '../../services/authService';

type Field = 'firstName' | 'lastName' | 'email' | 'password' | 'confirm' | 'terms';
type FieldErrors = Partial<Record<Field, string | null>>;

export function SignupPage() {
  const { goTo, prefillEmail } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function clearError(field: Field) {
    setErrors((prev) => ({ ...prev, [field]: null }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors: FieldErrors = {
      firstName: validateName(firstName, 'first name'),
      lastName: validateName(lastName, 'last name'),
      email: validateEmail(email),
      password: validateNewPassword(password),
      confirm: validatePasswordConfirmation(password, confirm),
      terms: acceptedTerms ? null : 'Please accept the Terms of Service and Privacy Policy',
    };
    setErrors(nextErrors);
    setFormError('');
    if (Object.values(nextErrors).some(Boolean)) return;

    setIsSubmitting(true);
    try {
      await authService.signup({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
      });
      setPassword('');
      setConfirm('');
      goTo('verify_email', {
        email: email.trim(),
        notice: { kind: 'success', message: `Account created. We sent a 5-digit code to ${email.trim()}.` },
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create your account. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Use the email address your documents are shared to."
      footer={
        <>
          Already have an account?{' '}
          <AuthTextLink onClick={() => goTo('login', { email: email.trim() })} disabled={isSubmitting}>
            Sign in
          </AuthTextLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {formError && <AuthAlert kind="error">{formError}</AuthAlert>}

        <div className="grid grid-cols-2 gap-x-3">
          <AuthTextField
            label="First name"
            autoComplete="given-name"
            placeholder="First name"
            value={firstName}
            disabled={isSubmitting}
            error={errors.firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              clearError('firstName');
            }}
            autoFocus
          />
          <AuthTextField
            label="Last name"
            autoComplete="family-name"
            placeholder="Last name"
            value={lastName}
            disabled={isSubmitting}
            error={errors.lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              clearError('lastName');
            }}
          />
        </div>

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
            clearError('email');
          }}
        />

        <PasswordField
          label="Password"
          autoComplete="new-password"
          placeholder="Create a password"
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
          label="Confirm password"
          autoComplete="new-password"
          placeholder="Re-enter your password"
          value={confirm}
          disabled={isSubmitting}
          error={errors.confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            clearError('confirm');
          }}
        />

        <div className="mb-6">
          <label className="flex items-start gap-2.5 text-xs text-gray-500 leading-relaxed cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedTerms}
              disabled={isSubmitting}
              onChange={(e) => {
                setAcceptedTerms(e.target.checked);
                clearError('terms');
              }}
              className="mt-0.5 w-4 h-4 accent-[#059669] cursor-pointer"
            />
            <span>
              I agree to the{' '}
              <a
                href="https://confishare.io/policy/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[#059669] hover:text-green-700"
              >
                Terms of Service
              </a>{' '}
              and{' '}
              <a
                href="https://confishare.io/terms-of-service/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[#059669] hover:text-green-700"
              >
                Privacy Policy
              </a>
              .
            </span>
          </label>
          {errors.terms && <p className="text-xs text-red-500 mt-1.5">{errors.terms}</p>}
        </div>

        <AuthSubmitButton isLoading={isSubmitting} loadingLabel="Creating account...">
          Create account
        </AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}
