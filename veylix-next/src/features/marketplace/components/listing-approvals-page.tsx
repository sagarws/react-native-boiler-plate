// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import {
  ApprovalProductThumb,
  ApprovalQualityChecks,
} from "@/features/marketplace/components/approval-listing-parts";
import { ListingApprovalActivityDialog } from "@/features/marketplace/components/listing-approval-activity-dialog";
import { ListingApprovalDecisionDialog } from "@/features/marketplace/components/listing-approval-decision-dialog";
import { ListingApprovalDetailDialog } from "@/features/marketplace/components/listing-approval-detail-dialog";
import { MarketplaceOperationsNav } from "@/features/marketplace/components/marketplace-operations-nav";
import { MarketplaceReviewFormDialog } from "@/features/marketplace/components/marketplace-review-form-dialog";
import {
  MarketplaceReviewPill,
  MarketplaceReviewScore,
  MarketplaceSortableHeader,
  VendorSummaryCard,
} from "@/features/marketplace/components/marketplace-review-ui";
import {
  approvalNumberFormat,
  formatApprovalDate,
} from "@/features/marketplace/lib/approval-formatters";
import {
  getListingApprovalScore,
  marketplaceReviewStatusOptions,
  summarizeListingApprovals,
} from "@/features/marketplace/lib/marketplace-review";
import { approveListingReview } from "@/features/marketplace/lib/marketplace-review-actions";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { navigate } from "@/lib/navigation";
import { findRecord, listRecords } from "@/lib/store/core";

