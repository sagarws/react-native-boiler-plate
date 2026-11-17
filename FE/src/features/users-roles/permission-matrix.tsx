"use client";

import { Fragment } from "react";
import type { PermissionLevel, PermissionMap } from "@/types/users-roles";
import {
  formatPermissionName,
  isMap,
  levelOf,
  setAllLevel,
  setSectionLevel,
  setSubLevel,
  subKeys,
  uniformLevel,
} from "@/features/users-roles/permission-logic";

const LEVELS: readonly { value: PermissionLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "view", label: "View" },
  { value: "viewEdit", label: "View & Edit" },
];

function RadioCells({
  name,
  value,
  label,
  disabled,
  onChange,
}: {
  name: string;
  value: PermissionLevel;
  label: string;
  disabled: boolean;
  onChange: (level: PermissionLevel) => void;
}) {
  return (
    <>
      {LEVELS.map((l) => (
        <td key={l.value} className="tv-ur-perm-cell">
          <input
            type="radio"
            name={name}
            value={l.value}
            checked={value === l.value}
            disabled={disabled}
            aria-label={`${label}: ${l.label}`}
            onChange={() => onChange(l.value)}
          />
        </td>
      ))}
    </>
  );
}

/**
 * Role permission matrix (TrackVid `UserPermissions`, laid out like the template's access matrix):
 * a row per module with None / View / View & Edit, sub-module rows under modules that have them,
 * header chips that set every module at once. Parent rows roll up from their sub-modules.
 */
export function PermissionMatrix({
  permissions,
  onChange,
  readOnly,
}: {
  permissions: PermissionMap;
  onChange: (next: PermissionMap) => void;
  readOnly: boolean;
}) {
  const overall = uniformLevel(permissions);

  return (
    <div className="tv-ur-perm">
      <div className="tv-ur-perm-head">
        <strong>Role Permissions</strong>
        <div className="tv-ur-perm-chips" role="group" aria-label="Set every module">
          {LEVELS.map((l) => (
            <button
              key={l.value}
              type="button"
              className={`tv-ur-perm-chip ${overall === l.value ? "is-active" : ""}`.trim()}
              aria-pressed={overall === l.value}
              disabled={readOnly}
              onClick={() => onChange(setAllLevel(permissions, l.value))}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="c-table-scroll" tabIndex={0} role="region" aria-label="Role permissions">
        <table className="tv-ur-perm-table">
          <thead>
            <tr>
              <th scope="col">Module</th>
              {LEVELS.map((l) => (
                <th key={l.value} scope="col" className="tv-ur-perm-cell">
                  {l.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(permissions).map((key) => {
              const section = permissions[key];
              if (!isMap(section)) return null;
              const subs = subKeys(section);
              const title = formatPermissionName(key);
              return (
                <Fragment key={key}>
                  <tr className={subs.length ? "tv-ur-perm-section has-subs" : "tv-ur-perm-section"}>
                    <th scope="row">
                      {title}
                      {subs.length ? <span className="tv-ur-perm-sub-count">{subs.length} sections</span> : null}
                    </th>
                    <RadioCells
                      name={`perm-${key}`}
                      label={title}
                      value={levelOf(section)}
                      disabled={readOnly}
                      onChange={(level) => onChange(setSectionLevel(permissions, key, level))}
                    />
                  </tr>
                  {subs.map((subKey) => {
                    const sub = section[subKey];
                    const subTitle = formatPermissionName(subKey);
                    return (
                      <tr key={subKey} className="tv-ur-perm-subrow">
                        <th scope="row">{subTitle}</th>
                        <RadioCells
                          name={`perm-${key}-${subKey}`}
                          label={`${title} / ${subTitle}`}
                          value={levelOf(isMap(sub) ? sub : undefined)}
                          disabled={readOnly}
                          onChange={(level) => onChange(setSubLevel(permissions, key, subKey, level))}
                        />
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
