import { clone, delay, newId } from "@/mocks/delay";
import { sampleUser } from "@/mocks/user";
import type { IPlan, IUser, MessageResponse } from "@/types/common";

/** Mock of TrackVid-FE `api/user-service.ts`. State lives in memory for the page session. */

export interface IBillingProfile {
  _id: string;
  billing_name: string;
  billing_email: string;
  billing_phone: string;
  gst_number: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  address_line_1: string;
  address_line_2?: string;
  user_id: string;
  is_disabled: boolean;
  is_deleted: boolean;
}
export type ICreateBillingProfile = Omit<IBillingProfile, "_id" | "user_id" | "is_disabled" | "is_deleted">;

export interface IAppVideoSettings {
  compressPercentage: string;
  backupDuration: number;
  returnConditionPopup: { isShow: boolean; isRedirectOnBad: boolean };
}

export interface IAppECommerceSettings {
  eCommercePlatform: IUser["company"]["settings"]["eCommercePlatform"];
  spfClaimTatPeriod?: Record<string, number>;
}

export interface IAutoBookmarkVideoSettings {
  enabled: boolean;
  bookmarkOnBadCondition: boolean;
  bookmarkOnDispute: boolean;
}

export interface IMember {
  _id: string;
  name: { firstName: string; lastName: string };
  email: string;
  role: { _id: string; name: string };
  status: "active" | "invited" | "disabled";
  createdAt: string;
}

let user: IUser = clone(sampleUser);
let videoSettings: IAppVideoSettings = {
  compressPercentage: "medium",
  backupDuration: 90,
  returnConditionPopup: { isShow: true, isRedirectOnBad: false },
};
let bookmarkSettings: IAutoBookmarkVideoSettings = { enabled: true, bookmarkOnBadCondition: true, bookmarkOnDispute: false };
let billingProfiles: IBillingProfile[] = [
  {
    _id: "bill00000000000000000001",
    billing_name: "Urban Threads Pvt Ltd",
    billing_email: "accounts@urbanthreads.in",
    billing_phone: "9876543210",
    gst_number: "24ABCDE1234F1Z5",
    city: "Surat",
    state: "Gujarat",
    country: "India",
    pincode: "395002",
    address_line_1: "Plot 14, Textile Market",
    address_line_2: "Ring Road",
    user_id: sampleUser._id,
    is_disabled: false,
    is_deleted: false,
  },
];

const plans: IPlan[] = [
  ["Starter", "CREDIT", 999, 1000, 0],
  ["Growth", "CREDIT", 4999, 5000, 250],
  ["Scale", "CREDIT", 9999, 11000, 1000],
  ["Enterprise", "CREDIT", 24999, 30000, 5000],
  ["Storage 50 GB", "STORAGE", 799, 0, 0],
  ["Storage 100 GB", "STORAGE", 1499, 0, 0],
  ["Storage 500 GB", "STORAGE", 5999, 0, 0],
].map(([name, type, price, credit, bonus], i) => ({
  _id: `plan${String(i + 1).padStart(20, "0")}`,
  name: String(name),
  type: type as IPlan["type"],
  price: Number(price),
  credit: type === "CREDIT" ? Number(credit) : undefined,
  storage: type === "STORAGE" ? [50, 100, 500][i - 4] : undefined,
  bonus: Number(bonus) || undefined,
  isActive: true,
  isDeleted: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
}));

let members: IMember[] = [
  ["Aarav", "Mehta", "aarav@urbanthreads.in", "admin", "active"],
  ["Riya", "Shah", "riya@urbanthreads.in", "Packing Station", "active"],
  ["Kabir", "Patel", "kabir@urbanthreads.in", "Claims Manager", "active"],
  ["Neha", "Desai", "neha@urbanthreads.in", "Viewer", "invited"],
  ["Vikram", "Joshi", "vikram@urbanthreads.in", "Packing Station", "disabled"],
].map(([firstName, lastName, email, role, status], i) => ({
  _id: `memb${String(i + 1).padStart(20, "0")}`,
  name: { firstName, lastName },
  email,
  role: { _id: `role${String(i + 1).padStart(20, "0")}`, name: role },
  status: status as IMember["status"],
  createdAt: new Date(Date.UTC(2025, i, 3 + i)).toISOString(),
}));

