// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { FormField } from "@/components/ui/form-field";
import { modulesById } from "@/config/modules/registry";
import { ResourceRecordDialog } from "@/features/resources/components/resource-record-dialog";
import { showToast } from "@/lib/events";
import { listRecords } from "@/lib/store/core";
import { archiveRecords, saveRecord } from "@/lib/store/records";

function defaultCategoryFieldValue(e) {
  return e.key === "status"
    ? e.options?.[0] || ""
    : e.type === "money" || e.type === "number"
      ? (e.min ?? 0)
      : "";
}

function findCategoryExtraField(e) {
  return e.fields.find(
    (e) => !["name", "description", "status"].includes(e.key),
  );
}

export function CategoryManager({ config, onChanged }) {
  const n = modulesById[config.id];
  const [r, i] = useState(0);
  const [a, o] = useState(false);
  const [s, c] = useState("");
  const [u, d] = useState(null);
  const [f, p] = useState("");
  const m = useMemo(() => {
    const t = listRecords(config.id, {
      archived: a,
    });
    if (!s.trim()) return t;
    const n = s.trim().toLowerCase();
    return t.filter((e) =>
      Object.values(e).join(" ").toLowerCase().includes(n),
    );
  }, [config.id, a, s, r]);
  const h = findCategoryExtraField(n);
  const g = () => {
    i((e) => e + 1);
    onChanged?.();
  };
  const _ = (t, n = false) => {
    try {
      archiveRecords(config.id, [t], n);
      g();
      showToast(n ? "Category restored." : "Category archived.");
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This category could not be changed.",
      );
    }
  };
  return (
    <section
      className="glass-card c-category-manager"
      aria-labelledby={`${config.id}-manager-title`}
    >
      <header className="c-category-heading">
        <span>{config.eyebrow || "SET UP CATEGORIES FIRST"}</span>
        <h2 id={`${config.id}-manager-title`}>{config.title}</h2>
        <p>{config.description}</p>
      </header>
      <div className="c-category-layout">
        <form
          className="c-category-form"
          data-c-form="content-category"
          data-category-module={config.id}
          data-inline="true"
          onSubmit={(t) => {
            t.preventDefault();
            p("");
            try {
              const r = t.currentTarget;
              const i = new FormData(r);
              const a = {};
              n.fields.forEach((e) => {
                const t = i.get(e.key);
                const n = typeof t == "string" ? t.trim() : "";
                a[e.key] =
                  ["money", "number"].includes(e.type) && n !== ""
                    ? Number(n)
                    : n;
              });
              saveRecord(config.id, a);
              r.reset();
              g();
              showToast("Category added.");
            } catch (e) {
              p(
                e instanceof Error
                  ? e.message
                  : "This category could not be added.",
              );
            }
          }}
        >
          <div className="c-category-form-heading">
            <span>NEW CATEGORY</span>
            <h3>Add category</h3>
          </div>
          {n.fields.map((t) => (
            <FormField
              key={t.key}
              field={t}
              value={defaultCategoryFieldValue(t)}
              prefix={`category-${config.id}`}
            />
          ))}
          <p className="c-form-error" role="alert">
            {f}
          </p>
          <div className="c-category-submit">
            <button type="submit" className="primary-button">
              Add category
            </button>
          </div>
        </form>
        <div className="c-category-list">
          <div className="c-category-toolbar">
            <label className="c-search">
              <Icon name="search" />
              <input
                type="search"
                value={s}
                onChange={(e) => c(e.currentTarget.value)}
                placeholder="Search categories..."
                aria-label={`Search ${config.title}`}
              />
            </label>
            <label className="c-archive-toggle">
              <input
                type="checkbox"
                checked={a}
                onChange={(e) => o(e.currentTarget.checked)}
              />
              {" Archived"}
            </label>
          </div>
          <div className="c-category-results" id={`${config.id}-results`}>
            {m.length ? (
              m.map((e) => {
                const t = h ? String(e[h.key] || "") : "";
                const n = t ? `${h?.key === "slug" ? "/" : ""}${t}` : "";
                return (
                  <div key={e.id} className="c-category-row">
                    <div className="c-category-copy">
                      <div>
                        <strong>{String(e.name || "")}</strong>
                        {n ? <span>{n}</span> : null}
                      </div>
                      <small>{String(e.description || "No description")}</small>
                    </div>
                    <div className="c-category-actions">
                      <span>{String(e.status || "Active")}</span>
                      {a ? (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => _(e.id, true)}
                        >
                          Restore
                        </button>
                      ) : (
                        <Fragment>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => d(e.id)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => _(e.id)}
                          >
                            Archive
                          </button>
                        </Fragment>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="c-category-empty">
                {s
                  ? "No categories match your search."
                  : a
                    ? "No archived categories."
                    : "No categories yet."}
              </div>
            )}
          </div>
        </div>
      </div>
      {u ? (
        <ResourceRecordDialog
          module={n}
          mode="edit"
          recordId={u}
          onClose={() => d(null)}
          onChanged={g}
        />
      ) : null}
    </section>
  );
}
