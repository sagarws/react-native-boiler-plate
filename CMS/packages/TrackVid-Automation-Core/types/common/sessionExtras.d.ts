export namespace SESSION_EXTRAS {
    export { ajio };
    export { flipkart };
    export { meesho };
    export { myntra };
    export { nykaa };
}
/**
 * The descriptor for one platform, or null when a jar is the whole session.
 *
 * Null is the common case and not an error — the remaining platforms need
 * nothing more than the cookies their login page sets.
 */
export function getSessionExtras(platform: any): any;
/**
 * Platforms whose session is OAuth tokens rather than cookies.
 *
 * Listed so a caller can say so plainly instead of shipping a jar the ingest
 * endpoint will reject for reasons that read like a capture bug.
 */
export function platformsNeedingTokenCapture(): string[];
import ajio = require("../platforms/ajio/common/sessionExtras.js");
import flipkart = require("../platforms/flipkart/common/sessionExtras.js");
import meesho = require("../platforms/meesho/common/sessionExtras.js");
import myntra = require("../platforms/myntra/common/sessionExtras.js");
import nykaa = require("../platforms/nykaa/common/sessionExtras.js");