export function ListingApprovalsPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState(1);
  const [u, d] = useState(1);
  const [f, p] = useState(8);
  const [m, h] = useState(null);
  const [g, _] = useState(0);
  const v = useMemo(() => listRecords("approvals"), [g]);
  const y = summarizeListingApprovals(v);
  const b = useMemo(() => {
    let e = [...v];
    if (t) {
      const n = t.toLowerCase();
      e = e.filter((e) => {
        const t = findRecord("products", String(e.productId || ""));
        const r = findRecord("vendors", String(e.vendorId || ""));
        return [
          t?.name,
          r?.name,
          e.status,
          e.feedback,
          e.compliance,
          e.risk,
          e.reviewer,
        ]
          .join(" ")
          .toLowerCase()
          .includes(n);
      });
    }
    if (r) {
      e = e.filter((e) => e.status === r);
    }
    if (a) {
      e.sort((e, t) => {
        const n = (e) =>
          ({
            quality: getListingApprovalScore(e),
            completeness: Number(e.completeness || 0),
            submittedAt: Date.parse(String(e.submittedAt || "")) || 0,
          })[a] ?? e[a];
        const r = n(e);
        const i = n(t);
        return (
          s *
          (typeof r == "number" && typeof i == "number"
            ? r - i
            : String(r || "").localeCompare(String(i || "")))
        );
      });
    }
    return e;
  }, [v, t, r, a, s]);
  const x = Math.max(1, Math.ceil(b.length / f));
  const S = Math.min(u, x);
  const C = b.slice((S - 1) * f, S * f);
  const w = () => _((e) => e + 1);
  const T = (e) => {
    c((t) => (a === e && t === 1 ? -1 : 1));
    o(e);
    d(1);
  };
  const E = () => {
    const e = b.map((e) => ({
      product:
        findRecord("products", String(e.productId || ""))?.name || e.productId,
      vendor:
        findRecord("vendors", String(e.vendorId || ""))?.name || e.vendorId,
      quality: getListingApprovalScore(e),
      completeness: e.completeness,
      images: e.images,
      variants: e.variants,
      seo: e.seo,
      compliance: e.compliance,
      risk: e.risk,
      reviewer: e.reviewer,
      submittedAt: e.submittedAt,
      decisionAt: e.decisionAt,
      status: e.status,
      feedback: e.feedback,
    }));
    downloadFile(
      "veylix-marketplace-product-approvals.csv",
      "﻿" +
        buildCsv(e, Object.keys(e[0] || {}), [
          "Product",
          "Vendor",
          "Quality",
          "Completeness",
          "Images",
          "Variants",
          "SEO",
          "Compliance",
          "Risk",
          "Reviewer",
          "Submitted",
          "Decision",
          "Status",
          "Feedback",
        ]),
    );
    showToast("Filtered product approvals exported.");
  };
  const D = (e) => {
    try {
      approveListingReview(e.id);
      w();
      showToast(
        `${String(findRecord("products", String(e.productId || ""))?.name || "Product")} approved for marketplace publishing.`,
      );
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This listing could not be approved.",
      );
    }
  };
  const O = (e) => {
    const t = findRecord("products", String(e.productId || ""));
    const n = findRecord("vendors", String(e.vendorId || ""));
    return [
      {
        label: "Review listing",
        icon: "eye",
        onClick: () =>
          h({
            mode: "review",
            id: e.id,
          }),
      },
      {
        label: "Open product",
        icon: "shopping-bag",
        onClick: () =>
          t?.id &&
          navigate(`/commerce/products/edit?id=${encodeURIComponent(t.id)}`),
      },
      {
        label: "Open vendor",
        icon: "users",
        onClick: () =>
          n &&
          navigate(
            `/commerce/vendors?q=${encodeURIComponent(String(n.name || ""))}`,
          ),
      },
      {
        label: "Decision activity",
        icon: "history",
        onClick: () =>
          h({
            mode: "activity",
            id: e.id,
          }),
      },
      ...(["Approved", "Rejected"].includes(String(e.status || ""))
        ? []
        : [
            {
              label: "Approve listing",
              icon: "check-circle",
              separatorBefore: true,
              onClick: () => D(e),
            },
            {
              label: "Request changes",
              icon: "paper-plane",
              onClick: () =>
                h({
                  mode: "request",
                  id: e.id,
                }),
            },
            {
              label: "Reject listing",
              icon: "x",
              danger: true,
              onClick: () =>
                h({
                  mode: "reject",
                  id: e.id,
                }),
            },
          ]),
    ];
  };
  return (
    <Fragment>
      <CommercePageHeading
        title="Product approvals"
        onExport={E}
        onCreate={() =>
          h({
            mode: "create",
          })
        }
        createLabel="Submit listing"
      />
      <MarketplaceOperationsNav active="approvals" />
      <section
        className="vendor-summary-grid marketplace-review-summary"
        aria-label="Product approval overview"
      >
        <VendorSummaryCard
          icon="shopping-bag"
          label="Awaiting review"
          value={approvalNumberFormat.format(y.waiting)}
          detail={
            y.waiting
              ? "Vendor listings need a decision"
              : "Moderation queue is clear"
          }
          tone="amber"
        />
        <VendorSummaryCard
          icon="paper-plane"
          label="Changes requested"
          value={approvalNumberFormat.format(y.changes)}
          detail={
            y.changes ? "Vendor follow-up is open" : "No revision requests"
          }
          tone="blue"
        />
        <VendorSummaryCard
          icon="check-circle"
          label="Compliance passed"
          value={approvalNumberFormat.format(y.compliant)}
          detail={`${v.length} submitted listings`}
        />
        <VendorSummaryCard
          icon="star"
          label="Average quality"
          value={`${y.average}%`}
          detail={
            y.average >= 90
              ? "Strong catalog readiness"
              : "Content quality can improve"
          }
          tone={y.average >= 90 ? "green" : "amber"}
        />
      </section>
      <section className="glass-card approval-standards">
        <div>
          <span>CATALOG MODERATION</span>
          <h2>Publish only marketplace-ready listings</h2>
          <p>
            Use the same review standard for content, images, variants, SEO and
            compliance before vendor products reach shoppers.
          </p>
        </div>
        <div className="approval-standard-grid">
          <span>
            <Icon name="check-circle" />
            <strong>90%+</strong>
            <small>Content target</small>
          </span>
          <span>
            <Icon name="image" />
            <strong>Ready</strong>
            <small>Product imagery</small>
          </span>
          <span>
            <Icon name="list" />
            <strong>Checked</strong>
            <small>{"Variants & data"}</small>
          </span>
          <span className={y.blockers ? "danger" : ""}>
            <Icon name="info" />
            <strong>{y.blockers}</strong>
            <small>Blocking risks</small>
          </span>
        </div>
      </section>
      <section className="glass-card c-resource marketplace-review-resource">
        <div className="marketplace-review-heading">
          <div>
            <span>VENDOR CATALOG</span>
            <h2>Product moderation queue</h2>
            <p>
              Review listing quality and compliance with the vendor, product and
              decision history connected in one workspace.
            </p>
          </div>
          <small>
            {approvalNumberFormat.format(b.length)}
            {" matching listings"}
          </small>
        </div>
        <div className="c-toolbar marketplace-review-toolbar">
          <label className="c-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search products, vendors, feedback..."
              value={t}
              aria-label="Search product approvals"
              onChange={(e) => {
                n(e.currentTarget.value);
                d(1);
              }}
            />
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter approval status</span>
            <select
              value={r}
              onChange={(e) => {
                i(e.currentTarget.value);
                d(1);
              }}
            >
              <option value="">All statuses</option>
              {marketplaceReviewStatusOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>
        <div id="resource-results">
          <div className="marketplace-review-table-wrap">
            <div
              className="table-scroll marketplace-review-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Product approvals table"
            >
              <table className="marketplace-review-table approval-review-table">
                <thead>
                  <tr>
                    <th>Listing</th>
                    <MarketplaceSortableHeader
                      label="Quality"
                      sortKey="quality"
                      sort={a}
                      direction={s}
                      onSort={T}
                    />
                    <th>Content checks</th>
                    <th>{"Price & stock"}</th>
                    <th>Compliance</th>
                    <MarketplaceSortableHeader
                      label="Submitted"
                      sortKey="submittedAt"
                      sort={a}
                      direction={s}
                      onSort={T}
                    />
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {C.map((e) => {
                    const t = findRecord("products", String(e.productId || ""));
                    const n = findRecord("vendors", String(e.vendorId || ""));
                    return (
                      <tr key={e.id}>
                        <td>
                          <button
                            type="button"
                            className="approval-product-identity"
                            onClick={() =>
                              h({
                                mode: "review",
                                id: e.id,
                              })
                            }
                          >
                            {ApprovalProductThumb(t)}
                            <span>
                              <strong>
                                {String(t?.name || e.productId || "Product")}
                              </strong>
                              <small>
                                {String(n?.name || e.vendorId || "Vendor")}
                                {" · "}
                                {String(t?.category || "Catalog")}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <MarketplaceReviewScore
                            value={getListingApprovalScore(e)}
                            label="quality"
                          />
                        </td>
                        <td>
                          <ApprovalQualityChecks row={e} />
                        </td>
                        <td>
                          <div className="approval-commerce-cell">
                            <strong>
                              {t
                                ? formatCurrency(Number(t.price || 0), 2)
                                : "—"}
                            </strong>
                            <small>
                              {approvalNumberFormat.format(
                                Number(t?.stock || 0),
                              )}
                              {" units · "}
                              {String(t?.status || "—")}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="marketplace-verification-stack">
                            <MarketplaceReviewPill
                              value={e.compliance || "Review"}
                            />
                            <small>
                              {String(e.risk || "Low")}
                              {" risk"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <strong>{formatApprovalDate(e.submittedAt)}</strong>
                          <small className="vendor-cell-note">
                            {String(e.reviewer || "Unassigned")}
                          </small>
                        </td>
                        <td>
                          <MarketplaceReviewPill
                            value={e.status || "Pending"}
                          />
                        </td>
                        <td className="vendor-action-cell">
                          <RowActionsMenu
                            label={String(t?.name || "listing")}
                            actions={O(e)}
                            triggerClassName="marketplace-row-menu"
                            panelClassName="marketplace-row-menu-panel"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {C.length ? null : (
                <div className="c-empty">
                  <h3>
                    {t || r ? "No listing matches" : "No product approvals"}
                  </h3>
                  <p>Try another search or status filter.</p>
                </div>
              )}
            </div>
            <footer className="c-pagination">
              <span>
                {b.length ? (S - 1) * f + 1 : 0}–{Math.min(S * f, b.length)}
                {" of "}
                {b.length}
                {" listings"}
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
      {m?.mode === "create" || m?.mode === "edit" ? (
        <MarketplaceReviewFormDialog
          moduleId="approvals"
          recordId={m.id}
          onClose={() => h(null)}
          onChanged={w}
        />
      ) : null}
      {m?.mode === "review" && m.id ? (
        <ListingApprovalDetailDialog
          id={m.id}
          onClose={() => h(null)}
          onAction={(e, t) =>
            h({
              mode: e,
              id: t,
            })
          }
          onChanged={w}
        />
      ) : null}
      {(m?.mode === "request" || m?.mode === "reject") && m.id ? (
        <ListingApprovalDecisionDialog
          id={m.id}
          mode={m.mode}
          onClose={() => h(null)}
          onChanged={w}
        />
      ) : null}
      {m?.mode === "activity" && m.id ? (
        <ListingApprovalActivityDialog id={m.id} onClose={() => h(null)} />
      ) : null}
    </Fragment>
  );
}
