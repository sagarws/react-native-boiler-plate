import { DefaultECommercePlatforms, PERMISSIONS } from "@/config/constant";
import type { IEcommerce, IUser, PermissionMap } from "@/types/common";

/** Every permission in TrackVid's tree switched on (the sample user can open every screen). */
function grantAll(map: PermissionMap): PermissionMap {
  const out: PermissionMap = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = typeof value === "boolean" ? true : grantAll(value);
  }
  return out;
}

export const allPermissions: PermissionMap = grantAll(PERMISSIONS);

export const samplePlatforms: IEcommerce[] = [
  ...DefaultECommercePlatforms.map((p, i) => ({
    _id: `plat${String(i + 1).padStart(20, "0")}`,
    name: p.name,
    tatPeriod: [30, 15, 30, 30, 15, 30, 15, 30, 30][i] ?? 30,
    typeOfClaims: p.typeOfClaims.map((c) => ({ ...c, isDisable: Boolean(c.isDisable) })),
  })),
  // Snapdeal is not in TrackVid's default catalogue; the sample company has it so its claim form can be reviewed.
  {
    _id: `plat${String(DefaultECommercePlatforms.length + 1).padStart(20, "0")}`,
    name: "Snapdeal",
    tatPeriod: 15,
    typeOfClaims: [
      { name: "Wrong product received", description: "Wrong product received", isDisable: false },
      { name: "Damaged product received", description: "Damaged product received", isDisable: false },
      { name: "Missing product", description: "Missing product", isDisable: false },
    ],
  },
];

export const sampleUser: IUser = {
  _id: "64f0c0ffee0000000000a001",
  name: { firstName: "Aarav", lastName: "Mehta" },
  email: "aarav@urbanthreads.in",
  phone: { code: "+91", number: "9876543210", countryCode: "IN" },
  role: { _id: "64f0c0ffee0000000000r001", name: "admin", isAdmin: true, permission: allPermissions },
  status: "active",
  isActive: true,
  isDeleted: false,
  isEmailVerified: true,
  planId: "64f0c0ffee0000000000p001",
  members: [],
  companyId: "64f0c0ffee0000000000c001",
  createdAt: "2024-03-02T09:30:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
  company: {
    name: "Urban Threads",
    fileKey: "",
    fileName: "",
    gst_number: "24ABCDE1234F1Z5",
    baseLinkToken: "bl_7f3a91c2",
    creditPlan: {
      _id: "64f0c0ffee0000000000p001",
      name: "Growth",
      type: "CREDIT",
      price: 4999,
      credit: 5000,
      bonus: 250,
      isActive: true,
      isDeleted: false,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    storagePlan: {
      _id: "64f0c0ffee0000000000p101",
      name: "Storage 100 GB",
      type: "STORAGE",
      price: 1499,
      storage: 100,
      isActive: true,
      isDeleted: false,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    creditId: {
      _id: "64f0c0ffee0000000000k001",
      totalCredit: 5250,
      usedCredit: 3412,
      remainingCredit: 1838,
      totalStorage: 100,
      usedStorage: 61.4,
      remainingStorage: 38.6,
      companyId: "64f0c0ffee0000000000c001",
      userId: "64f0c0ffee0000000000a001",
    },
    settings: {
      isUsingMasterData: true,
      increffBulkClaim: true,
      cmsAppVersion: null,
      compressPercentage: 40,
      backupDuration: 90,
      eCommercePlatform: samplePlatforms,
      eCommercePlatformLoginInfo: [
        {
          eComPlatform: "Ajio",
          _id: "cred0000000000000000001",
          info: [{ username: "ops@urbanthreads.in", password: "", is_verified: true, vendorCode: "UT1029" }],
        },
        {
          eComPlatform: "Myntra",
          _id: "cred0000000000000000002",
          info: [{ username: "myntra@urbanthreads.in", password: "", is_verified: false }],
        },
        {
          eComPlatform: "Flipkart",
          _id: "cred0000000000000000003",
          info: [{ username: "fk@urbanthreads.in", password: "", is_verified: true }],
        },
      ],
      increffAllocation: [
        { platform: "ajio", allowed: true },
        { platform: "myntra", allowed: false },
      ],
      spfClaimTatPeriod: { ajio: 30, myntra: 15, flipkart: 30, amazon: 30, meesho: 15 },
      integrationAccess: {
        email: true,
        ajio: true,
        meesho: true,
        snapdeal: true,
        myntra: true,
        nykaa: true,
        flipkart: true,
        delhivery: true,
        xbees: true,
        tatacliq: true,
        google_drive: true,
        base: true,
        increff: true,
        kwikengage: true,
        mark360: true,
        "11za": true,
        zoho: true,
        whatsapp: true,
      },
    },
  },
};
