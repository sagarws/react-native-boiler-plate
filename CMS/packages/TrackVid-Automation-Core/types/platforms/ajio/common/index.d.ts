export const getOtp: typeof import("./getOtp");
export const login: typeof import("./login");
export const loginErrors: typeof import("./loginErrors");
export const loginForm: {
    platform: string;
    steps: ({
        kind: string;
        selector: string;
        label: string;
        optional: boolean;
        skipIfSelector: string;
        text?: undefined;
        match?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
        ms?: undefined;
    } | {
        kind: string;
        text: string;
        match: string;
        label: string;
        optional: boolean;
        skipIfSelector: string;
        selector?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
        ms?: undefined;
    } | {
        kind: string;
        selector: string;
        label: string;
        timeoutMs: number;
        optional?: undefined;
        skipIfSelector?: undefined;
        text?: undefined;
        match?: undefined;
        field?: undefined;
        ms?: undefined;
    } | {
        kind: string;
        selector: string;
        field: string;
        label?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        text?: undefined;
        match?: undefined;
        timeoutMs?: undefined;
        ms?: undefined;
    } | {
        kind: string;
        ms: number;
        selector?: undefined;
        label?: undefined;
        optional?: undefined;
        skipIfSelector?: undefined;
        text?: undefined;
        match?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
    } | {
        kind: string;
        selector: string;
        label: string;
        optional?: undefined;
        skipIfSelector?: undefined;
        text?: undefined;
        match?: undefined;
        timeoutMs?: undefined;
        field?: undefined;
        ms?: undefined;
    })[];
    success: {
        urlIncludes: string[];
    };
    failure: {
        anySelector: string[];
    };
    otp: {
        anySelector: string[];
        urlIncludes: string[];
    };
    otpEntry: {
        input: string;
        submit: string;
    };
    interstitials: {
        whenText: string;
        clickText: string;
    }[];
};
export const loginPage: typeof import("./loginPage");
export const mfa: typeof import("./mfa");
export const pobSync: typeof import("./pobSync");
export const renewSession: typeof import("./renewSession");
export const salesChannel: typeof import("./salesChannel");
export const sessionExtras: {
    platform: string;
    required: string[];
    pageScript: string;
    USER_ID_EXPRESSION: "(function () {\n  var GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;\n  try {\n    var direct = localStorage.getItem(\"activeSellerProfileId\");\n    if (direct && GUID.test(direct)) return direct.match(GUID)[0];\n    var blobs = [];\n    for (var i = 0; i < localStorage.length; i++) blobs.push(localStorage.getItem(localStorage.key(i)));\n    for (var j = 0; j < sessionStorage.length; j++) blobs.push(sessionStorage.getItem(sessionStorage.key(j)));\n    for (var k = 0; k < blobs.length; k++) {\n      var m = (blobs[k] || \"\").match(GUID);\n      if (m) return m[0];\n    }\n  } catch (e) { /* storage can be blocked mid-navigation */ }\n  return null;\n})()";
    pobPageExpression: typeof import("./sessionExtras").pobPageExpression;
    POB_PAGE_SIZE: 100;
};
export const sessionStore: typeof import("./sessionStore");
export const unverifyCredential: typeof import("./unverifyCredential");
