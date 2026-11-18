/**
 * Go straight to the SPF Claims route, without touching the sidebar.
 *
 * The sidebar path below is three fragile steps — hover a rail item, wait for a
 * `popover="auto"` that Chrome hides the moment the cursor drifts, click an
 * option inside it — and every one of them needs the dashboard chrome to have
 * rendered. It usually has. When it has not, the run failed at "Payments rail
 * trigger" with 20 seconds of nothing, and the claim was reported as broken
 * even though the session was fine and the page it wanted is a plain URL.
 *
 * So: read the anchor's href if it exists anywhere in the DOM, and otherwise
 * construct the hash route. Verified the same way the sidebar path is — by the
 * URL actually becoming the SPF route — so this cannot "succeed" onto a login
 * page or a half-loaded dashboard.
 */
export function gotoSpfDirect(driver: any): Promise<boolean>;
/**
 * Dismiss the post-login "Congratulations 🎉 You are now a Seller on Flipkart"
 * welcome modal by clicking its "Get Started" button. No-op if the modal never
 * appears within the poll window — the modal only shows on a subset of sessions
 * and would otherwise block sidebar nav (Payments rail, SPF Claims) later.
 */
export function dismissWelcomeModal(driver: any, { pollMs, intervalMs }?: {
    pollMs?: number;
    intervalMs?: number;
}): Promise<boolean>;
export function imageNameFromUrl(url: any, fallback: any): any;
/**
 * @param {object} [options]
 * @param {boolean} [options.headless] overrides the environment/company policy.
 *        Omit and the shared `isHeadless()` decides, which is what the server
 *        does. A caller passes `false` when the run may need a PERSON — a
 *        headless browser cannot be typed into, so a one-time code prompt in
 *        one is a guaranteed timeout rather than a challenge.
 */
export function buildDriver({ headless }?: {
    headless?: boolean;
}): Promise<any>;
/** Quit the driver, and stop remembering it. */
export function destroyDriver(driver: any): Promise<void>;
export function downloadFile(url: any, filename: any, tempPath: any): Promise<any>;
/**
 * @param {object} driver
 * @param {{username: string, password: string, otpEmail?: string}} credentials
 * @param {object} [options]
 * @param {Function|null} [options.fetchOtp] where the one-time code comes from.
 *        Defaults to reading the account's Gmail — what the server does. Pass
 *        `null` to wait for a person to type it into the visible browser, which
 *        is the only option on a machine without the server's IMAP credentials.
 * @param {number} [options.operatorTimeoutMs] how long to wait for that person.
 * @param {boolean} [options.operatorFallback] when a lookup finds no mail, ask
 *        the operator instead of failing. Only meaningful where somebody is
 *        actually watching the browser, which is why it is off by default.
 */
export function flipkartLogin(driver: object, credentials: {
    username: string;
    password: string;
    otpEmail?: string;
}, { fetchOtp, operatorTimeoutMs, operatorFallback }?: {
    fetchOtp?: Function | null;
    operatorTimeoutMs?: number;
    operatorFallback?: boolean;
}): Promise<void>;
export function openSpfClaimsPage(driver: any, _q: any, _t: any): Promise<void>;
export function openRaiseNewClaim(driver: any, claimArea: any): Promise<void>;
export function fillOrderIdAndProceed(driver: any, orderId: any, { username }?: {}): Promise<void>;
export function fillClaimForm(driver: any, { shippingLabel, issueArea, issueType, description, evidenceImages, }: {
    shippingLabel: any;
    issueArea: any;
    issueType: any;
    description: any;
    evidenceImages: any;
}): Promise<void>;
export function submitClaim(driver: any): Promise<void>;
export function getFlipkartTicketId(driver: any, orderId: any, { tab, tabLabel }?: {
    tab?: string;
    tabLabel?: string;
}): Promise<any>;
export function closeClaimDrawer(driver: any): Promise<boolean>;
