export const PROXY_MODE: string;
export function isProxyEnabled(): boolean;
import { isProxyAccount } from "./proxyAccounts";
export function loadBrightDataConfig(accountEmail: any): {
    host: string;
    port: number;
    username: any;
    password: any;
};
export function buildStickyUsername(baseUsername: any, sessionId: any): any;
export function buildProxyCredentials(sessionId: any, accountEmail: any): {
    host: string;
    port: number;
    username: any;
    password: any;
    sessionId: any;
};
export function getNextProxySession(accountEmail: any): any;
export function rotateProxySession(accountEmail: any): string;
export function recordSessionIp(accountEmail: any, ip: any): void;
export function createLocalAuthProxy({ host, port, username, password }: {
    host: any;
    port: any;
    username: any;
    password: any;
}): Promise<any>;
export function closeLocalAuthProxy(localUrl: any): Promise<void>;
export function buildAuthProxyExtension({ host, port, username, password }: {
    host: any;
    port: any;
    username: any;
    password: any;
}, tmpRoot: any): Promise<string>;
export function getExtensionTmpRoot(): string;
export { isProxyAccount };
