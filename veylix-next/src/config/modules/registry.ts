// @ts-nocheck
import { catalogModules } from "@/config/modules/catalog";
import { checkoutMarketplaceModules } from "@/config/modules/checkout-marketplace";
import { onlineStoreModules } from "@/config/modules/online-store";
import { operationsModules } from "@/config/modules/operations";
import { workspaceModules } from "@/config/modules/workspace";

const allModules = [
  ...catalogModules,
  ...operationsModules,
  ...checkoutMarketplaceModules,
  ...onlineStoreModules,
  ...workspaceModules,
];

export const modulesById = Object.fromEntries(allModules.map((e) => [e.id, e]));

export function modulePath(e) {
  return `/commerce/${e}`;
}