const getUser = async (): Promise<IUser> => {
  await delay(300);
  return clone(user);
};

/** Marketplace passwords keyed by credential `_id` (masked in the mock). */
const getEcommerceCredentials = async (): Promise<Record<string, string[]>> => {
  await delay();
  const out: Record<string, string[]> = {};
  for (const cred of user.company.settings.eCommercePlatformLoginInfo) {
    if (cred._id) out[cred._id] = cred.info.map(() => "••••••••");
  }
  return out;
};

const updateUser = async (payload: Partial<IUser>, userId: string): Promise<IUser> => {
  await delay(500);
  if (userId !== user._id) throw new Error("User not found.");
  user = { ...user, ...payload, name: { ...user.name, ...payload.name }, company: { ...user.company, ...payload.company } };
  return clone(user);
};

const updateSubUser = async (payload: Partial<IMember>, userId: string): Promise<MessageResponse> => {
  await delay(400);
  members = members.map((m) => (m._id === userId ? { ...m, ...payload } : m));
  return { message: "User updated successfully." };
};

const getUserMembers = async (): Promise<IMember[]> => {
  await delay();
  return clone(members);
};

const deleteUser = async (payload: { id: string[] }): Promise<MessageResponse> => {
  await delay(400);
  members = members.filter((m) => !payload.id.includes(m._id));
  return { message: `${payload.id.length} user(s) deleted.` };
};

const getPlans = async (): Promise<IPlan[]> => {
  await delay();
  return clone(plans);
};

const getPlansWithUnprotectedAPI = getPlans;

const getBillingProfiles = async (): Promise<IBillingProfile[]> => {
  await delay();
  return clone(billingProfiles.filter((b) => !b.is_deleted));
};

const createBillingProfile = async (payload: ICreateBillingProfile): Promise<IBillingProfile> => {
  await delay(500);
  const profile: IBillingProfile = { ...payload, _id: newId(), user_id: user._id, is_disabled: false, is_deleted: false };
  billingProfiles = [...billingProfiles, profile];
  return clone(profile);
};

const getAppVideoSettings = async (): Promise<IAppVideoSettings> => {
  await delay();
  return clone(videoSettings);
};

const updateAppVideoSettings = async (payload: Partial<IAppVideoSettings>): Promise<MessageResponse> => {
  await delay(400);
  videoSettings = { ...videoSettings, ...payload };
  return { message: "Video settings updated." };
};

const getAppECommerceSettings = async (): Promise<IAppECommerceSettings> => {
  await delay();
  return clone({
    eCommercePlatform: user.company.settings.eCommercePlatform,
    spfClaimTatPeriod: user.company.settings.spfClaimTatPeriod,
  });
};

const updateAppECommerceSettings = async (payload: IAppECommerceSettings): Promise<MessageResponse> => {
  await delay(400);
  user = { ...user, company: { ...user.company, settings: { ...user.company.settings, ...payload } } };
  return { message: "E-commerce settings updated." };
};

const checkPassword = async (payload: { password: string }): Promise<{ valid: boolean }> => {
  await delay(400);
  return { valid: payload.password.length >= 6 };
};

const getAutoBookmarkVideoSettings = async (): Promise<IAutoBookmarkVideoSettings> => {
  await delay();
  return clone(bookmarkSettings);
};

const updateAutoBookmarkVideoSettings = async (payload: Partial<IAutoBookmarkVideoSettings>): Promise<MessageResponse> => {
  await delay(300);
  bookmarkSettings = { ...bookmarkSettings, ...payload };
  return { message: "Auto bookmark settings updated." };
};

export const UserService = {
  getUser,
  getEcommerceCredentials,
  updateUser,
  getUserMembers,
  deleteUser,
  getPlans,
  getBillingProfiles,
  createBillingProfile,
  getAppVideoSettings,
  getAppECommerceSettings,
  updateAppVideoSettings,
  updateAppECommerceSettings,
  updateSubUser,
  getPlansWithUnprotectedAPI,
  checkPassword,
  getAutoBookmarkVideoSettings,
  updateAutoBookmarkVideoSettings,
};
