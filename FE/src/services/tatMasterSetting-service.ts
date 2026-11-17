import { delay, newId } from "@/mocks/delay";
import { sampleAccountPasswords } from "@/mocks/integrations";
import { UserService } from "@/services/user-service";
import type { IEcommerceLoginInfo, IUser } from "@/types/common";
import type { ApiResult, IEcommerceAccountInfo, MasterTatSettingPayload, RemoveAccountPayload } from "@/types/integrations";

/**
 * Mock of TrackVid-FE `api/tatMasterSetting-service.ts` (`/master-setting`). Marketplace logins live on
 * the user's company (`company.settings.eCommercePlatformLoginInfo`) in the mock UserService; passwords
 * are kept here and never put back on the profile (TrackVid's get-user carries none either).
 */

/** Mask `UserService.getEcommerceCredentials` puts in every password field: means "unchanged". */
export const MASKED_PASSWORD = "••••••••";

const passwords: Record<string, string> = { ...sampleAccountPasswords };

/** "Tata CLiQ" / "TATACLIQ" / "tata-cliq" → "tatacliq"; "Nykaa Fashion" → "nykaa". */
export function normalizePlatform(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (slug === "nykaafashion") return "nykaa";
  if (slug === "expressbees") return "xbees";
  return slug;
}

/**
 * Id of one stored login. Accounts saved before ids were assigned (the sample data) use
 * `<loginInfoId>-<index>`; every write below stamps that id onto the row so it stays stable.
 */
export function ecommerceAccountId(loginInfoId: string | undefined, index: number, info: IEcommerceAccountInfo): string {
  return info._id ?? `${loginInfoId ?? "login"}-${index}`;
}

/** Mock portal login: a password of 6+ characters that is not obviously wrong "verifies". */
function verifyLogin(username: string, password: string): boolean {
  return username.trim().length > 2 && password.length >= 6 && !/wrong|invalid/i.test(password);
}

async function saveLoginInfo(user: IUser, next: IEcommerceLoginInfo[]): Promise<void> {
  await UserService.updateUser(
    { company: { ...user.company, settings: { ...user.company.settings, eCommercePlatformLoginInfo: next } } },
    user._id,
  );
}

const labelOf = (platform: string) => {
  const key = normalizePlatform(platform);
  const labels: Record<string, string> = { nykaa: "Nykaa Fashion", tatacliq: "Tata CLiQ", ajio: "AJIO" };
  return labels[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
};

/** Upsert the seller logins of one or more marketplaces and verify each against the (mock) portal. */
const MaterTatSetting = async (payload: MasterTatSettingPayload): Promise<ApiResult> => {
  await delay(1200);
  const user = await UserService.getUser();
  if (payload.companyId !== user.companyId) return { isSuccess: false, displayMessage: "Company not found." };

  let loginInfo: IEcommerceLoginInfo[] = user.company.settings.eCommercePlatformLoginInfo ?? [];
  let total = 0;
  let verifiedCount = 0;

  for (const entry of payload.eCommercePlatformLoginInfo) {
    const key = normalizePlatform(entry.eComPlatform);
    const label = labelOf(entry.eComPlatform);
    for (const acc of entry.info) {
      if (key === "nykaa" && !acc.vendorCode?.trim()) return { isSuccess: false, displayMessage: `Vendor code is required for every ${label} account.` };
      if (key === "meesho" && !/^\+?\d{10,13}$/.test((acc.phoneNumber ?? "").replace(/\s/g, ""))) {
        return { isSuccess: false, displayMessage: "Enter a valid callback number for every Meesho account." };
      }
      if (!acc._id && !acc.password) return { isSuccess: false, displayMessage: `Enter a password for ${acc.username}.` };
    }

    const existing = loginInfo.find((l) => normalizePlatform(l.eComPlatform) === key);
    const loginInfoId = existing?._id ?? newId();
    const info: IEcommerceAccountInfo[] = entry.info.map((acc) => {
      const id = acc._id ?? newId();
      // Blank or masked means "keep the stored password", never "erase it".
      if (acc.password && acc.password !== MASKED_PASSWORD) passwords[id] = acc.password;
      const verified = verifyLogin(acc.username, passwords[id] ?? "");
      total += 1;
      if (verified) verifiedCount += 1;
      return { ...acc, _id: id, password: "", is_verified: verified, visible: true };
    });

    loginInfo = existing
      ? loginInfo.map((l) => (l === existing ? { ...l, _id: loginInfoId, info } : l))
      : [...loginInfo, { eComPlatform: entry.eComPlatform, _id: loginInfoId, info }];
  }

  await saveLoginInfo(user, loginInfo);
  return {
    isSuccess: true,
    displayMessage:
      verifiedCount === total
        ? "Accounts saved and verified successfully."
        : `Accounts saved. ${total - verifiedCount} account(s) could not be verified — check the username and password.`,
  };
};

/** Turns Master Data on / off for the company (TrackVid `MasterSetting` toggle). */
const MasterDataActiveOrNot = async (companyId: string): Promise<ApiResult> => {
  await delay(500);
  const user = await UserService.getUser();
  if (companyId !== user.companyId) return { isSuccess: false, displayMessage: "Company not found." };
  const next = !user.company.settings.isUsingMasterData;
  await UserService.updateUser({ company: { ...user.company, settings: { ...user.company.settings, isUsingMasterData: next } } }, user._id);
  return { isSuccess: true, displayMessage: next ? "Master Data activated." : "Master Data deactivated." };
};

/** Removes one seller login (the endpoint name is historical: it serves every marketplace). */
const masterRemoveAjio = async (payload: RemoveAccountPayload): Promise<ApiResult> => {
  await delay(600);
  const user = await UserService.getUser();
  if (payload.companyId !== user.companyId) return { isSuccess: false, displayMessage: "Company not found." };
  const loginInfo = user.company.settings.eCommercePlatformLoginInfo ?? [];
  let removed = false;
  const next = loginInfo.map((l) => {
    if (payload.eCommercePlatformLoginInfoId && l._id !== payload.eCommercePlatformLoginInfoId) return l;
    const stamped: IEcommerceAccountInfo[] = l.info.map((acc, i) => ({ ...acc, _id: ecommerceAccountId(l._id, i, acc) }));
    const kept = stamped.filter((acc) => acc._id !== payload.accountId);
    if (kept.length !== stamped.length) removed = true;
    return { ...l, info: kept };
  });
  if (!removed) return { isSuccess: false, displayMessage: "Account not found." };
  delete passwords[payload.accountId];
  await saveLoginInfo(user, next);
  return { isSuccess: true, displayMessage: "Account removed successfully." };
};

/** Mock-only lookup used by the session renew mock: the stored password of one login. */
export function storedPasswordFor(accountId: string): string | undefined {
  return passwords[accountId];
}

export const tatMasterSettingService = {
  MaterTatSetting,
  MasterDataActiveOrNot,
  masterRemoveAjio,
};
