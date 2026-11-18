/** Where the sign-in is submitted. Absolute, because the page may be on the portal host. */
export const EMAIL_LOGIN_URL: "https://accounts.myntra.com/emaillogin";
/**
 * The per-attempt id the login page is opened with.
 *
 * `cidx=partners_mdirect-<uuid>` — minted by the partner portal when it
 * redirects to accounts.myntra.com, and echoed in both the query string and the
 * body. It cannot be invented: a caller reads it off the page it is already on.
 */
export function readCidx(url: any): string;
/** Is this the page the sign-in can be submitted from? */
export function isLoginPage(url: any): boolean;
/**
 * JavaScript that submits the sign-in from inside the page.
 *
 * Returned as a STRING because that is the one thing every engine here can
 * run: Electron's `webContents.executeJavaScript`, Selenium's
 * `driver.executeScript`, puppeteer's `page.evaluate`. Building it with
 * JSON.stringify rather than interpolation keeps a password containing a quote
 * from turning into a syntax error — or worse, into code.
 *
 * It resolves rather than throws for a non-2xx, because the caller decides what
 * a refusal means; a thrown string across an evaluate boundary loses the status.
 *
 * @param {{ email: string, password: string, cidx: string, pageRequested?: string }} input
 * @returns {string} an expression evaluating to a Promise of {status, ok, body}
 */
export function emailLoginScript({ email, password, cidx, pageRequested }: {
    email: string;
    password: string;
    cidx: string;
    pageRequested?: string;
}): string;
/**
 * What the sign-in response means.
 *
 * `submitted` is NOT "signed in": the response body of a successful login was
 * not recorded in the capture (the devtools could not read it), so nothing here
 * pretends to know its shape. The caller proves the session the way everything
 * else in this package does — by asking the portal — and this only decides
 * whether that is worth doing.
 *
 * @returns {{ outcome: "submitted"|"rejected"|"challenged"|"otp"|"failed", message: string }}
 */
export function interpretLoginResponse(result: any): {
    outcome: "submitted" | "rejected" | "challenged" | "otp" | "failed";
    message: string;
};
