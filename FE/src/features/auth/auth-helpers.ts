import ROUTE_URLS from "@/config/route";
import type { IPhone } from "@/types/common";

/** India by default, like TrackVid's `MuiTelInput defaultCountry="IN"`. */
export const DEFAULT_PHONE: IPhone = { code: "+91", number: "", countryCode: "IN" };

/** Field error text only after the field was touched (TrackVid `touched && errors`). */
export function fieldError(touched: boolean | undefined, error: string | undefined): string | undefined {
  return touched && error ? error : undefined;
}

/**
 * Where to go after sign-in: the `redirect` query param when it is a same-site path, else the dashboard.
 * Rejects protocol-relative (`//evil.com`) and backslash tricks so it cannot become an open redirect.
 */
export function safeRedirect(target: string | null): string {
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return ROUTE_URLS.DASHBOARD;
  if (target.startsWith(ROUTE_URLS.AUTH)) return ROUTE_URLS.DASHBOARD;
  return target;
}
