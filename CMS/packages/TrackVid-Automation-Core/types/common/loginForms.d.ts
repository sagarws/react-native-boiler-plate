export namespace LOGIN_FORMS {
    export { ajio };
    export { delhivery };
    export { flipkart };
    export { meesho };
    export { myntra };
    export { nykaa };
    export { snapdeal };
    export { xbees };
}
/**
 * The descriptor for one platform, or null when there is none.
 *
 * Null is a normal answer, not an error: a caller without a descriptor falls
 * back to asking the operator to sign in by hand, which is what every platform
 * did before this existed.
 */
export function getLoginForm(platform: any): any;
/** Platforms a scripted sign-in is described for. */
export function platformsWithLoginForm(): string[];
import ajio = require("../platforms/ajio/common/loginForm.js");
import delhivery = require("../platforms/delhivery/common/loginForm.js");
import flipkart = require("../platforms/flipkart/common/loginForm.js");
import meesho = require("../platforms/meesho/common/loginForm.js");
import myntra = require("../platforms/myntra/common/loginForm.js");
import nykaa = require("../platforms/nykaa/common/loginForm.js");
import snapdeal = require("../platforms/snapdeal/common/loginForm.js");
import xbees = require("../platforms/xbees/common/loginForm.js");
