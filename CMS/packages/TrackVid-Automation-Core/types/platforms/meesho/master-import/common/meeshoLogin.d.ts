/**
 * Log into the Meesho Supplier Portal.
 *
 * @param {import('puppeteer').Page} page
 * @param {{ username: string, password: string, loginUrl?: string }} credentials
 * @returns {Promise<boolean>} true on success; throws on failure.
 */
export function meeshoLogin(page: any, credentials: {
    username: string;
    password: string;
    loginUrl?: string;
}): Promise<boolean>;
