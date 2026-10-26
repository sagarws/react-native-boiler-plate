export interface LoginFormValues {
  email: string;
  password: string;
}

export type LoginFormErrors = Partial<Record<keyof LoginFormValues, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Field-level validation for the login form. Returns an i18n key per invalid
 * field so the screen decides the wording.
 */
export function validateLogin(values: LoginFormValues): LoginFormErrors {
  const errors: LoginFormErrors = {};

  const email = values.email.trim();
  if (!email) {
    errors.email = 'auth.errors.emailRequired';
  } else if (!EMAIL_RE.test(email)) {
    errors.email = 'auth.errors.emailInvalid';
  }

  if (!values.password) {
    errors.password = 'auth.errors.passwordRequired';
  }

  return errors;
}

export function hasErrors(errors: LoginFormErrors): boolean {
  return Object.keys(errors).length > 0;
}
