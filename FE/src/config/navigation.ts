import type { IconName } from "@/components/icons/icon";
import ROUTE_URLS from "@/config/route";

export interface NavChild {
  id: string;
  label: string;
  path: string;
  /** Hidden when the company has the CMS desktop app. */
  hideWithCmsApp?: boolean;
}

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: IconName;
  roles: readonly string[];
  permissions: readonly string[];
  children?: readonly NavChild[];
  /** Hidden for Video-Link-only users (Dashboard, Refer & Earn). */
  hideForVideoLinkOnly?: boolean;
  /** Shows the pending AJIO email count. */
  badge?: "pendingEmails";
}

export interface NavSection {
  label: string;
  items: readonly NavItem[];
}

/** TrackVid sidebar (same items, order, roles and permissions as `Layout.tsx`), grouped like the template. */
export const navigationSections: readonly NavSection[] = [
  {
    label: "Workspace",
    items: [
      { id: "dashboard", label: "Dashboard", path: ROUTE_URLS.DASHBOARD, icon: "squares-four", roles: ["admin"], permissions: [], hideForVideoLinkOnly: true },
      { id: "vms", label: "VMS", path: ROUTE_URLS.VMS, icon: "video-camera", roles: ["admin"], permissions: ["vms::view"] },
      {
        id: "cms",
        label: "CMS",
        path: ROUTE_URLS.CMS,
        icon: "clipboard-text",
        roles: ["admin"],
        permissions: ["cms::view"],
        children: [
          { id: "cms-create", label: "Create SPF Claim", path: ROUTE_URLS.CMS_CREATE, hideWithCmsApp: true },
          { id: "cms-manage", label: "Manage SPF Claims", path: ROUTE_URLS.CMS },
        ],
      },
      { id: "rms", label: "RMS", path: ROUTE_URLS.RMS, icon: "chart-bar", roles: ["admin"], permissions: ["rms::view"] },
      { id: "feed", label: "Feed", path: ROUTE_URLS.FEED, icon: "monitor", roles: ["admin"], permissions: ["feed::view"] },
      { id: "emails", label: "AJIO Emails", path: ROUTE_URLS.EMAILS, icon: "envelope", roles: ["admin"], permissions: ["email::view"], badge: "pendingEmails" },
      { id: "favorite", label: "Favorites", path: ROUTE_URLS.FAVORITE, icon: "star", roles: ["admin"], permissions: ["favorite::view"] },
    ],
  },
  {
    label: "Data",
    items: [
      { id: "master-data", label: "Master Data", path: ROUTE_URLS.MASTER_DATA, icon: "database", roles: ["admin"], permissions: ["master_data::view"] },
      { id: "sku", label: "SKU Data", path: ROUTE_URLS.SKU, icon: "barcode", roles: ["admin"], permissions: ["sku::view"] },
      { id: "imports", label: "External Imports", path: ROUTE_URLS.IMPORTS, icon: "upload", roles: ["admin"], permissions: ["external_imports::view"] },
      { id: "pending-failed", label: "Pending & Failed Orders", path: ROUTE_URLS.PENDING_FAILED_ORDERS, icon: "warning", roles: ["admin", "system_admin"], permissions: [""] },
    ],
  },
  {
    label: "Account",
    items: [
      { id: "manage-users", label: "Manage Users", path: ROUTE_URLS.MANAGE_USER, icon: "users", roles: ["admin"], permissions: ["manage_users::view"] },
      { id: "accounts", label: "Accounts", path: ROUTE_URLS.ACCOUNTS, icon: "bank", roles: ["admin"], permissions: ["accounts::view"] },
      { id: "integrations", label: "Integrations", path: ROUTE_URLS.INTEGRATIONS, icon: "plug", roles: ["admin"], permissions: ["integrations::view"] },
      { id: "video-link", label: "Video Link", path: ROUTE_URLS.VIDEO_LINK, icon: "link", roles: ["admin"], permissions: ["video_link::view"] },
      { id: "refer", label: "Refer & Earn", path: ROUTE_URLS.REFER_AND_EARN, icon: "gift", roles: ["admin"], permissions: [], hideForVideoLinkOnly: true },
    ],
  },
  {
    label: "Help",
    items: [
      { id: "support", label: "Support", path: ROUTE_URLS.SUPPORT, icon: "headset", roles: ["admin"], permissions: ["support::view"] },
      { id: "whats-new", label: "What's New", path: ROUTE_URLS.WHATS_NEW, icon: "sparkle", roles: ["admin"], permissions: ["whats_new::view"] },
      { id: "system-admin", label: "System Admin", path: ROUTE_URLS.SYSTEM_ADMIN, icon: "shield", roles: ["system_admin"], permissions: [""] },
    ],
  },
];

