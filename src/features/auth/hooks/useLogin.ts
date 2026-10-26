import { useCallback, useState } from 'react';
import { login } from '@/features/session';
import { ApiError } from '@/services/api';
import { logger } from '@/shared/utils';
import {
  hasErrors,
  validateLogin,
  type LoginFormErrors,
  type LoginFormValues,
} from '../validation/login.validation';

interface UseLoginResult {
  submitting: boolean;
  /**
   * Set when the last submit failed server-side or in transport. `message` is
   * the backend's user-facing copy, or null when there is none (network
   * failure) and the screen should show a generic message.
   */
  formError: { message: string | null } | null;
  fieldErrors: LoginFormErrors;
  submit: (values: LoginFormValues) => Promise<boolean>;
  clearErrors: () => void;
}

/** The backend's user-facing copy from a failed request, if it sent any. */
function serverMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as
    | { displayMessage?: string; message?: string }
    | undefined;
  return body?.displayMessage ?? body?.message ?? null;
}

/** Drives the login form: validates, calls the API, surfaces errors. */
export function useLogin(): UseLoginResult {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<{ message: string | null } | null>(
    null,
  );
  const [fieldErrors, setFieldErrors] = useState<LoginFormErrors>({});

  const clearErrors = useCallback(() => {
    setFormError(null);
    setFieldErrors({});
  }, []);

  const submit = useCallback(
    async (values: LoginFormValues): Promise<boolean> => {
      const errors = validateLogin(values);
      setFieldErrors(errors);
      setFormError(null);
      if (hasErrors(errors)) return false;

      setSubmitting(true);
      try {
        await login({ email: values.email.trim(), password: values.password });
        return true;
      } catch (err) {
        logger.error('login failed', err);
        // Transport failures carry no server message; the screen falls back to
        // a generic string for those.
        setFormError({ message: serverMessage(err) });
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  return { submitting, formError, fieldErrors, submit, clearErrors };
}
