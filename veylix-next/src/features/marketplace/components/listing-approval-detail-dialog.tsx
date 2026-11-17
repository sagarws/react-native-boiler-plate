// @ts-nocheck
import { Fragment } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { ApprovalProductThumb } from "@/features/marketplace/components/approval-listing-parts";
import {
  MarketplaceReviewPill,
  MarketplaceReviewScore,
} from "@/features/marketplace/components/marketplace-review-ui";
import {
  approvalNumberFormat,
  formatApprovalDate,
} from "@/features/marketplace/lib/approval-formatters";
import { getListingApprovalScore } from "@/features/marketplace/lib/marketplace-review";
import { approveListingReview } from "@/features/marketplace/lib/marketplace-review-actions";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { navigate } from "@/lib/navigation";
import { findRecord } from "@/lib/store/core";

export function ListingApprovalDetailDialog({
  id,
  onClose,
  onAction,
  onChanged,
}) {
  const i = findRecord("approvals", id);
  if (!i) return null;
  const a = findRecord("products", String(i.productId || ""));
  const o = findRecord("vendors", String(i.vendorId || ""));
  const s = getListingApprovalScore(i);
  const c = ["Approved", "Rejected"].includes(String(i.status || ""));
  const l = [
    ["Product images", i.images, "Use clear product-focused media."],
    [
      "Variant readiness",
      i.variants,
      "Options, SKUs and stock should be coherent.",
    ],
    ["SEO readiness", i.seo, "Title and search metadata should be complete."],
    ["Compliance", i.compliance, "Marketplace policy and product data review."],
  ];
  return (
    <AppDialog
      title={`${String(a?.name || "Product")} · moderation`}
      onClose={onClose}
      wide
      className="vendor-detail-dialog marketplace-review-dialog"
    >
      <div className="marketplace-review-hero approval-review-hero">
        {ApprovalProductThumb(a)}
        <div>
          <small>
            {String(o?.name || i.vendorId || "Vendor")}
            {" · "}
            {String(a?.category || "Catalog")}
          </small>
          <h2>{String(a?.name || i.productId || "Product")}</h2>
          <p>
            {String(a?.sku || "No SKU")}
            {" · "}
            {a ? formatCurrency(Number(a.price || 0), 2) : "—"}
            {" · "}
            {approvalNumberFormat.format(Number(a?.stock || 0))}
            {" units"}
          </p>
          <div>
            <MarketplaceReviewPill value={i.status} />
            <MarketplaceReviewPill value={i.compliance} />
            <MarketplaceReviewPill value={`${String(i.risk || "Low")} risk`} />
          </div>
        </div>
        <div className="marketplace-review-hero-score">
          <MarketplaceReviewScore value={s} label="quality" />
        </div>
      </div>
      <div className="vendor-detail-metrics marketplace-review-metrics">
        <div>
          <small>Completeness</small>
          <strong>{Math.round(Number(i.completeness || 0))}%</strong>
        </div>
        <div>
          <small>Submitted</small>
          <strong>{formatApprovalDate(i.submittedAt)}</strong>
        </div>
        <div>
          <small>Reviewer</small>
          <strong>{String(i.reviewer || "Unassigned")}</strong>
        </div>
        <div>
          <small>Vendor status</small>
          <strong>{String(o?.status || "—")}</strong>
        </div>
      </div>
      <section className="marketplace-review-check-panel">
        <div className="marketplace-review-section-head">
          <h3>Listing review checklist</h3>
          <span>
            <Icon name="clipboard-text" />
          </span>
        </div>
        <div className="marketplace-check-list approval-check-list">
          {l.map(([e, t, n]) => (
            <div key={String(e)}>
              <span>
                <MarketplaceReviewPill value={t} />
              </span>
              <div>
                <strong>{String(e)}</strong>
                <small>{String(n)}</small>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="vendor-detail-section marketplace-notes">
        <div>
          <h3>Reviewer feedback</h3>
          <span>
            {i.decisionAt
              ? `Decision ${formatApprovalDate(i.decisionAt)}`
              : "Decision pending"}
          </span>
        </div>
        <p>{String(i.feedback || "No reviewer feedback yet.")}</p>
      </section>
      <div className="button-row vendor-detail-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            a?.id &&
            navigate(`/commerce/products/edit?id=${encodeURIComponent(a.id)}`)
          }
        >
          Open product
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            o &&
            navigate(
              `/commerce/vendors?q=${encodeURIComponent(String(o.name || ""))}`,
            )
          }
        >
          Open vendor
        </button>
        {c ? null : (
          <Fragment>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onAction("request", id)}
            >
              Request changes
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                try {
                  approveListingReview(id);
                  onClose();
                  onChanged();
                  showToast(
                    `${String(a?.name || "Product")} approved for marketplace publishing.`,
                  );
                } catch (e) {
                  showToast(
                    e instanceof Error
                      ? e.message
                      : "This listing could not be approved.",
                  );
                }
              }}
            >
              Approve listing
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onAction("reject", id)}
            >
              Reject
            </button>
          </Fragment>
        )}
      </div>
    </AppDialog>
  );
}
