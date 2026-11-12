// Client-side validation for the auth forms, matching the API's rules
// (emails must be valid, names min 2 chars, passwords min 6 chars,
// verification codes exactly 5 digits). The API remains the source of truth.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN_LENGTH = 6;

export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (p) => p.length >= PASSWORD_MIN_LENGTH,
  },
];

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return 'Please enter your email address';
  if (!EMAIL_PATTERN.test(value)) return 'Please enter a valid email address';
  return null;
}

/** Login only checks presence; the server decides whether it is correct. */
export function validateLoginPassword(password: string): string | null {
  return password ? null : 'Please enter your password';
}

export function validateNewPassword(password: string): string | null {
  if (!password) return 'Please enter a password';
  const failed = PASSWORD_RULES.find((rule) => !rule.test(password));
  return failed ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters` : null;
}

export function validatePasswordConfirmation(password: string, confirm: string): string | null {
  if (!confirm) return 'Please confirm your password';
  return password === confirm ? null : 'Passwords do not match';
}

export function validateName(name: string, label: string): string | null {
  return name.trim().length >= 2 ? null : `Please enter your ${label} (at least 2 characters)`;
}

export function validateOtp(otp: string): string | null {
  return /^\d{5}$/.test(otp.trim()) ? null : 'Enter the 5-digit code from the email';
}

/**
 * The reset email contains a link like
 * `<site>/reset-password?token=<token>&email=<email>`. Users can paste the
 * whole link or just the token.
 */
export function parseResetInput(input: string): { token: string; email?: string } {
  const value = input.trim();
  if (value.includes('token=')) {
    try {
      const url = new URL(value.startsWith('http') ? value : `https://x/?${value.split('?').pop()}`);
      return {
        token: url.searchParams.get('token') ?? '',
        email: url.searchParams.get('email') ?? undefined,
      };
    } catch {
      // fall through to raw token
    }
  }
  return { token: value };
}
