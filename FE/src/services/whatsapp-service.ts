import { clone, delay } from "@/mocks/delay";
import { sampleActiveWhatsAppProvider, sampleWhatsAppConnections } from "@/mocks/integrations";
import type {
  WhatsAppActionResponse,
  WhatsAppActiveResponse,
  WhatsAppConnectionStatus,
  WhatsAppProvider,
  WhatsAppStatusResponse,
} from "@/types/integrations";

export type { WhatsAppProvider, WhatsAppConnectionStatus } from "@/types/integrations";

/**
 * Mock of TrackVid-FE `api/whatsapp-service.ts` (`/whatsapp/*`). Owned by the Integrations route; the
 * Settings route reuses it. State lives in memory for the page session.
 */

export const WHATSAPP_PROVIDER_MAP: Record<WhatsAppProvider, string> = {
  "11za": "whatsapp_11za",
  mark360: "whatsapp_mark360",
  kwikengage: "whatsapp_kwikengage",
};

const PROVIDERS: WhatsAppProvider[] = ["mark360", "11za", "kwikengage"];
const LABELS: Record<WhatsAppProvider, string> = { mark360: "Mark360", "11za": "11za", kwikengage: "KwikEngage" };

let connections: Record<WhatsAppProvider, WhatsAppConnectionStatus | null> = clone(sampleWhatsAppConnections);
let activeProvider: WhatsAppProvider | null = sampleActiveWhatsAppProvider;

const flags = (pick: (c: WhatsAppConnectionStatus | null) => boolean) =>
  Object.fromEntries(PROVIDERS.map((p) => [p, pick(connections[p])])) as Record<WhatsAppProvider, boolean>;

/** The mock "provider API" rejects obviously wrong secrets so the error paths can be tried. */
function checkToken(provider: WhatsAppProvider, authToken: string): void {
  if (authToken.length < 8 || /invalid|wrong/i.test(authToken)) {
    throw new Error(provider === "kwikengage" ? "Invalid KwikEngage API key" : `Invalid ${LABELS[provider]} auth token`);
  }
}

function checkOrigin(originWebsite?: string): void {
  if (originWebsite === undefined) return;
  try {
    const u = new URL(originWebsite);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
  } catch (err) {
    // Re-thrown as the BE's validation message; the parse error itself is not useful to the seller.
    void err;
    throw new Error("Origin website must be a valid URL (e.g. https://example.com)");
  }
}

const getConnectionStatus = async (provider: WhatsAppProvider): Promise<WhatsAppStatusResponse> => {
  await delay(300);
  const connection = connections[provider];
  return connection ? { isSuccess: true, connection: clone(connection) } : { isSuccess: true };
};

const connect = async (
  provider: WhatsAppProvider,
  authToken: string,
  templateName?: string,
  organizationId?: string,
  originWebsite?: string,
  merchantId?: string,
): Promise<WhatsAppActionResponse> => {
  await delay(700);
  checkToken(provider, authToken);
  if (!templateName) throw new Error("Template name is required");
  if (provider === "11za") checkOrigin(originWebsite);
  const connection: WhatsAppConnectionStatus = {
    provider,
    connected: true,
    configured: true,
    businessAccountName: "Urban Threads",
    phoneNumber: "+91 98765 43210",
    status: "active",
    lastConnectedAt: new Date().toISOString(),
    templateName,
    ...(organizationId ? { organizationId } : {}),
    ...(originWebsite ? { originWebsite } : {}),
    ...(merchantId ? { merchantId } : {}),
  };
  connections = { ...connections, [provider]: connection };
  // The first provider a company connects becomes the active one, like the BE.
  if (!activeProvider) activeProvider = provider;
  return { isSuccess: true, message: `${LABELS[provider]} connected successfully`, connection: clone(connection) };
};

const disconnect = async (provider: WhatsAppProvider): Promise<WhatsAppActionResponse> => {
  await delay(600);
  if (!connections[provider]) throw new Error(`${LABELS[provider]} is not connected`);
  connections = { ...connections, [provider]: null };
  let promotedProvider: WhatsAppProvider | null = null;
  if (activeProvider === provider) {
    promotedProvider = PROVIDERS.find((p) => connections[p]?.configured && connections[p]?.status !== "expired") ?? null;
    activeProvider = promotedProvider;
  }
  return { isSuccess: true, message: `${LABELS[provider]} disconnected`, promotedProvider };
};

const updateToken = async (
  provider: WhatsAppProvider,
  authToken: string,
  templateName?: string,
  organizationId?: string,
  originWebsite?: string,
  merchantId?: string,
): Promise<WhatsAppActionResponse> => {
  await delay(600);
  const current = connections[provider];
  if (!current) throw new Error(`${LABELS[provider]} is not connected`);
  if (authToken) checkToken(provider, authToken);
  if (provider === "11za") checkOrigin(originWebsite);
  const next: WhatsAppConnectionStatus = {
    ...current,
    ...(templateName ? { templateName } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(originWebsite ? { originWebsite } : {}),
    ...(merchantId ? { merchantId } : {}),
    // A fresh token clears an expired / errored row.
    ...(authToken ? { status: activeProvider === provider ? "active" : "inactive", connected: true, lastConnectedAt: new Date().toISOString() } : {}),
  };
  connections = { ...connections, [provider]: next };
  return { isSuccess: true, message: authToken ? "Token updated successfully" : "Settings updated successfully", connection: clone(next) };
};

const setActive = async (provider: WhatsAppProvider): Promise<WhatsAppActionResponse> => {
  await delay(500);
  const current = connections[provider];
  if (!current?.configured) throw new Error(`Connect ${LABELS[provider]} first`);
  const previous = activeProvider;
  const previousConn = previous && previous !== provider ? connections[previous] : null;
  activeProvider = provider;
  connections = {
    ...connections,
    [provider]: { ...current, status: current.status === "expired" || current.status === "error" ? current.status : "active" },
  };
  if (previous && previousConn) connections = { ...connections, [previous]: { ...previousConn, status: "inactive" } };
  return { isSuccess: true, message: `${LABELS[provider]} is now active` };
};

/** Soft toggle (keeps credentials), distinct from `disconnect`. */
const deactivate = async (provider: WhatsAppProvider): Promise<WhatsAppActionResponse> => {
  await delay(500);
  const current = connections[provider];
  if (!current) throw new Error(`${LABELS[provider]} is not connected`);
  if (activeProvider === provider) activeProvider = null;
  connections = { ...connections, [provider]: { ...current, status: current.status === "active" ? "inactive" : current.status } };
  return { isSuccess: true, message: `${LABELS[provider]} deactivated` };
};

const getActiveProvider = async (): Promise<WhatsAppActiveResponse> => {
  await delay(350);
  return {
    isSuccess: true,
    activeProvider,
    configured: flags((c) => Boolean(c?.configured)),
    errored: flags((c) => c?.status === "error" || c?.status === "expired"),
  };
};

export const WhatsAppService = {
  getConnectionStatus,
  connect,
  disconnect,
  updateToken,
  setActive,
  deactivate,
  getActiveProvider,
};
