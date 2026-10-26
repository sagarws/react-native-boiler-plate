import { hasErrors, validateLogin } from '../login.validation';

const valid = {
  email: 'user@example.com',
  password: 'secret',
};

describe('validateLogin', () => {
  it('accepts a complete form', () => {
    expect(hasErrors(validateLogin(valid))).toBe(false);
  });

  it('rejects a missing email', () => {
    expect(validateLogin({ ...valid, email: '  ' }).email).toBe('auth.errors.emailRequired');
  });

  it('rejects a malformed email', () => {
    expect(validateLogin({ ...valid, email: 'not-an-email' }).email).toBe(
      'auth.errors.emailInvalid',
    );
  });

  it('rejects an empty password without trimming it', () => {
    // A password of spaces is a legitimate password; only truly empty fails.
    expect(validateLogin({ ...valid, password: '' }).password).toBe(
      'auth.errors.passwordRequired',
    );
    expect(validateLogin({ ...valid, password: '   ' }).password).toBeUndefined();
  });

  it('reports every invalid field at once rather than one at a time', () => {
    const errors = validateLogin({ email: '', password: '' });
    expect(Object.keys(errors).sort()).toEqual(['email', 'password']);
  });
});
