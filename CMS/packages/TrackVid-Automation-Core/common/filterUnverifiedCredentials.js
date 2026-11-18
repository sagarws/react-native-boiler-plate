// Mutates `companies` in place: for each company.settings.eCommercePlatformLoginInfo[*].info[],
// drops entries with is_verified === false. Compares against `false` (not `=== true`) so legacy
// creds saved before the field existed — where the value is undefined — are KEPT. Otherwise this
// would silently exclude every customer whose creds predate the feature.
//
// Each stripped cred logs a structured warn so operators have a paper trail when a customer
// wonders why their cron suddenly skipped them.
//
// `logger` should expose pino-style `warn(obj, msg)`. Plain `console` works too — args print in
// the same order, just unstructured.
function filterUnverifiedCredentials(companies, logger = console) {
    if (!Array.isArray(companies)) return companies;

    for (const company of companies) {
        const platforms = company.settings?.eCommercePlatformLoginInfo;
        if (!Array.isArray(platforms)) continue;
        for (const platform of platforms) {
            if (!Array.isArray(platform?.info)) continue;
            const kept = [];
            for (const cred of platform.info) {
                if (cred?.is_verified === false) {
                    logger.warn(
                        {
                            companyId: String(company._id),
                            platform: platform.eComPlatform,
                            username: cred.username,
                        },
                        "⛔ Skipping credential marked is_verified=false"
                    );
                    continue;
                }
                kept.push(cred);
            }
            platform.info = kept;
        }
    }

    return companies;
}

module.exports = { filterUnverifiedCredentials };
