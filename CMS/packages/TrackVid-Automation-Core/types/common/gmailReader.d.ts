/**
 * @param {object} [filters] see the table at the top of this file
 * @param {{ account?: { user: string, password: string, host?: string, port?: number } }} [options]
 *        the mailbox to read. Omit it for the environment's.
 */
export function fetchEmails(filters?: object, { account }?: {
    account?: {
        user: string;
        password: string;
        host?: string;
        port?: number;
    };
}): Promise<any>;
/**
 * The mailbox to read, from an explicit account or from the environment.
 *
 * EXPLICIT FIRST, environment second. The automation server has one mailbox in
 * its `.env` and always will; the desktop app has no server environment to put
 * one in, and asking it to invent environment variables on an operator's
 * machine would be pretending it is a server. So a caller may hand the account
 * over directly — from the OS keychain, in the desktop's case — and a caller
 * that passes nothing behaves exactly as it always has.
 *
 * @param {{ user?: string, password?: string, host?: string, port?: number }} [account]
 */
export function imapConfig(account?: {
    user?: string;
    password?: string;
    host?: string;
    port?: number;
}): {
    user: string;
    password: string;
    host: string;
    port: number;
    tls: boolean;
    tlsOptions: {
        servername: string;
        rejectUnauthorized: boolean;
    };
};
