export namespace ORDER_STATUS {
    let MARKETPLACE_DELIVERED: string;
    let RETURN_NOT_DELIVERED: string;
}
export namespace CLAIM_TYPE {
    let NDR: string;
    let DDR: string;
}
export const CLAIM_CONTENT: {
    [CLAIM_TYPE.DDR]: {
        claimType: string;
        label: string;
        subIssueType: string;
        typeOfClaim: string;
        emailTemplate: {
            subject: string;
            body: string;
        };
        imageUrl: string;
        expectedOrderStatus: string;
    };
    [CLAIM_TYPE.NDR]: {
        claimType: string;
        label: string;
        subIssueType: string;
        typeOfClaim: string;
        emailTemplate: {
            subject: string;
            body: string;
        };
        imageUrl: string;
        expectedOrderStatus: string;
    };
};
/** The only statuses the order-status path will claim. */
export const CLAIMABLE_STATUSES: string[];
/** @returns {object|null} the content for a claim type, or null if unknown. */
export function contentForClaimType(claimType: any): object | null;
/** @returns {object|null} the content a record's status implies. */
export function contentForOrderStatus(orderStatus: any): object | null;
/** @returns {string|null} the claim type a record's status implies. */
export function claimTypeForOrderStatus(orderStatus: any): string | null;
/**
 * True when the operator's choice contradicts what the record's status implies.
 *
 * Only meaningful for a status this tool recognises: a record sitting at some
 * third status implies nothing, so there is nothing to disagree with.
 */
export function isTypeMismatch(claimType: any, orderStatus: any): boolean;
