// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { CommissionRuleDetailDialog } from "@/features/marketplace/components/commission-rule-detail-dialog";
import { CommissionRuleEditorDialog } from "@/features/marketplace/components/commission-rule-editor-dialog";
import { CommissionSimulationDialog } from "@/features/marketplace/components/commission-simulation-dialog";
import { CommissionStatusPill } from "@/features/marketplace/components/commission-status-pill";
import { MarketplaceOperationsNav } from "@/features/marketplace/components/marketplace-operations-nav";
import { VendorSummaryCard } from "@/features/marketplace/components/marketplace-review-ui";
import {
  calculateCommissionBreakdown,
  commissionScopeRank,
} from "@/features/marketplace/lib/commission";
import {
  commissionNumberFormat,
  commissionRuleStatusOptions,
  commissionScopeOptions,
  formatCommissionEffectiveWindow,
  formatCommissionMoney,
  formatCommissionRuleRate,
  getCommissionScopeTarget,
} from "@/features/marketplace/lib/commission-display";
import {
  duplicateCommissionRule,
  toggleCommissionRuleStatus,
} from "@/features/marketplace/lib/commission-rules";
import { showToast } from "@/lib/events";
import { findRecord, listRecords } from "@/lib/store/core";
import { archiveRecords } from "@/lib/store/records";

