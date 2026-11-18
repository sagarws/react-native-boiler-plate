export const COMPANIES_COLLECTION: "companies";
/** Coerce to an ObjectId, or null when the value is empty or malformed. */
export function toObjectIdOrNull(value: any): any;
export function companiesCollection(): Promise<any>;
/** Serialise a cookie jar object into a Cookie request header. */
export function cookieHeader(jar: any): string;
/**
 * Builds the query / arrayFilters / predicate triple used to find one credential
 * inside settings.eCommercePlatformLoginInfo.
 *
 * Prefers the credential _id; falls back to a case-insensitive username match.
 * Returns null when neither is usable.
 *
 * @param platformRegex the platform's eComPlatform matcher, e.g. /^ajio$/i
 */
export function makeBuildMatchers(platformRegex: any): ({ credentialId, username }: {
    credentialId: any;
    username: any;
}) => {
    query: {
        "settings.eCommercePlatformLoginInfo.info._id": any;
        "settings.eCommercePlatformLoginInfo.info.username"?: undefined;
    };
    arrayFilters: ({
        "p.eComPlatform": any;
        "c._id"?: undefined;
    } | {
        "c._id": any;
        "p.eComPlatform"?: undefined;
    })[];
    matches: (cred: any) => boolean;
    label: string;
} | {
    query: {
        "settings.eCommercePlatformLoginInfo.info.username": {
            $regex: string;
            $options: string;
        };
        "settings.eCommercePlatformLoginInfo.info._id"?: undefined;
    };
    arrayFilters: ({
        "p.eComPlatform": any;
        "c.username"?: undefined;
    } | {
        "c.username": {
            $regex: string;
            $options: string;
        };
        "p.eComPlatform"?: undefined;
    })[];
    matches: (cred: any) => boolean;
    label: any;
};
