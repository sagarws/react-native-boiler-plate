// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { modulesById } from "@/config/modules/registry";
import { permissionAreas } from "@/config/permissions";
import {
  permissionActionKeys,
  permissionActionLabels,
} from "@/features/access/constants";
import { readRolePermissions } from "@/features/access/lib/permissions";
import { showToast } from "@/lib/events";
import { buildHref } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";
import { readPreference, savePreference } from "@/lib/store/preferences";

export function PermissionsPage() {
  const e = modulesById.permissions;
  const t = listRecords("roles");
  const [n, r] = useState(t[0]?.id || "");
  const [i, a] = useState(0);
  const o = useMemo(() => readRolePermissions(t), [t, i]);
  const [s, c] = useState(() => o[n] || {});
  const u = (e) => {
    r(e);
    c(readRolePermissions(t)[e] || {});
  };
  const d = (e, t, n) => {
    c((r) => ({
      ...r,
      [e]: {
        ...(r[e] || {
          view: false,
          create: false,
          edit: false,
          archive: false,
        }),
        [t]: n,
      },
    }));
  };
  return (
    <Fragment>
      <CommercePageHeading
        title={e.title}
        actions={
          <Link
            className="secondary-button"
            href={buildHref("/commerce/roles")}
          >
            Manage roles
            <Icon name="arrow-right" />
          </Link>
        }
      />
      <section className="glass-card">
        <div className="c-toolbar">
          <label>
            {"Role "}
            <select
              data-role-picker
              value={n}
              onChange={(e) => u(e.currentTarget.value)}
            >
              {t.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            data-c-action="save-permissions"
            data-id={n}
            onClick={() => {
              for (const e of Object.values(s))
                if (!e.view && (e.create || e.edit || e.archive)) {
                  showToast(
                    "Enable View for every area that allows create, edit or archive.",
                  );
                  return;
                }
              const e = readPreference("permissions", {});
              e[n] = s;
              savePreference("permissions", e);
              a((e) => e + 1);
              showToast("Permission policy saved locally.");
            }}
          >
            Save permissions
          </button>
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Role permissions"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Area</th>
                {permissionActionLabels.map((e) => (
                  <th key={e} scope="col">
                    {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissionAreas.map((e) => (
                <tr key={e}>
                  <td>
                    <strong>{e}</strong>
                  </td>
                  {permissionActionKeys.map((t) => (
                    <td key={t}>
                      <input
                        type="checkbox"
                        data-permission={t}
                        data-area={e}
                        aria-label={`${t} ${e}`}
                        checked={!!s[e]?.[t]}
                        onChange={(n) => d(e, t, n.currentTarget.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Fragment>
  );
}
