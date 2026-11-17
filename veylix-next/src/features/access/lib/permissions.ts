// @ts-nocheck
import { permissionAreas } from "@/config/permissions";
import { readPreference } from "@/lib/store/preferences";

function buildDefaultRolePermissions(e) {
  return Object.fromEntries(
    e.map((e, t) => [
      e.id,
      Object.fromEntries(
        permissionAreas.map((e, n) => [
          e,
          {
            view: t === 0 || n < 4 || n === 8,
            create: t === 0 || (t === 2 && n === 2),
            edit: t === 0 || (t === 1 && n === 8),
            archive: t === 0,
          },
        ]),
      ),
    ]),
  );
}

export function readRolePermissions(e) {
  return {
    ...buildDefaultRolePermissions(e),
    ...readPreference("permissions", {}),
  };
}
