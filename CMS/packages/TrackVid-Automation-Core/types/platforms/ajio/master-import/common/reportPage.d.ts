export const ENTERPRISE_POB_EMAILS: string[];
export function isEnterprisePoBUser(username: any): boolean;
export function openPoBDropdown(page: any): Promise<void>;
/**
 * Close the Place of Business dropdown.
 */
export function closePoBDropdown(page: any): Promise<void>;
/**
 * Select all brands via the "Select All" checkbox.
 */
export function selectAllBrands(page: any, userLogger: any): Promise<void>;
/**
 * Enterprise PoB flow: select all Places of Business via the "Change" button + modal.
 *
 * Used only for accounts in ENTERPRISE_POB_EMAILS. Their Reports page shows a
 * "Change" button next to Place of Business that opens a "Select Place of Business"
 * modal with a "Select all the POBs" checkbox and a "Confirm" button — instead of
 * the normal MUI dropdown handled by selectAllBrands().
 *
 * Steps: click "Change" → wait modal → check "Select all the POBs" (ensure it ends
 * fully checked, handling the indeterminate/partial state) → click "Confirm" → wait close.
 */
export function selectAllPOBsViaModal(page: any, userLogger: any): Promise<void>;
/**
 * Set the From and To date inputs on the report page.
 */
export function setDateRange(page: any, fromDate: any, toDate: any): Promise<void>;
/**
 * Split a date range into chunks of max `maxDays` days each.
 * Works backwards from toDate so the most recent chunk is always full-sized.
 * Returns chunks in chronological order (oldest first).
 */
export function splitDateRange(fromDate: any, toDate: any, maxDays?: number): {
    fromDate: string;
    toDate: string;
}[];
