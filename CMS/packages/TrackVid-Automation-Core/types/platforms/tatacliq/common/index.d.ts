export const cloudflareAccess: typeof import("./cloudflareAccess");
export const cloudflareOTP: typeof import("./cloudflareOTP");
export const getOtp: typeof import("./getOtp");
export const login: typeof import("./login");
export const renewSession: typeof import("./renewSession");
export const sessionStore: {
    SESSION_FIELD: string;
    COOKIE_DOMAINS: string[];
    isSessionCacheEnabled: () => boolean;
    harvestCookies: (page: any, { logger }?: {
        logger?: Console;
    }) => Promise<{
        name: string;
        value: string;
        domain: string;
    }[]>;
    hydrateCookies: (page: any, jar: any) => Promise<number>;
    saveSession: ({ credentialId, username, jar, slaves, ip, source }: {
        credentialId: any;
        username: any;
        jar: any;
        slaves?: any[];
        ip?: any;
        source?: string;
    }) => Promise<boolean>;
    loadSession: ({ credentialId, username }: {
        credentialId: any;
        username: any;
    }) => Promise<any>;
    clearSession: ({ credentialId, username }: {
        credentialId: any;
        username: any;
    }, reason?: string) => Promise<boolean>;
    probeSessionInPage: (page: any) => Promise<{
        alive: boolean;
        slaves: any[];
    }>;
    reuseSessionRecord: (page: any, record: any, { username }?: {}) => Promise<{
        jar: any[];
        slaves: any[];
    } | null>;
    tryReuseSession: (page: any, { credentialId, username }: {
        credentialId: any;
        username: any;
    }) => Promise<{
        jar: any[];
        slaves: any[];
    }>;
};
export const slaveSync: typeof import("./slaveSync");