export interface RouteAccess {
  title: string;
  roles: readonly string[];
  permissions: readonly string[];
}

/** Route guard table: same `AccessRestriction` roles / permissions as TrackVid-FE `App.tsx`. */
export const routeAccess: Record<string, RouteAccess> = {
  [ROUTE_URLS.DASHBOARD]: { title: "Dashboard", roles: [], permissions: [] },
  [ROUTE_URLS.VIDEO_LINK]: { title: "Video Link", roles: ["admin"], permissions: ["video_link::view"] },
  [ROUTE_URLS.VMS]: { title: "VMS", roles: ["admin"], permissions: ["vms::view"] },
  [ROUTE_URLS.CMS]: { title: "Manage SPF Claims", roles: ["admin"], permissions: ["cms::view"] },
  [ROUTE_URLS.CMS_CREATE]: { title: "Create SPF Claim", roles: ["admin"], permissions: ["cms::view"] },
  [ROUTE_URLS.CMS_UPDATE]: { title: "Update SPF Claim", roles: ["admin"], permissions: ["cms::view"] },
  [ROUTE_URLS.RMS]: { title: "RMS", roles: ["admin"], permissions: ["rms::view"] },
  [ROUTE_URLS.MANAGE_USER]: { title: "Manage User", roles: ["admin"], permissions: ["manage_users::view"] },
  [ROUTE_URLS.MANAGE_ROLE]: { title: "Manage Role", roles: ["admin"], permissions: ["manage_roles::view"] },
  [ROUTE_URLS.FAVORITE]: { title: "Favorites", roles: ["admin"], permissions: ["favorite::view"] },
  [ROUTE_URLS.ACCOUNTS]: { title: "Accounts", roles: ["admin"], permissions: ["accounts::view"] },
  [ROUTE_URLS.PROFILE]: { title: "Profile", roles: ["admin"], permissions: ["profile::view"] },
  [ROUTE_URLS.FEED]: { title: "Feed", roles: ["admin"], permissions: ["feed::view"] },
  [ROUTE_URLS.EMAILS]: { title: "AJIO Emails", roles: ["admin"], permissions: ["email::view"] },
  "/mailboxes": { title: "Mailbox Logs", roles: ["admin"], permissions: ["email::mailbox::view"] },
  [ROUTE_URLS.MASTER_DATA]: { title: "Master Data", roles: ["admin"], permissions: ["master_data::view"] },
  [ROUTE_URLS.SKU]: { title: "SKU Data", roles: ["admin"], permissions: ["sku::view"] },
  [ROUTE_URLS.IMPORTS]: { title: "External Imports", roles: ["admin"], permissions: ["external_imports::view"] },
  [ROUTE_URLS.INTEGRATIONS]: { title: "Integrations", roles: ["admin"], permissions: ["integrations::view"] },
  [ROUTE_URLS.PENDING_FAILED_ORDERS]: { title: "Pending & Failed Orders", roles: ["admin", "system_admin"], permissions: [""] },
  [ROUTE_URLS.REFER_AND_EARN]: { title: "Refer & Earn", roles: [], permissions: [] },
  [ROUTE_URLS.SUPPORT]: { title: "Support", roles: ["admin"], permissions: ["support::view"] },
  [ROUTE_URLS.WHATS_NEW]: { title: "What's New", roles: ["admin"], permissions: ["whats_new::view"] },
  [ROUTE_URLS.SYSTEM_ADMIN]: { title: "System Admin", roles: ["system_admin"], permissions: [""] },
  [ROUTE_URLS.SETTINGS]: { title: "Settings", roles: ["admin"], permissions: ["settings::view"] },
};

/** Access rule for a pathname (`/mailboxes/:id/logs` maps to `/mailboxes`). */
export function accessForPath(pathname: string): RouteAccess | undefined {
  if (routeAccess[pathname]) return routeAccess[pathname];
  if (pathname.startsWith("/mailboxes/")) return routeAccess["/mailboxes"];
  return undefined;
}
