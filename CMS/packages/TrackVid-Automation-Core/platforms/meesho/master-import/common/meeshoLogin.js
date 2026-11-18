const logger = require("../../../../common/redactingLogger");

/**
 * Log into the Meesho Supplier Portal.
 *
 * @param {import('puppeteer').Page} page
 * @param {{ username: string, password: string, loginUrl?: string }} credentials
 * @returns {Promise<boolean>} true on success; throws on failure.
 */
async function meeshoLogin(page, credentials) {
    const { username, password, loginUrl = "https://supplier.meesho.com/" } = credentials;

    try {
        logger.info(`🔑 Starting Meesho login for: ${username}`);

        // 1. Navigate to portal
        logger.info("🌐 Navigating to Meesho Supplier Portal...");
        await page.goto(loginUrl, { waitUntil: "networkidle2" });

        // 2. Click the top "Login" button
        logger.info("🔓 Clicking login button...");
        const loginButtonSelector = "a#loginbutton";
        await page.waitForSelector(loginButtonSelector, { visible: true });
        await page.evaluate((selector) => {
            document.querySelector(selector).click();
        }, loginButtonSelector);

        // 3. Wait for the login form
        logger.info("⌛ Waiting for login form...");
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // 4. Fill email/phone
        logger.info("📝 Entering email/phone...");
        const emailSelector = 'input[name="emailOrPhone"]';
        await page.waitForSelector(emailSelector, { visible: true });
        await new Promise((resolve) => setTimeout(resolve, 500));
        await page.click(emailSelector);
        await page.type(emailSelector, username, { delay: 50 });

        // 5. Fill password
        logger.info("🔐 Entering password...");
        const passwordSelector = 'input[name="password"]';
        await page.waitForSelector(passwordSelector, { visible: true });
        await new Promise((resolve) => setTimeout(resolve, 500));
        await page.click(passwordSelector);
        await page.type(passwordSelector, password, { delay: 50 });

        // 6. Submit
        logger.info("🔑 Submitting login form...");
        await new Promise((resolve) => setTimeout(resolve, 500));
        const submitSelector = 'button[type="submit"]';
        await page.waitForSelector(submitSelector, { visible: true });
        await page.click(submitSelector);

        // 7. Wait for landing page
        logger.info("⏳ Waiting for login to complete...");
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const currentUrl = page.url();
        if (currentUrl.includes("/login")) {
            logger.warn("⚠️ Login may have failed — still on login page");
            const errorElement = await page.$(".error-message, .Mui-error, [class*='error']");
            if (errorElement) {
                const errorText = await page.evaluate((el) => el.innerText, errorElement);
                logger.error(`❌ Login error: ${errorText}`);
                throw new Error(`LOGIN_FAILED_${errorText}`);
            }
            throw new Error("LOGIN_FAILED_NO_ERROR");
        }

        logger.info("✅ Meesho login successful");
        return true;
    } catch (error) {
        logger.error({ err: error }, `🚨 Meesho login failed for ${username}`);
        throw error;
    }
}

module.exports = { meeshoLogin };
