// @ts-nocheck
import { settingsSections } from "@/config/modules/settings-sections";

export const settingsSectionEntries = Object.entries(settingsSections);

export const brandAssetFields = [
  {
    key: "favicon",
    label: "Favicon",
    upload: "Upload favicon",
    help: "Used in browser tabs. PNG, JPEG, WebP or ICO · up to 600 KB.",
  },
  {
    key: "sidebarLogo",
    label: "Sidebar logo",
    upload: "Upload sidebar logo",
    help: "Shown in the left admin sidebar. PNG, JPEG, WebP or ICO · up to 600 KB.",
  },
  {
    key: "siteLogo",
    label: "Main site logo",
    upload: "Upload site logo",
    help: "Used in storefront previews. PNG, JPEG, WebP or ICO · up to 600 KB.",
  },
];

export const BRAND_ASSET_ACCEPT =
  "image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico";
