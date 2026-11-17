import { navigationRoutes } from "@/config/navigation";

/** A page the dashboard can render, as listed in the navigation config. */
export interface RouteEntry {
  id: string;
  label: string;
  path: string;
  group?: string;
  parentPath?: string;
}

const routes: RouteEntry[] = (navigationRoutes as RouteEntry[]).map(
  ({ id, label, path, group, parentPath }) => ({ id, label, path, group, parentPath }),
);

const COMMERCE_PREFIX = "/commerce/";

/** Every route, including the overview and the product editor. */
export function allRoutes(): RouteEntry[] {
  return routes;
}

/** Module ids served by `/commerce/[moduleId]` (one path segment). */
export function commerceModuleIds(): string[] {
  return routes
    .filter((route) => route.path.startsWith(COMMERCE_PREFIX))
    .map((route) => route.path.slice(COMMERCE_PREFIX.length))
    .filter((segment) => !segment.includes("/"));
}

/** Page title for a pathname, e.g. "Orders" for `/commerce/orders`. */
export function routeTitle(pathname: string): string {
  if (pathname === "/overview") return "Overview";
  return routes.find((route) => route.path === pathname)?.label ?? "Page not found";
}
