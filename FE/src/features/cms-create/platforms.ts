import type { IUser } from "@/types/common";
import type { IECommercePlatformClaim } from "@/types/cms-create";

/** TrackVid `components/Cms/create/platforms/index.ts` — the platforms with a dedicated form. */
export type PlatformKey = "ajio" | "meesho" | "myntra" | "snapdeal" | "nykaa" | "amazon" | "shopify" | "flipkart" | "tataCliq" | "delhivery" | "xbees";

export const PLATFORM_LIST: { key: PlatformKey; label: string; dot: string }[] = [
  { key: "ajio", label: "AJIO", dot: "#0088A3" },
  { key: "meesho", label: "Meesho", dot: "#F43F5E" },
  { key: "myntra", label: "Myntra", dot: "#D946EF" },
  { key: "snapdeal", label: "Snapdeal", dot: "#E11D48" },
  { key: "nykaa", label: "Nykaa Fashion", dot: "#EC4899" },
  { key: "amazon", label: "Amazon", dot: "#F59E0B" },
  { key: "shopify", label: "Shopify", dot: "#16A34A" },
  { key: "flipkart", label: "Flipkart", dot: "#2874F0" },
  { key: "tataCliq", label: "Tata CliQ", dot: "#663399" },
  { key: "delhivery", label: "Delhivery", dot: "#E31E24" },
  { key: "xbees", label: "Xbees", dot: "#0E7C86" },
];

const KEYS = new Set<string>(PLATFORM_LIST.map((p) => p.key));
export const isPlatformKey = (v: string): v is PlatformKey => KEYS.has(v);

export const resolvePlatformKey = (label: string | undefined): PlatformKey => {
  const l = (label || "").trim().toLowerCase();
  const found = PLATFORM_LIST.find((p) => p.key.toLowerCase() === l || p.label.toLowerCase() === l);
  return found?.key || "ajio";
};

export interface PlatformOption {
  key: string;
  label: string;
  dot: string;
  isCustom?: boolean;
}

const CUSTOM_DOTS = ["#8B5CF6", "#F97316", "#0EA5E9", "#65A30D", "#DB2777"];

/**
 * Dropdown options from the company's platform list (same rule as CreateCms): a DB platform whose lowercased name
 * equals a PLATFORM_LIST label gets that entry; anything else is custom and keys off its own lowercased name.
 */
export function buildPlatformOptions(platforms: readonly { name: string }[]): PlatformOption[] {
  const known = new Map(PLATFORM_LIST.map((p) => [p.label.toLowerCase(), p]));
  let customIdx = 0;
  return platforms
    .filter((p) => p?.name)
    .map((p) => {
      const hit = known.get(p.name.toLowerCase());
      if (hit) return { key: hit.key, label: hit.label, dot: hit.dot };
      const dot = CUSTOM_DOTS[customIdx++ % CUSTOM_DOTS.length];
      return { key: p.name.toLowerCase(), label: p.name, dot, isCustom: true };
    });
}

/** "Tata CLiQ", "tataCliq" and "tata cliq" all become "TATACLIQ". */
export const platformIdentity = (value: unknown): string =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[\s_-]+/g, "")
    .trim();

/** The company's de-duplicated seller accounts on one platform (TrackVid `platformAccounts`). */
export function platformAccounts(user: IUser | null | undefined, platform: string): string[] {
  const target = platformIdentity(platform);
  if (!target) return [];
  const list = user?.company?.settings?.eCommercePlatformLoginInfo ?? [];
  const entry = list.find((e) => platformIdentity(e.eComPlatform) === target);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const account of entry?.info ?? []) {
    const raw = String(account?.username ?? "").trim();
    if (!raw || seen.has(raw.toLowerCase())) continue;
    seen.add(raw.toLowerCase());
    out.push(raw);
  }
  return out;
}

/** Collapses case and `_` / space / `-` so "SHORT_QUANTITY" and "short quantity" are the same claim. */
const claimIdentity = (value: unknown): string =>
  (value == null ? "" : String(value))
    .trim()
    .toUpperCase()
    .replace(/[_\s-]+/g, "");

/** Which catalogue entry a stored `typeOfClaim` is: strict match first, then the loose one. Null = not this platform's. */
export function matchClaimTypeOption<T extends IECommercePlatformClaim>(options: readonly T[], stored: string): T | null {
  if (!stored) return null;
  const strict = options.find((item) => item.key === stored || item.name === stored);
  if (strict) return strict;
  const target = claimIdentity(stored);
  return options.find((item) => claimIdentity(item.key) === target || claimIdentity(item.name) === target) || null;
}

/** Normalised the same way as the BE's `normalizePlatform` ("tataCliq" → "tatacliq"). */
export const automationKey = (key: string): string =>
  key
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, "");
