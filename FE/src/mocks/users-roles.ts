import { PERMISSIONS } from "@/config/constant";
import { daysAgo } from "@/mocks/delay";
import type { ICompanyUser, IRole, PermissionLevel, PermissionMap } from "@/types/users-roles";

/** Builds a role permission tree from PERMISSIONS: listed modules get the level, the rest "none". */
function buildPermissions(levels: Record<string, PermissionLevel>): PermissionMap {
  const apply = (node: PermissionMap, level: PermissionLevel): PermissionMap => {
    const out: PermissionMap = {};
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "boolean") {
        out[key] = key === "view" ? level !== "none" : key === "edit" ? level === "viewEdit" : value;
      } else {
        out[key] = apply(value, level);
      }
    }
    return out;
  };
  const out: PermissionMap = {};
  for (const [key, value] of Object.entries(PERMISSIONS)) {
    out[key] = typeof value === "boolean" ? value : apply(value, levels[key] ?? "none");
  }
  return out;
}

const COMPANY_ADMIN = "64f0c0ffee0000000000a001";

export const sampleRoles: IRole[] = [
  {
    _id: "role00000000000000000001",
    name: "packing_station",
    description: "Records dispatch and return videos at the packing table.",
    createdBy: COMPANY_ADMIN,
    permission: buildPermissions({ vms: "viewEdit", feed: "view", favorite: "viewEdit", profile: "viewEdit" }),
    systemKey: null,
    createdAt: daysAgo(300),
    updatedAt: daysAgo(40),
  },
  {
    _id: "role00000000000000000002",
    name: "claims_manager",
    description: "Raises and tracks marketplace claims (CMS, RMS) and reviews videos.",
    createdBy: COMPANY_ADMIN,
    permission: buildPermissions({
      vms: "view",
      video_link: "viewEdit",
      cms: "viewEdit",
      rms: "viewEdit",
      favorite: "viewEdit",
      external_imports: "viewEdit",
      master_data: "view",
      sku_data: "view",
      profile: "viewEdit",
      support: "viewEdit",
    }),
    systemKey: null,
    createdAt: daysAgo(280),
    updatedAt: daysAgo(12),
  },
  {
    _id: "role00000000000000000003",
    name: "accounts",
    description: "Buys credits and storage, downloads invoices.",
    createdBy: COMPANY_ADMIN,
    permission: buildPermissions({ accounts: "viewEdit", profile: "viewEdit", support: "view" }),
    systemKey: null,
    createdAt: daysAgo(200),
    updatedAt: daysAgo(200),
  },
  {
    _id: "role00000000000000000004",
    name: "viewer",
    description: "",
    createdBy: COMPANY_ADMIN,
    permission: buildPermissions({ vms: "view", cms: "view", rms: "view", favorite: "view", profile: "view" }),
    systemKey: null,
    createdAt: daysAgo(150),
    updatedAt: daysAgo(150),
  },
  {
    _id: "role00000000000000000005",
    name: "Video Link Viewer",
    description: "Built-in role: can open shared video links only.",
    createdBy: "system",
    permission: buildPermissions({ video_link: "view" }),
    systemKey: "video_link_viewer",
    createdAt: daysAgo(400),
    updatedAt: daysAgo(400),
  },
];

const roleRef = (index: number) => ({ _id: sampleRoles[index]._id, name: sampleRoles[index].name });

export const sampleCompanyUsers: ICompanyUser[] = [
  { _id: "cusr00000000000000000001", email: "riya@urbanthreads.in", name: { firstName: "Riya", lastName: "Shah" }, role: roleRef(0), status: "Accepted", createdAt: daysAgo(210) },
  { _id: "cusr00000000000000000002", email: "kabir@urbanthreads.in", name: { firstName: "Kabir", lastName: "Patel" }, role: roleRef(1), status: "Accepted", createdAt: daysAgo(160) },
  { _id: "cusr00000000000000000003", email: "station2@urbanthreads.in", role: roleRef(0), status: "Accepted", createdAt: daysAgo(120) },
  { _id: "cusr00000000000000000004", email: "finance@urbanthreads.in", role: roleRef(2), status: "Pending", createdAt: daysAgo(9) },
  { _id: "cusr00000000000000000005", email: "neha.desai@gmail.com", role: roleRef(3), status: "Pending", createdAt: daysAgo(4) },
  { _id: "cusr00000000000000000006", email: "vikram@urbanthreads.in", role: roleRef(1), status: "Rejected", createdAt: daysAgo(60) },
  { _id: "cusr00000000000000000007", email: "ops.delhivery@urbanthreads.in", role: roleRef(4), status: "Accepted", createdAt: daysAgo(30) },
];
