import { PERMISSIONS } from "@/config/constant";
import type { PermissionLevel, PermissionMap } from "@/types/users-roles";

/** Pure port of TrackVid `components/ManageRole/UserPermissions.tsx` state changes (no lodash). */

export function isMap(value: boolean | PermissionMap | undefined): value is PermissionMap {
  return typeof value === "object" && value !== null;
}

/** `cms` → "Cms", `manage_users` → "Manage Users" (TrackVid `formatPermissionName`). */
export function formatPermissionName(name: string): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Keys of nested sub-modules (objects), never the `view` / `edit` flags. */
export function subKeys(node: PermissionMap): string[] {
  return Object.keys(node).filter((key) => key !== "view" && key !== "edit" && isMap(node[key]));
}

export function levelOf(node: PermissionMap | undefined): PermissionLevel {
  if (!node || node.view !== true) return "none";
  return node.edit === true ? "viewEdit" : "view";
}

function flags(level: PermissionLevel): { view: boolean; edit: boolean } {
  return { view: level === "view" || level === "viewEdit", edit: level === "viewEdit" };
}

/**
 * TrackVid `determineOverallPermission`: every sub-module none → none; any view+edit → viewEdit;
 * any view only → view.
 */
export function rollUp(section: PermissionMap): PermissionLevel {
  const subs = subKeys(section).map((k) => section[k]).filter(isMap);
  if (subs.every((s) => s.view !== true && s.edit !== true)) return "none";
  if (subs.some((s) => s.view === true && s.edit === true)) return "viewEdit";
  if (subs.some((s) => s.view === true && s.edit !== true)) return "view";
  return "none";
}

function cloneMap(map: PermissionMap): PermissionMap {
  return structuredClone(map);
}

/** Section radio / chip (`handleChange`): the section and every sub-module take the level. */
export function setSectionLevel(permissions: PermissionMap, section: string, level: PermissionLevel): PermissionMap {
  const next = cloneMap(permissions);
  const node = next[section];
  if (!isMap(node)) return next;
  const f = flags(level);
  for (const key of subKeys(node)) {
    const sub = node[key];
    if (isMap(sub)) {
      sub.view = f.view;
      sub.edit = f.edit;
    }
  }
  node.view = f.view;
  node.edit = f.edit;
  return next;
}

/** Sub-module radio (`handleSubPermissionChange`): set it, then roll the section up from its sub-modules. */
export function setSubLevel(permissions: PermissionMap, section: string, sub: string, level: PermissionLevel): PermissionMap {
  const next = cloneMap(permissions);
  const node = next[section];
  if (!isMap(node)) return next;
  node[sub] = flags(level);
  const overall = flags(rollUp(node));
  node.view = overall.view;
  node.edit = overall.edit;
  return next;
}

/** Header chips (`handleOverAllPermissionChange`): every section and sub-module take the level. */
export function setAllLevel(permissions: PermissionMap, level: PermissionLevel): PermissionMap {
  let next = cloneMap(permissions);
  for (const key of Object.keys(next)) next = setSectionLevel(next, key, level);
  return next;
}

/** The level shared by every row, or null when rows differ (highlights the header chip). */
export function uniformLevel(permissions: PermissionMap): PermissionLevel | null {
  const levels = new Set<PermissionLevel>();
  for (const key of Object.keys(permissions)) {
    const node = permissions[key];
    if (!isMap(node)) continue;
    levels.add(levelOf(node));
    for (const sub of subKeys(node)) {
      const s = node[sub];
      if (isMap(s)) levels.add(levelOf(s));
    }
  }
  return levels.size === 1 ? [...levels][0] : null;
}

/**
 * TrackVid merges `{ ...PERMISSIONS, ...role.permission }` so modules added after a role was saved still
 * show up. This does the same one level deeper (sub-modules too), in PERMISSIONS order.
 */
export function withAllModules(permission: PermissionMap | undefined, tree: PermissionMap = PERMISSIONS): PermissionMap {
  const out: PermissionMap = {};
  for (const [key, def] of Object.entries(tree)) {
    const own = permission?.[key];
    if (isMap(def)) {
      out[key] = withAllModules(isMap(own) ? own : undefined, def);
    } else {
      out[key] = typeof own === "boolean" ? own : def;
    }
  }
  return out;
}
