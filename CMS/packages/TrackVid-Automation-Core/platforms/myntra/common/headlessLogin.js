// -----------------------------------------------------------------------------
// Myntra — signing in without a display
// -----------------------------------------------------------------------------
// WHY MYNTRA IS THE ONE LOGIN THAT NEEDED A SCREEN. Its LOG IN button ignores a
// synthetic click, so the Selenium runner finishes the sign-in with an
// OS-LEVEL MOUSE CLICK at screen coordinates (see platforms/myntra/common/osClickElement). A headless
// browser has no window to click, which is why `buildDriver` refuses to run
// headless and says so out loud.
//
// WHAT THE CLICK ACTUALLY DOES, from a capture of a successful sign-in
// (api-network-records (13).json, 2026-09-19) — one plain JSON request:
//
//   POST https://accounts.myntra.com/emaillogin?cidx=partners_mdirect-<uuid>&pageRequested=<portal>
//   {"email":"…","password":"…","cidx":"partners_mdirect-<uuid>","state":""}
//
// No captcha token. No Akamai sensor payload. No OTP. No cookie header on the
// request at all. Checked across all 54 requests in that capture: `_abck`,
// `bm_sv`, `bm_sz`, `ak_bmsc` and `sensor_data` appear zero times.
//
// So the click is not the point — the request is. Issue it from INSIDE the
// loaded login page and the display requirement disappears with the click.
//
// AND IT SIDESTEPS THE OTHER KNOWN BLOCKER. This package already records that
// "Akamai on accounts.myntra.com hard-blocks pure Node HTTP at the TLS-handshake
// level — verified by empty 60s timeouts" (see master-import/apiReportFlow).
// That is why a plain axios POST is not an option and never was. A fetch from
// within the page leaves on Chrome's own TLS handshake, with the page's origin
// and referer, which is the request Akamai already let through.
//
// NO BROWSER IS OWNED HERE, deliberately. The two consumers drive different
// engines — Trackvid-CMS an Electron BrowserWindow, Automated-Scripts
// Selenium — so this exposes the STEPS as code to evaluate and pure functions
// to read the answers, in the same shape common/loginForms.js is consumed. The
// caller keeps its own browser, its own cookie partition and its own harvest.
//
// RECAPTCHA IS LOADED ON THAT PAGE (recaptcha/api.js shows up in the capture's
// performance trace) and the successful login sent no token, so it is invisible
// or on-suspicion rather than required. Headless is exactly what raises
// suspicion, which is why `interpretLoginResponse` reports a challenge as its
// own outcome and the caller falls back to the visible path instead of
// retrying into a wall.
// -----------------------------------------------------------------------------

/** Where the sign-in is submitted. Absolute, because the page may be on the portal host. */
const EMAIL_LOGIN_URL = "https://accounts.myntra.com/emaillogin";

/**
 * The per-attempt id the login page is opened with.
 *
 * `cidx=partners_mdirect-<uuid>` — minted by the partner portal when it
 * redirects to accounts.myntra.com, and echoed in both the query string and the
 * body. It cannot be invented: a caller reads it off the page it is already on.
 */
function readCidx(url) {
    try {
        return new URL(String(url)).searchParams.get("cidx") || "";
    } catch (_) {
        const match = /[?&]cidx=([^&#]+)/.exec(String(url || ""));

        return match ? decodeURIComponent(match[1]) : "";
    }
}

/** Is this the page the sign-in can be submitted from? */
function isLoginPage(url) {
    return /accounts\.myntra\.com\/emaillogin/i.test(String(url || ""));
}

const quote = (value) => JSON.stringify(String(value ?? ""));

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
function emailLoginScript({ email, password, cidx, pageRequested = "" }) {
    const query = `?cidx=${encodeURIComponent(cidx)}` +
        (pageRequested ? `&pageRequested=${encodeURIComponent(pageRequested)}` : "");

    return `(async () => {
  try {
    const res = await fetch(${quote(EMAIL_LOGIN_URL + query)}, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/plain, */*" },
      body: JSON.stringify({
        email: ${quote(email)},
        password: ${quote(password)},
        cidx: ${quote(cidx)},
        state: ""
      })
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, body: text.slice(0, 2000) };
  } catch (err) {
    return { status: 0, ok: false, body: String(err && err.message ? err.message : err) };
  }
})()`;
}

/** Phrases Myntra answers a refused sign-in with. Matched on the response text. */
const WRONG_CREDENTIALS = /invalid (?:email|password|credentials)|incorrect password|user (?:does not exist|not found)|please enter valid/i;
const CHALLENGE = /captcha|recaptcha|verify (?:you|that you)|too many attempts|blocked|unusual activity/i;
const OTP_WANTED = /\botp\b|one[- ]time (?:password|code)|verification code/i;

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
function interpretLoginResponse(result) {
    const status = Number(result && result.status) || 0;
    const body = String((result && result.body) || "");

    if (CHALLENGE.test(body)) {
        return {
            outcome: "challenged",
            message: "Myntra asked for a captcha — a headless sign-in cannot answer one",
        };
    }

    if (OTP_WANTED.test(body)) {
        return {
            outcome: "otp",
            message: "Myntra asked for a one-time code after the password",
        };
    }

    if (status === 0) {
        return { outcome: "failed", message: `The sign-in request did not complete: ${body.slice(0, 200)}` };
    }

    if (status === 401 || status === 403 || WRONG_CREDENTIALS.test(body)) {
        return { outcome: "rejected", message: "Myntra refused the email and password" };
    }

    if (status >= 500) {
        return { outcome: "failed", message: `Myntra answered HTTP ${status}` };
    }

    if (status >= 400) {
        return { outcome: "failed", message: `Myntra answered HTTP ${status}: ${body.slice(0, 200)}` };
    }

    return { outcome: "submitted", message: "Sign-in submitted" };
}

module.exports = {
    EMAIL_LOGIN_URL,
    readCidx,
    isLoginPage,
    emailLoginScript,
    interpretLoginResponse,
};
