export function enableStealthMode(page: any): Promise<void>;
export function handleDialog(page: any): void;
export function snapdealLogin(page: any, credentials: any, options?: {}): Promise<boolean>;
export function navigateToReturns(page: any): Promise<boolean>;
export function navigateToDeliveredReturns(page: any): Promise<boolean>;
export function searchByAwbNumber(page: any, awbNumber: any): Promise<boolean>;
export function searchBySuborderId(page: any, subOrderNumber: any): Promise<boolean>;
export function searchByField(page: any, { optionLabel, value, notFoundError }: {
    optionLabel: any;
    value: any;
    notFoundError: any;
}): Promise<boolean>;
export function hasDeliveredReturnRecord(page: any, { timeoutMs }?: {
    timeoutMs?: number;
}): Promise<boolean>;
export function clickRaiseDispute(page: any): Promise<boolean>;
export function fillDisputeForm(page: any, formData: any, tempPath: any): Promise<boolean>;
/**
 * Convert the CMS claim template (HTML) to plain text for the dispute textarea.
 *
 * Snapdeal's Description is a plain <textarea>, so raw markup would be raised
 * verbatim on the ticket. Anchors collapse to their href so the evidence links
 * stay clickable-as-text; <p>/<li>/<br> become newlines. Mirrors the helper in
 * the Nykaa / AJIO claim scripts.
 */
export function htmlToText(html: any): any;
export function getSnapdealTicketId(page: any, subOrderNumber: any): Promise<any>;
