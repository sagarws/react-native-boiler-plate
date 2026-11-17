// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { DisputeCaseDialog } from "@/features/marketplace/components/dispute-case-dialog";
import { MarketplaceOperationsNav } from "@/features/marketplace/components/marketplace-operations-nav";
import {
  MarketplaceReviewPill,
  MarketplaceSortableHeader,
  VendorSummaryCard,
} from "@/features/marketplace/components/marketplace-review-ui";
import {
  disputeNumberFormatter,
  disputeStatusOptions,
  formatDisputeDate,
  formatDisputeMoney,
} from "@/features/marketplace/lib/dispute-helpers";
import {
  closeDispute,
  getDisputeCustomerName,
  getDisputePayoutHoldScope,
  getDisputeSummary,
  getDisputeVendorId,
  markDisputeUnderReview,
  readMarketplaceSettlementSettings,
  requestDisputeEvidence,
  toggleDisputePayoutHold,
} from "@/features/marketplace/lib/settlements";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { navigate } from "@/lib/navigation";
import { getRecordLabel, listRecords } from "@/lib/store/core";

export function DisputesPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState("");
  const [u, d] = useState(1);
  const [f, p] = useState(1);
  const [m, h] = useState(8);
  const [g, _] = useState(0);
  const [v, y] = useState(null);
  const b = () => _((e) => e + 1);
  const x = readMarketplaceSettlementSettings();
  const S = useMemo(() => listRecords("disputes"), [g]);
  const C = useMemo(() => {
    let e = [...S];
    if (t) {
      const n = t.toLowerCase();
      e = e.filter((e) =>
        [
          getRecordLabel("orders", e.orderId),
          getRecordLabel("vendors", getDisputeVendorId(e)),
          getDisputeCustomerName(e),
          e.type,
          e.reason,
          e.owner,
          e.status,
          e.evidence,
          e.resolution,
        ]
          .join(" ")
          .toLowerCase()
          .includes(n),
      );
    }
    if (r) {
      e = e.filter((e) => getDisputeVendorId(e) === r);
    }
    if (a) {
      e = e.filter((e) => e.status === a);
    }
    const n = (e, t) =>
      t === "amount"
        ? Number(e.amount || 0)
        : t === "deadline" || t === "openedAt"
          ? Date.parse(String(e[t] || "")) || 0
          : t === "vendor"
            ? getRecordLabel("vendors", getDisputeVendorId(e))
            : String(e[t] || "");
    if (s) {
      e.sort((e, t) => {
        const r = n(e, s);
        const i = n(t, s);
        return (
          u *
          (typeof r == "number" && typeof i == "number"
            ? r - i
            : String(r).localeCompare(String(i)))
        );
      });
    } else {
      e.sort((e, t) =>
        String(e.deadline || "").localeCompare(String(t.deadline || "")),
      );
    }
    return e;
  }, [S, t, r, a, s, u]);
  const w = getDisputeSummary();
  const T = Math.max(1, Math.ceil(C.length / m));
  const E = Math.min(f, T);
  const D = C.slice((E - 1) * m, E * m);
  const O = (e) => {
    if (s === e) {
      d((e) => (e === 1 ? -1 : 1));
    } else {
      c(e);
      d(1);
    }
    p(1);
  };
  const k = (e, t) => {
    try {
      e();
      b();
      showToast(t);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Dispute update failed.");
    }
  };
  const A = () => {
    downloadFile(
      "veylix-marketplace-disputes.csv",
      "﻿" +
        buildCsv(
          C.map((e) => ({
            order: getRecordLabel("orders", e.orderId),
            vendor: getRecordLabel("vendors", getDisputeVendorId(e)),
            customer: getDisputeCustomerName(e),
            type: e.type,
            reason: e.reason,
            amount: e.amount,
            currency: e.currency,
            priority: e.priority,
            evidence: e.evidence,
            liability: e.liability,
            payoutImpact: e.payoutImpact,
            owner: e.owner,
            deadline: e.deadline,
            resolution: e.resolution,
            status: e.status,
          })),
          [
            "order",
            "vendor",
            "customer",
            "type",
            "reason",
            "amount",
            "currency",
            "priority",
            "evidence",
            "liability",
            "payoutImpact",
            "owner",
            "deadline",
            "resolution",
            "status",
          ],
          [
            "Order",
            "Vendor",
            "Customer",
            "Type",
            "Reason",
            "Amount at risk",
            "Currency",
            "Priority",
            "Evidence",
            "Liability",
            "Payout impact",
            "Owner",
            "Deadline",
            "Resolution",
            "Status",
          ],
        ),
    );
    showToast("Filtered marketplace disputes exported.");
  };
  const j = (e) => {
    const t = ["Resolved", "Closed"].includes(String(e.status));
    const n = getDisputePayoutHoldScope(e) !== "none";
    return [
      {
        label: "View case",
        icon: "eye",
        onClick: () =>
          y({
            kind: "detail",
            id: e.id,
          }),
      },
      {
        label: "View order",
        icon: "clipboard-text",
        onClick: () =>
          navigate(
            `/commerce/orders?q=${encodeURIComponent(getRecordLabel("orders", e.orderId))}`,
          ),
      },
      {
        label: "Open vendor",
        icon: "users",
        onClick: () =>
          navigate(
            `/commerce/vendors?q=${encodeURIComponent(getRecordLabel("vendors", getDisputeVendorId(e)))}`,
          ),
      },
      ...(t
        ? []
        : [
            {
              label: "Edit case",
              icon: "pencil",
              onClick: () =>
                y({
                  kind: "edit",
                  id: e.id,
                }),
            },
            {
              label: "Request evidence",
              icon: "paper-plane",
              separatorBefore: true,
              onClick: () =>
                k(
                  () => requestDisputeEvidence(e.id),
                  "Evidence request recorded.",
                ),
            },
            {
              label: "Move to review",
              icon: "eye",
              onClick: () =>
                k(
                  () => markDisputeUnderReview(e.id),
                  "Dispute moved to review.",
                ),
            },
            {
              label: n ? "Release payout hold" : "Hold vendor payouts",
              icon: n ? "play" : "pause",
              onClick: () =>
                k(
                  () => toggleDisputePayoutHold(e.id),
                  n
                    ? "Vendor payout hold released for this case."
                    : "Vendor payouts held while this case is reviewed.",
                ),
            },
            {
              label: "Resolve case",
              icon: "check-circle",
              onClick: () =>
                y({
                  kind: "resolve",
                  id: e.id,
                }),
            },
          ]),
      ...(e.status === "Resolved"
        ? [
            {
              label: "Close case",
              icon: "x",
              onClick: () =>
                k(() => closeDispute(e.id), "Marketplace case closed."),
            },
          ]
        : []),
    ];
  };
  return (
    <Fragment>
      <CommercePageHeading
        title="Marketplace disputes"
        onExport={A}
        onCreate={() =>
          y({
            kind: "create",
          })
        }
        createLabel="Open dispute case"
      />
      <MarketplaceOperationsNav active="disputes" />
      <section
        className="commission-summary-grid"
        aria-label="Marketplace dispute overview"
      >
        <VendorSummaryCard
          icon="info"
          label="Open cases"
          value={disputeNumberFormatter.format(w.open)}
          detail={`${w.resolved} resolved or closed`}
          tone="amber"
        />
        <VendorSummaryCard
          icon="wallet"
          label="Amount at risk"
          value={formatDisputeMoney(w.risk)}
          detail="Open dispute exposure"
          tone="red"
        />
        <VendorSummaryCard
          icon="clipboard-text"
          label="Evidence due"
          value={disputeNumberFormatter.format(w.evidence)}
          detail={
            w.evidence ? "Case files need follow-up" : "Evidence queue is clear"
          }
          tone={w.evidence ? "amber" : "green"}
        />
        <VendorSummaryCard
          icon="pause"
          label="Payout holds"
          value={disputeNumberFormatter.format(w.holds)}
          detail={
            w.holds
              ? "Settlement protection is active"
              : "No dispute payout holds"
          }
          tone={w.holds ? "red" : "green"}
        />
      </section>
      <section className="glass-card vendor-split-flow dispute-flow">
        <div>
          <span>RESOLUTION WORKFLOW</span>
          <h2>Evidence first. Liability second. Money movement last.</h2>
          <p>
            Every case tracks the parties, amount at risk, response deadline,
            payout impact and final resolution before settlement protection is
            released.
          </p>
        </div>
        <div className="vendor-split-formula">
          <span>Open case</span>
          <Icon name="arrow-right" />
          <span>Evidence</span>
          <Icon name="arrow-right" />
          <span>Review liability</span>
          <Icon name="arrow-right" />
          <span>
            {Number(x.disputeSla || 7)}
            {" day SLA"}
          </span>
          <Icon name="arrow-right" />
          <strong>Resolve</strong>
        </div>
      </section>
      <section className="glass-card c-resource dispute-resource">
        <div className="marketplace-review-heading">
          <div>
            <span>RESOLUTION CENTER</span>
            <h2>Marketplace cases</h2>
            <p>
              Review evidence, assign liability, protect vendor settlements and
              record a clear financial resolution without losing the original
              order context.
            </p>
          </div>
          <small>
            {disputeNumberFormatter.format(C.length)}
            {" matching cases"}
          </small>
        </div>
        <div className="c-toolbar marketplace-review-toolbar">
          <label className="c-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search order, vendor, customer, reason..."
              value={t}
              aria-label="Search marketplace disputes"
              onChange={(e) => {
                n(e.currentTarget.value);
                p(1);
              }}
            />
          </label>
          <label className="c-filter">
            <select
              value={r}
              onChange={(e) => {
                i(e.currentTarget.value);
                p(1);
              }}
            >
              <option value="">All vendors</option>
              {listRecords("vendors").map((e) => (
                <option key={e.id} value={e.id}>
                  {String(e.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <select
              value={a}
              onChange={(e) => {
                o(e.currentTarget.value);
                p(1);
              }}
            >
              <option value="">All statuses</option>
              {disputeStatusOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>
        <div id="resource-results">
          <div className="vendor-table-wrap">
            <div
              className="table-scroll dispute-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Marketplace disputes"
            >
              <table className="dispute-table">
                <thead>
                  <tr>
                    <th>Case / order</th>
                    <MarketplaceSortableHeader
                      label="Parties"
                      sortKey="vendor"
                      sort={s}
                      direction={u}
                      onSort={O}
                    />
                    <MarketplaceSortableHeader
                      label="Amount at risk"
                      sortKey="amount"
                      sort={s}
                      direction={u}
                      onSort={O}
                    />
                    <th>Evidence</th>
                    <MarketplaceSortableHeader
                      label="Owner / deadline"
                      sortKey="deadline"
                      sort={s}
                      direction={u}
                      onSort={O}
                    />
                    <th>Payout impact</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {D.map((e) => {
                    const t = getDisputeVendorId(e);
                    return (
                      <tr key={e.id}>
                        <td>
                          <button
                            type="button"
                            className="vendor-split-order-cell"
                            onClick={() =>
                              y({
                                kind: "detail",
                                id: e.id,
                              })
                            }
                          >
                            <strong>
                              {getRecordLabel("orders", e.orderId)}
                            </strong>
                            <small>
                              {String(e.type || "Marketplace case")}
                              {" · "}
                              {String(e.reason || "—")}
                            </small>
                          </button>
                        </td>
                        <td>
                          <div className="vendor-split-vendor">
                            <strong>{getRecordLabel("vendors", t)}</strong>
                            <small>{getDisputeCustomerName(e)}</small>
                          </div>
                        </td>
                        <td>
                          <div className="vendor-split-money">
                            <strong>
                              {formatDisputeMoney(Number(e.amount || 0))}
                            </strong>
                            <small>
                              {String(e.currency || "USD")}
                              {" at risk"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="marketplace-verification-stack">
                            <MarketplaceReviewPill value={e.evidence} />
                            <small>
                              {String(e.priority || "Normal")}
                              {" priority"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="commission-effective">
                            <strong>{String(e.owner || "Unassigned")}</strong>
                            <small>
                              {"Due "}
                              {formatDisputeDate(e.deadline)}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="commission-policy">
                            <strong>
                              {String(e.payoutImpact || "No hold")}
                            </strong>
                            <small>
                              {String(e.liability || "Undecided")}
                              {" liability"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <MarketplaceReviewPill value={e.status} />
                        </td>
                        <td className="vendor-action-cell">
                          <RowActionsMenu
                            label={`${getRecordLabel("orders", e.orderId)} dispute`}
                            actions={j(e)}
                            panelClassName="marketplace-row-menu-panel"
                            estimatedHeight={420}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {D.length ? null : (
                <div className="c-empty">
                  <h3>
                    {t || r || a ? "No dispute matches" : "No disputes open"}
                  </h3>
                  <p>
                    Marketplace cases will appear here when a buyer, vendor or
                    payment issue needs review.
                  </p>
                </div>
              )}
            </div>
            <footer className="c-pagination">
              <span>
                {C.length ? (E - 1) * m + 1 : 0}–{Math.min(E * m, C.length)}
                {" of "}
                {C.length}
                {" cases"}
              </span>
              <label>
                {"Per page "}
                <select
                  value={m}
                  onChange={(e) => {
                    h(Number(e.currentTarget.value));
                    p(1);
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
                  disabled={E === 1}
                  onClick={() => p((e) => Math.max(1, e - 1))}
                >
                  Previous
                </button>
                <span>
                  {E}
                  {" / "}
                  {T}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={E === T}
                  onClick={() => p((e) => Math.min(T, e + 1))}
                >
                  Next
                </button>
              </div>
            </footer>
          </div>
        </div>
      </section>
      {v ? (
        <DisputeCaseDialog
          state={v}
          onClose={() => y(null)}
          onChanged={b}
          onResolve={(e) =>
            y({
              kind: "resolve",
              id: e,
            })
          }
        />
      ) : null}
    </Fragment>
  );
}
