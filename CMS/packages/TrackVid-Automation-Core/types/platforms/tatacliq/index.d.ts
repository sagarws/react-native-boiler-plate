export const accountMapping: {
    readonly apiBasedFlow: {
        readonly probeAwb: typeof import("./account-mapping/api-based-flow/probeAwb");
    };
};
export const claimManagement: {
    readonly apiBasedFlow: {
        readonly claimApiFlow: typeof import("./claim-management/api-based-flow/claimApiFlow");
        readonly fileClaim: typeof import("./claim-management/api-based-flow/fileClaim");
    };
    readonly common: {
        readonly qcReasons: typeof import("./claim-management/common/qcReasons");
    };
};
export const common: {
    readonly getOtp: typeof import("./common/getOtp");
    readonly login: typeof import("./common/login");
    readonly renewSession: typeof import("./common/renewSession");
    readonly sessionStore: {
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
    readonly slaveSync: typeof import("./common/slaveSync");
};
