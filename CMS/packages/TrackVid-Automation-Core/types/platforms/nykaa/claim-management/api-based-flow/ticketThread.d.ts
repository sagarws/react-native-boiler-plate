/**
 * Zoho's id for a ticket number — the number is what a claim row stores and
 * what the portal shows; every other call takes the id.
 *
 * Matched on the number exactly: `searchStr` is a text search and can answer
 * with tickets that merely contain it.
 *
 * @returns {Promise<string>} the id
 */
export function resolveTicketId(ctx: any, ticket: any): Promise<string>;
/**
 * The ticket as its page shows it: the ticket, every conversation (threads read
 * in full, newest first up to MAX_FULL_THREADS), and its attachments.
 *
 * @returns {Promise<{ id: string, ticket: object, conversations: object[], attachments: object[] }>}
 */
export function fetchTicketThread(ctx: any, ticket: any): Promise<{
    id: string;
    ticket: object;
    conversations: object[];
    attachments: object[];
}>;
/**
 * Uploads one file for a reply. Answers the id `replyTicket` lists.
 *
 * The multipart field is `file` (Zoho Desk's upload contract); the recording
 * does not carry the body, so NYKAA_UPLOAD_FIELD can change it.
 */
export function uploadAttachment(ctx: any, filePath: any): Promise<string>;
/**
 * Replies on a ticket — a comment, with uploaded files attached.
 *
 * `ticket` may be the number or the id; the number is resolved once.
 */
export function replyTicket(ctx: any, { ticket, content, attachmentIds }: {
    ticket: any;
    content?: string;
    attachmentIds?: any[];
}): Promise<any>;
/** A Zoho record id: long and numeric. The ticket NUMBER a claim stores is short. */
export function isZohoId(value: any): boolean;
/** How many conversation entries are read. The portal pages by 10; a claim rarely has more than a dozen. */
export const MAX_CONVERSATIONS: number;
/**
 * How many threads are read in full. Each is one call, and the paced client
 * spends budget on every one — the rest keep their (truncated) summary.
 */
export const MAX_FULL_THREADS: number;
