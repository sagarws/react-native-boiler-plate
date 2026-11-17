// @ts-nocheck
import { Fragment, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { modulesById } from "@/config/modules/registry";
import { SegmentEditorDialog } from "@/features/customers/components/segment-editor-dialog";
import { SegmentPreviewDialog } from "@/features/customers/components/segment-preview-dialog";
import {
  getSegmentInitials,
  getSegmentMatchingCustomers,
  getSegmentRules,
  getSegmentSearchText,
} from "@/features/customers/lib/segment-rules";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { listRecords } from "@/lib/store/core";
import { archiveRecords, saveRecord } from "@/lib/store/records";

const segmentNumberFormatter = new Intl.NumberFormat("en-US");

function SegmentMetric({ label, value, detail, tone, icon }) {
  return (
    <div className={`ops-metric ${tone}`}>
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </div>
  );
}

export function SegmentsPage({ initialQuery = "" }) {
  const t = modulesById.segments;
  const [n, r] = useState(0);
  const [i, a] = useState(initialQuery);
  const [o, s] = useState("");
  const [c, u] = useState(false);
  const [d, f] = useState(1);
  const [p, m] = useState(8);
  const [h, g] = useState(null);
  const _ = () => r((e) => e + 1);
  const v = useMemo(() => listRecords("segments"), [n]);
  const y = useMemo(
    () =>
      listRecords("segments", {
        archived: c,
      }),
    [c, n],
  );
  const b = useMemo(
    () =>
      y.filter(
        (e) =>
          !(
            (o && String(e.status || "") !== o) ||
            (i && !getSegmentSearchText(e).includes(i.toLowerCase()))
          ),
      ),
    [y, o, i],
  );
  const x = Math.max(1, Math.ceil(b.length / p));
  const S = Math.min(d, x);
  const C = b.slice((S - 1) * p, S * p);
  const w = b.length ? (S - 1) * p + 1 : 0;
  const T = Math.min(S * p, b.length);
  useEffect(() => {
    if (d > x) {
      f(x);
    }
  }, [d, x]);
  const E = v.filter((e) => e.status === "Active");
  const D = new Set(
    E.flatMap((e) => getSegmentMatchingCustomers(e).map((e) => e.id)),
  );
  const O = v.reduce((e, t) => e + getSegmentRules(t).length, 0);
  const k = v.filter((e) => getSegmentRules(e).length > 1).length;
  const A = (e, t) => {
    try {
      e();
      _();
      if (t) {
        showToast(t);
      }
    } catch (e) {
      showToast(
        e instanceof Error
          ? e.message
          : "This segment change could not be completed.",
      );
    }
  };
  const j = () => {
    downloadFile(
      "veylix-customer-segments.csv",
      "﻿" +
        buildCsv(
          b.map((e) => ({
            name: String(e.name || ""),
            logic: String(e.logic || "Match all rules"),
            condition: String(e.condition || ""),
            value: String(e.value || ""),
            status: String(e.status || ""),
          })),
          ["name", "logic", "condition", "value", "status"],
          [
            "Name",
            "Rule logic",
            "Primary condition",
            "Primary value",
            "Status",
          ],
        ),
    );
    showToast("Filtered customer segments exported.");
  };
  const M = (e) =>
    A(() => {
      const t = getSegmentRules(e);
      saveRecord("segments", {
        ...e,
        id: void 0,
        name: `${String(e.name || "Segment")} copy`,
        status: "Paused",
        rules: t,
        rulesText: t.map((e) => `${e.condition}: ${e.value}`).join(" · "),
      });
    }, "Segment duplicated as paused.");
  return (
    <Fragment>
      <CommercePageHeading
        title={t.title}
        onExport={j}
        onCreate={() =>
          g({
            mode: "create",
          })
        }
        createLabel="Create segment"
      />
      <section
        className="ops-metric-grid"
        aria-label="Customer segment overview"
      >
        <SegmentMetric
          label="Active segments"
          value={segmentNumberFormatter.format(E.length)}
          detail={`${v.length} saved segments`}
          tone="mint"
          icon="users"
        />
        <SegmentMetric
          label="Customers covered"
          value={segmentNumberFormatter.format(D.size)}
          detail={`${listRecords("customers").length} total customers`}
          tone="blue"
          icon="users"
        />
        <SegmentMetric
          label="Saved rules"
          value={segmentNumberFormatter.format(O)}
          detail="Reusable dynamic conditions"
          tone="amber"
          icon="list"
        />
        <SegmentMetric
          label="Multi-rule segments"
          value={segmentNumberFormatter.format(k)}
          detail="All/any rule logic"
          tone="peach"
          icon="list"
        />
      </section>
      <section className="glass-card segment-guide">
        <div>
          <span>DYNAMIC AUDIENCES</span>
          <h2>Build segments from behavior + profile</h2>
          <p>
            Combine customer spend, order frequency and profile fields. Matching
            is calculated from the current customer and order records.
          </p>
        </div>
        <div className="segment-guide-grid">
          <span>
            <Icon name="shopping-bag" />
            <strong>Behavior</strong>
            <small>Orders, spend and AOV</small>
          </span>
          <span>
            <Icon name="calendar" />
            <strong>Recency</strong>
            <small>Last order before date</small>
          </span>
          <span>
            <Icon name="globe" />
            <strong>Profile</strong>
            <small>City, country and lifecycle</small>
          </span>
          <span>
            <Icon name="chats-circle" />
            <strong>Consent</strong>
            <small>Marketing subscription state</small>
          </span>
        </div>
      </section>
      <section className="glass-card ops-filter-card">
        <div className="c-toolbar ops-toolbar">
          <label className="c-search">
            <Icon name="search" />
            <input
              data-c-search
              type="search"
              value={i}
              placeholder="Search segment or rule..."
              aria-label="Search segment or rule..."
              onChange={(e) => {
                a(e.currentTarget.value);
                f(1);
              }}
            />
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter status</span>
            <select
              data-c-filter
              value={o}
              onChange={(e) => {
                s(e.currentTarget.value);
                f(1);
              }}
            >
              <option value="">All statuses</option>
              <option>Active</option>
              <option>Paused</option>
            </select>
          </label>
          <label className="c-archive-toggle">
            <input
              type="checkbox"
              data-c-archive
              checked={c}
              onChange={(e) => {
                u(e.currentTarget.checked);
                f(1);
              }}
            />
            {" Archived"}
          </label>
        </div>
      </section>
      <section className="glass-card c-resource ops-resource">
        <div className="ops-list-heading">
          <div>
            <span>AUDIENCE BUILDER</span>
            <h2>Dynamic customer segments</h2>
            <p>
              Saved rules recalculate against the current customer and order
              records so campaign and retention groups stay meaningful.
            </p>
          </div>
          <small>
            {b.length}
            {" matching segments"}
          </small>
        </div>
        <div id="resource-results">
          <div
            className="ops-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Customer segments"
          >
            <table className="ops-table segment-table">
              <thead>
                <tr>
                  <th>Segment</th>
                  <th>Rules</th>
                  <th>Customers</th>
                  <th>Sample</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {C.map((e) => {
                  const t = getSegmentRules(e);
                  const n = getSegmentMatchingCustomers(e);
                  const r = c
                    ? [
                        {
                          label: "Restore segment",
                          icon: "check-circle",
                          onClick: () =>
                            A(
                              () => archiveRecords("segments", [e.id], true),
                              "Segment restored.",
                            ),
                        },
                      ]
                    : [
                        {
                          label: "Preview customers",
                          icon: "eye",
                          onClick: () =>
                            g({
                              mode: "preview",
                              id: e.id,
                            }),
                        },
                        {
                          label: "Edit rules",
                          icon: "pencil",
                          onClick: () =>
                            g({
                              mode: "edit",
                              id: e.id,
                            }),
                        },
                        {
                          label: "Duplicate segment",
                          icon: "copy",
                          onClick: () => M(e),
                        },
                        {
                          label:
                            e.status === "Active"
                              ? "Pause segment"
                              : "Activate segment",
                          icon: e.status === "Active" ? "pause" : "play",
                          onClick: () =>
                            A(
                              () =>
                                saveRecord(
                                  "segments",
                                  {
                                    status:
                                      e.status === "Active"
                                        ? "Paused"
                                        : "Active",
                                  },
                                  e.id,
                                ),
                              "Segment status updated.",
                            ),
                        },
                        {
                          label: "Archive segment",
                          icon: "trash",
                          danger: true,
                          separatorBefore: true,
                          onClick: () =>
                            A(
                              () => archiveRecords("segments", [e.id]),
                              "Segment archived.",
                            ),
                        },
                      ];
                  return (
                    <tr key={e.id}>
                      <td>
                        <button
                          type="button"
                          className="ops-primary-cell"
                          onClick={() =>
                            g({
                              mode: "preview",
                              id: e.id,
                            })
                          }
                        >
                          <strong>{String(e.name || "")}</strong>
                          <small>{String(e.logic || "Match all rules")}</small>
                        </button>
                      </td>
                      <td>
                        <div className="segment-rule-stack">
                          {t.slice(0, 3).map((e, t) => (
                            <span key={`${e.condition}-${t}`}>
                              <strong>{e.condition}</strong>
                              <small>{e.value}</small>
                            </span>
                          ))}
                          {t.length > 3 ? (
                            <em>
                              +{t.length - 3}
                              {" more"}
                            </em>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <strong>{n.length}</strong>
                        <small>matching now</small>
                      </td>
                      <td>
                        <div className="segment-samples">
                          {n.slice(0, 3).map((e) => (
                            <span key={e.id}>{getSegmentInitials(e.name)}</span>
                          ))}
                          {n.length > 3 ? <small>+{n.length - 3}</small> : null}
                        </div>
                      </td>
                      <td>
                        <StatusPill value={String(e.status || "")} />
                      </td>
                      <td className="ops-actions-cell">
                        <RowActionsMenu
                          label={String(e.name || "segment")}
                          actions={r}
                          triggerClassName="ops-row-menu"
                          panelClassName="ops-row-menu-panel"
                          estimatedHeight={c ? 120 : 360}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {C.length ? null : (
              <div className="c-empty">
                <Icon name="users" />
                <h3>No segments match</h3>
                <p>Try another search or status filter.</p>
              </div>
            )}
          </div>
          <footer className="c-pagination ops-pagination">
            <span>
              {w}–{T}
              {" of "}
              {b.length}
              {" segments"}
            </span>
            <label>
              {"Per page "}
              <select
                data-c-page-size
                value={p}
                onChange={(e) => {
                  m(Number(e.currentTarget.value));
                  f(1);
                }}
              >
                <option value={8}>8</option>
                <option value={16}>16</option>
                <option value={32}>32</option>
              </select>
            </label>
            <div>
              <button
                type="button"
                className="secondary-button"
                disabled={S === 1}
                onClick={() => f(Math.max(1, S - 1))}
              >
                Previous
              </button>
              <span>
                {S}
                {" / "}
                {x}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={S === x}
                onClick={() => f(Math.min(x, S + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {h?.mode === "create" ? (
        <SegmentEditorDialog onClose={() => g(null)} onSaved={_} />
      ) : null}
      {h?.mode === "edit" ? (
        <SegmentEditorDialog
          recordId={h.id}
          onClose={() => g(null)}
          onSaved={_}
        />
      ) : null}
      {h?.mode === "preview" ? (
        <SegmentPreviewDialog recordId={h.id} onClose={() => g(null)} />
      ) : null}
    </Fragment>
  );
}
