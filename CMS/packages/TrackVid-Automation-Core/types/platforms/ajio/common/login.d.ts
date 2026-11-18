/**
 * Returns { ok: true } on a completed login (fresh SSO or reused session) and
 * { ok: false, error, reason } when it did not complete. It still THROWS AjioCredentialError for a
 * rejected credential. Callers that pass a throwaway `failedUsers` array (the claim scripts) must
 * check the returned result — otherwise a swallowed failure reads as a successful login.
 */
export function login(page: any, user: any, TEMP_FILE_PATH: any, failedUsers: any, numberOfObject: any, options?: {}): Promise<{
    ok: boolean;
    reused: boolean;
} | {
    otp?: boolean;
    ok: boolean;
    error: any;
    reason: string;
    reused?: undefined;
} | {
    ok: boolean;
    reused?: undefined;
}>;
/**
 * page.goto that survives ONE net::ERR_ABORTED.
 *
 * ERR_ABORTED does not mean the URL is unreachable — it means the page cancelled our navigation
 * by starting its own. The AJIO SPA does exactly that when its auth state is cleared underneath it
 * (session-reuse probe rejected -> cookies + storage wiped -> the live dashboard 401s and redirects
 * itself), aborting the SSO page.goto fired microseconds later. The aborting navigation has landed
 * by the time we retry, so a single retry clears it. Any other navigation error is rethrown as-is.
 */
export function gotoWithAbortRetry(page: any, url: any, gotoOptions?: {
    waitUntil: string;
}, attempts?: number): Promise<any>;
/**
 * Optional post-login modal: if a visible dialog contains "Transaction Confirmation",
 * click "Review Later" inside that dialog only. Polls until maxWaitMs; does not throw.
 */
export function tryDismissTransactionConfirmationPopup(page: any, options?: {}): Promise<boolean>;
/**
 * Dismiss the "AJIO Announcement" popup (e.g. "Mandatory Update: CCTV Video Sharing")
 * that AJIO now shows on login. Polls because it can appear with a delay, and
 * clicks the OK button (or the dialog's Close icon as a fallback). Never throws.
 * Returns true if a popup was dismissed.
 */
export function tryDismissAjioAnnouncementPopup(page: any, options?: {}): Promise<boolean>;
/**
 * Dismiss the "Seller Agreements" onboarding interstitial that AJIO now shows on login
 * (route /vmsui/sellers/onBoarding/agreements). Each pending agreement renders a screen
 * with a disabled "Accept" + an enabled "Skip"; clicking Skip opens a "Skip Seller
 * Agreement" confirmation dialog with an "Agree" button. There can be MORE THAN ONE
 * pending agreement, so we loop: Skip -> Agree until no Skip button remains. Never throws.
 * Returns the number of agreements skipped.
 */
export function tryDismissSellerAgreementsPopup(page: any, options?: {}): Promise<number>;
