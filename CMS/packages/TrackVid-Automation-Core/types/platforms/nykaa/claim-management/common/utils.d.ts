/**
 * Nykaa auto-claim helpers.
 *
 * Nykaa uses a Zoho-desk dispute portal (https://dispute.nykaa.com). The login
 * form is rendered INSIDE an iframe (#iamFrame → Zoho IAM), and is a two-step
 * flow: email → "Next" → password → "Sign in" (same #nextbtn button both steps).
 *
 * This file holds Nykaa-specific, reusable steps so scriptNew.js stays readable.
 */
export const SIGNIN_URL: "https://dispute.nykaa.com/portal/en/signin";
export function sleep(ms: any): Promise<any>;
/**
 * Resolve the Zoho IAM login iframe's content frame.
 * The login inputs (#login_id, #password, #nextbtn) live inside this iframe.
 */
export function getLoginFrame(page: any, timeout?: number): Promise<any>;
/**
 * Detect login blockers we cannot automate (captcha / OTP / MFA).
 * Returns a string describing the blocker, or null if none visible.
 */
export function detectLoginBlocker(frame: any): Promise<any>;
/**
 * Read a visible login error inside the iframe (e.g. "Incorrect password.").
 * Zoho shows it as `.fielderror.errorlabel` with display:block. Returns the
 * error text, or "" if none visible.
 */
export function readLoginError(frame: any): Promise<any>;
export function dismissTerminateSessionsPopup(page: any): Promise<boolean>;
export function skipConcurrentSessionReminder(page: any): Promise<boolean>;
export function loginNykaa(page: any, credentials: any): Promise<boolean>;
/**
 * From the portal home, open "My Area" (the seller's tickets list).
 * Nav link: <a href="/portal/en/myarea" aria-label="My Area">.
 */
export function goToMyArea(page: any): Promise<any>;
/**
 * From My Area, click "Add ticket" to open the new-ticket form.
 * Link: <a data-id="addticket" href="/portal/en/newticket"><button>Add ticket</button></a>
 *
 * Nykaa then routes to /newticket?departmentId=…&layoutId=… (may auto-select the
 * department, or show a chooser → "Dispute Management" / "Nykaa Seller Claims").
 * We log the resulting URL so we can see which path this seller takes.
 */
export function clickAddTicket(page: any): Promise<any>;
/**
 * Convert claim email HTML to plain text (mirrors the AJIO script's htmlToText).
 */
export function htmlToText(html: any): any;
/**
 * Split the claim email into the two Nykaa form parts.
 *
 * - description: from "I hope this message" up to (excluding) "Return AWB Number".
 * - evidenceUrl: from "Return AWB Number" through the last evidence line,
 *   dropping the "Thank you / Best regards" closing.
 *
 * @param {string} emailBody HTML or plain text of the claim email
 * @returns {{ description: string, evidenceUrl: string }}
 */
export function parseNykaaEmail(emailBody: string): {
    description: string;
    evidenceUrl: string;
};
/**
 * Type into a plain text input on the ticket form (clears first).
 */
export function typeField(page: any, selector: any, value: any, label: any): Promise<void>;
/**
 * Set an input's value directly via the native setter + input/change events.
 * Used for the Evidence URL field, whose multi-line content can't be entered by
 * keystrokes into a single-line input.
 */
export function setInputValue(page: any, selector: any, value: any, label: any): Promise<void>;
/**
 * Select an option in a Zoho custom dropdown (DropDown__ component).
 * @param {string} fieldName e.g. "Issue" or "Return Type" — matches dropdown_selected_<fieldName>
 * @param {string} optionValue exact visible value, e.g. "Wrong Product Returned - Other brand Product"
 *                 (the option's data-id is `<fieldName>_<optionValue>`)
 */
export function selectZohoDropdown(page: any, fieldName: string, optionValue: string, label: any): Promise<void>;
/**
 * Set the rich-text Description (Zoho KB_Editor contenteditable).
 */
export function setDescription(page: any, text: any, label?: string): Promise<void>;
/**
 * Fill the Submit-a-Ticket form from a data object. Does NOT submit.
 *
 * @param {object} data
 *   { subject, vendorCode, skuId, reverseAwb, issue, returnType,
 *     description, evidenceUrl, emailBody }
 *   If `emailBody` is provided, description + evidenceUrl are derived from it
 *   via parseNykaaEmail() (explicit description/evidenceUrl override).
 */
export function fillTicketForm(page: any, data: object): Promise<void>;