export function CommissionsPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState(false);
  const [u, d] = useState(1);
  const [f, p] = useState(8);
  const [m, h] = useState(0);
  const [g, _] = useState(null);
  const v = () => h((e) => e + 1);
  const y = useMemo(
    () =>
      listRecords("commissions", {
        archived: s,
      }),
    [s, m],
  );
  const b = useMemo(() => {
    let e = [...y];
    if (t) {
      const n = t.toLowerCase();
      e = e.filter((e) =>
        [
          e.name,
          e.scope,
          getCommissionScopeTarget(e),
          e.calculation,
          e.commissionBase,
          e.discountFunding,
          e.refundPolicy,
          e.status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(n),
      );
    }
    if (a) {
      e = e.filter((e) => e.status === a);
    }
    if (r) {
      e = e.filter((e) => e.scope === r);
    }
    e.sort(
      (e, t) =>
        commissionScopeRank(String(t.scope || "")) -
          commissionScopeRank(String(e.scope || "")) ||
        Number(t.priority || 0) - Number(e.priority || 0) ||
        String(e.name || "").localeCompare(String(t.name || "")),
    );
    return e;
  }, [y, t, a, r]);
  const x = Math.max(1, Math.ceil(b.length / f));
  const S = Math.min(u, x);
  const C = b.slice((S - 1) * f, S * f);
  const w = listRecords("commissions");
  const T = listRecords("vendor-orders");
  const E = T.map((e) =>
    calculateCommissionBreakdown(
      e,
      findRecord("vendors", String(e.vendorId || "")) || {},
      w,
    ),
  );
  const D = E.reduce((e, t) => e + t.eligibleBase, 0);
  const O = E.reduce((e, t) => e + t.netCommission, 0);
  const k = w.filter((e) => e.status === "Active");
  const A = k.find((e) => e.scope === "Marketplace default");
  const j = (e, t) => {
    try {
      e();
      v();
      showToast(t);
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Commission rule update failed.",
      );
    }
  };
  const M = (e) =>
    s
      ? [
          {
            label: "Restore rule",
            icon: "check-circle",
            onClick: () =>
              j(
                () => archiveRecords("commissions", [e.id], true),
                "Commission rule restored.",
              ),
          },
        ]
      : [
          {
            label: "View rule",
            icon: "eye",
            onClick: () =>
              _({
                kind: "detail",
                id: e.id,
              }),
          },
          {
            label: "Edit rule",
            icon: "pencil",
            onClick: () =>
              _({
                kind: "edit",
                id: e.id,
              }),
          },
          {
            label: "Simulate rule",
            icon: "seal-percent",
            onClick: () =>
              _({
                kind: "simulate",
                id: e.id,
              }),
          },
          {
            label: "Duplicate",
            icon: "copy",
            onClick: () =>
              j(
                () => duplicateCommissionRule(e.id),
                "Commission rule duplicated as paused.",
              ),
          },
          {
            label: e.status === "Active" ? "Pause rule" : "Activate rule",
            icon: e.status === "Active" ? "pause" : "play",
            onClick: () =>
              j(
                () => toggleCommissionRuleStatus(e.id),
                `Commission rule ${e.status === "Active" ? "paused" : "activated"}.`,
              ),
          },
          {
            label: "Archive",
            icon: "trash",
            danger: true,
            separatorBefore: true,
            onClick: () =>
              j(
                () => archiveRecords("commissions", [e.id]),
                "Commission rule archived.",
              ),
          },
        ];
  return (
    <Fragment>
      <CommercePageHeading
        title="Commission rules"
        actions={
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              _({
                kind: "simulate",
              })
            }
          >
            <Icon name="seal-percent" />
            {" Simulate commission"}
          </button>
        }
        onCreate={() =>
          _({
            kind: "create",
          })
        }
        createLabel="Create rule"
      />
      <MarketplaceOperationsNav active="commissions" />
      <section
        className="commission-summary-grid"
        aria-label="Commission engine overview"
      >
        <VendorSummaryCard
          icon="seal-percent"
          label="Active rules"
          value={commissionNumberFormat.format(k.length)}
          detail={`${w.length - k.length} paused or archived`}
        />
        <VendorSummaryCard
          icon="chart-line-up"
          label="Effective take rate"
          value={D ? `${((O / D) * 100).toFixed(1)}%` : "—"}
          detail={`${formatCommissionMoney(O)} commission booked`}
          tone="amber"
        />
        <VendorSummaryCard
          icon="wallet"
          label="Default marketplace rate"
          value={A ? formatCommissionRuleRate(A) : "Not set"}
          detail={
            A
              ? "Fallback when no override matches"
              : "Create a marketplace default"
          }
          tone="blue"
        />
        <VendorSummaryCard
          icon="info"
          label="Historical snapshots"
          value={commissionNumberFormat.format(T.length)}
          detail="Existing vendor splits keep their booked rule"
        />
      </section>
      <section className="glass-card commission-hierarchy">
        <div>
          <span>RULE PRECEDENCE</span>
          <h2>Most specific active rule wins.</h2>
          <p>
            Priority breaks ties inside the same scope. Effective dates are
            checked before a rule can apply.
          </p>
        </div>
        <div className="commission-hierarchy-flow">
          {[
            ["Specific product", "Highest specificity"],
            ["Specific vendor", "Partner override"],
            ["Vendor category", "Category economics"],
            ["Vendor tier", "Commercial plan"],
            ["Marketplace default", "Fallback rule"],
          ].map(([e, t], n) => (
            <div key={e}>
              <b>{n + 1}</b>
              <span>
                <strong>{e}</strong>
                <small>{t}</small>
              </span>
              {n < 4 ? <Icon name="arrow-right" /> : null}
            </div>
          ))}
        </div>
      </section>
      <section className="glass-card c-resource commission-resource">
        <div className="marketplace-review-heading">
          <div>
            <span>COMMISSION ENGINE</span>
            <h2>Commercial rules</h2>
            <p>
              Control precedence, fee calculation, discount funding, refund
              reversal and effective dates without rewriting historical order
              economics.
            </p>
          </div>
          <small>
            {commissionNumberFormat.format(b.length)}
            {" matching rules"}
          </small>
        </div>
        <div className="c-toolbar marketplace-review-toolbar">
          <label className="c-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search rules, scopes or policies..."
              value={t}
              aria-label="Search commission rules"
              onChange={(e) => {
                n(e.currentTarget.value);
                d(1);
              }}
            />
          </label>
          <label className="c-filter">
            <select
              value={r}
              onChange={(e) => {
                i(e.currentTarget.value);
                d(1);
              }}
            >
              <option value="">All scopes</option>
              {commissionScopeOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <select
              value={a}
              onChange={(e) => {
                o(e.currentTarget.value);
                d(1);
              }}
            >
              <option value="">All statuses</option>
              {commissionRuleStatusOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-archive-toggle">
            <input
              type="checkbox"
              checked={s}
              onChange={(e) => {
                c(e.currentTarget.checked);
                d(1);
              }}
            />
            {" Archived"}
          </label>
        </div>
        <div id="resource-results">
          <div className="vendor-table-wrap">
            <div
              className="table-scroll commission-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Commission rules"
            >
              <table className="commission-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Scope</th>
                    <th>Fee model</th>
                    <th>Commission base</th>
                    <th>{"Funding & refunds"}</th>
                    <th>Effective</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {C.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <button
                          type="button"
                          className="commission-rule-name"
                          onClick={() =>
                            _({
                              kind: "detail",
                              id: e.id,
                            })
                          }
                        >
                          <span>
                            <Icon name="seal-percent" />
                          </span>
                          <span>
                            <strong>{String(e.name || "")}</strong>
                            <small>
                              {"Priority "}
                              {Number(e.priority || 0)}
                              {" · "}
                              {String(e.scope || "")}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <div className="commission-scope">
                          <strong>{String(e.scope || "")}</strong>
                          <small>{getCommissionScopeTarget(e)}</small>
                        </div>
                      </td>
                      <td>
                        <div className="commission-fee">
                          <strong>{formatCommissionRuleRate(e)}</strong>
                          <small>{String(e.calculation || "Percentage")}</small>
                        </div>
                      </td>
                      <td>
                        <div className="commission-base">
                          <strong>
                            {String(e.commissionBase || "Item revenue")}
                          </strong>
                          <small>
                            {String(e.shippingTreatment || "Exclude shipping")}
                            {" · "}
                            {String(e.taxTreatment || "Exclude tax")}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div className="commission-policy">
                          <strong>
                            {String(e.discountFunding || "Vendor funded")}
                          </strong>
                          <small>
                            {String(e.refundPolicy || "Reverse commission")}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div className="commission-effective">
                          <strong>{formatCommissionEffectiveWindow(e)}</strong>
                          <small>
                            {Number(e.minimumFee || 0)
                              ? `Min ${formatCommissionMoney(Number(e.minimumFee || 0))} · `
                              : ""}
                            {Number(e.feeCap || 0)
                              ? `Cap ${formatCommissionMoney(Number(e.feeCap || 0))}`
                              : "No fee cap"}
                          </small>
                        </div>
                      </td>
                      <td>
                        <CommissionStatusPill value={e.status} />
                      </td>
                      <td className="vendor-action-cell">
                        <RowActionsMenu
                          label={String(e.name || "commission rule")}
                          actions={M(e)}
                          triggerClassName="marketplace-row-menu"
                          panelClassName="marketplace-row-menu-panel"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {C.length ? null : (
                <div className="c-empty">
                  <h3>No commission rules match</h3>
                  <p>Try another search or filter.</p>
                </div>
              )}
            </div>
            <footer className="c-pagination">
              <span>
                {b.length ? (S - 1) * f + 1 : 0}–{Math.min(S * f, b.length)}
                {" of "}
                {b.length}
                {" rules"}
              </span>
              <label>
                {"Per page "}
                <select
                  value={f}
                  onChange={(e) => {
                    p(Number(e.currentTarget.value));
                    d(1);
                  }}
                >
                  <option>8</option>
                  <option>16</option>
                  <option>32</option>
                </select>
              </label>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={S === 1}
                  onClick={() => d((e) => Math.max(1, e - 1))}
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
                  onClick={() => d((e) => Math.min(x, e + 1))}
                >
                  Next
                </button>
              </div>
            </footer>
          </div>
        </div>
      </section>
      {g?.kind === "create" || g?.kind === "edit" ? (
        <CommissionRuleEditorDialog
          id={g.id}
          onClose={() => _(null)}
          onChanged={v}
        />
      ) : null}
      {g?.kind === "detail" && g.id ? (
        <CommissionRuleDetailDialog
          id={g.id}
          onClose={() => _(null)}
          onEdit={() =>
            _({
              kind: "edit",
              id: g.id,
            })
          }
          onSimulate={() =>
            _({
              kind: "simulate",
              id: g.id,
            })
          }
        />
      ) : null}
      {g?.kind === "simulate" ? (
        <CommissionSimulationDialog ruleId={g.id} onClose={() => _(null)} />
      ) : null}
    </Fragment>
  );
}
