/**
 * Sign in to AJIO and return the harvested jar.
 *
 * @param {{ username: string, password: string, loginUrl?: string }} credentials
 * @param {{ headless?: boolean, fetchOtp?: Function|null, otpMailDelayMs?: number,
 *          otpResends?: number, otpWaitMs?: number }} [options] the OTP fields
 *          are passed to `login()` — see ./mfa.js `answerAjioMfa`.
 * @returns {Promise<{ jar: Array, cookieNames: string[] }>}
 */
export function loginAjioApi(credentials: {
    username: string;
    password: string;
    loginUrl?: string;
}, options?: {
    headless?: boolean;
    fetchOtp?: Function | null;
    otpMailDelayMs?: number;
    otpResends?: number;
    otpWaitMs?: number;
}): Promise<{
    jar: any[];
    cookieNames: string[];
}>;
