import { useAuth } from '../../store/authContext';
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';
import { VerifyEmailPage } from './VerifyEmailPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';

/** Renders the active auth screen. `key` resets form state on navigation. */
export function AuthScreens() {
  const { screen } = useAuth();

  switch (screen) {
    case 'signup':
      return <SignupPage key="signup" />;
    case 'verify_email':
      return <VerifyEmailPage key="verify" />;
    case 'forgot_password':
      return <ForgotPasswordPage key="forgot" />;
    case 'reset_password':
      return <ResetPasswordPage key="reset" />;
    case 'login':
    default:
      return <LoginPage key="login" />;
  }
}
