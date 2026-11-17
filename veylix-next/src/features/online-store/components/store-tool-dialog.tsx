// @ts-nocheck
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import {
  getStoreToolSummary,
  normalizeStoreToolValues,
  readStoreToolValues,
} from "@/features/online-store/lib/store-tools";
import { showToast } from "@/lib/events";
import { navigate } from "@/lib/navigation";
import { savePreference } from "@/lib/store/preferences";

export function StoreToolDialog({ tool, onClose, onSaved }) {
  const r = useMemo(() => readStoreToolValues(tool), [tool]);
  const [i, a] = useState(r);
  const [o, s] = useState("");
  const c = getStoreToolSummary(tool);
  const u = () => {
    if (tool.route) {
      onClose();
      navigate(tool.route);
    }
  };
  if (tool.mode === "route")
    return (
      <AppDialog title={tool.title} onClose={onClose}>
        <div className="store-tool-dialog-head">
          <span
            className={`storefront-tool-icon tone-${tool.tone || "neutral"}`}
          >
            <Icon name={tool.icon} />
          </span>
          <div>
            <p>{tool.description}</p>
            <strong>{c}</strong>
          </div>
        </div>
        <div className="store-tool-dialog-note">
          Use the full manager for detailed records, rules and advanced controls
          for this storefront area.
        </div>
        <div className="store-tool-dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary-button" onClick={u}>
            {tool.actionLabel || "Open manager"}
            <Icon name="arrow-right" />
          </button>
        </div>
      </AppDialog>
    );
  const d = tool.fields || [];
  return (
    <AppDialog title={tool.title} onClose={onClose} wide>
      <form
        className="c-form store-tool-form"
        data-c-form="storefront-tool"
        onSubmit={(a) => {
          a.preventDefault();
          s("");
          try {
            if (!tool.preference)
              throw Error(
                "This storefront tool does not have a preference store.",
              );
            const a = normalizeStoreToolValues(d, i);
            savePreference(tool.preference, {
              ...r,
              ...a,
            });
            showToast(`${tool.title} saved.`);
            onSaved();
            onClose();
          } catch (e) {
            s(
              e instanceof Error
                ? e.message
                : "These storefront settings could not be saved.",
            );
          }
        }}
      >
        <div className="store-tool-dialog-head">
          <span
            className={`storefront-tool-icon tone-${tool.tone || "neutral"}`}
          >
            <Icon name={tool.icon} />
          </span>
          <div>
            <p>{tool.description}</p>
            <strong>{c}</strong>
          </div>
        </div>
        <div className="c-form-grid">
          {d.map((t) => (
            <FormField
              key={t.key}
              field={t}
              value={i[t.key]}
              prefix={`store-tool-${tool.id}`}
              onChange={(e) =>
                a((n) => ({
                  ...n,
                  [t.key]: e,
                }))
              }
            />
          ))}
        </div>
        <p className="c-form-error" role="alert">
          {o}
        </p>
        <div className="c-form-footer">
          <span>Changes are saved to this workspace.</span>
          {tool.route ? (
            <button type="button" className="secondary-button" onClick={u}>
              Full settings
            </button>
          ) : null}
          <button type="submit" className="primary-button">
            Save changes
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
