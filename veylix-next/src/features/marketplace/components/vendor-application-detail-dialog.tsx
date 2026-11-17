// @ts-nocheck
import { Fragment } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import {
  MarketplaceReviewPill,
  MarketplaceReviewScore,
} from "@/features/marketplace/components/marketplace-review-ui";
import {
  applicationNumberFormat,
  formatApplicationDate,
  getApplicantInitials,
} from "@/features/marketplace/lib/application-formatters";
import { getApplicationReadinessScore } from "@/features/marketplace/lib/marketplace-review";
import { findRecord } from "@/lib/store/core";

export function VendorApplicationDetailDialog({ id, onClose, onAction }) {
  const r = findRecord("applications", id);
  if (!r) return null;
  const i = getApplicationReadinessScore(r);
  const a = [
    [
      "Business identity",
      r.owner && r.taxId ? "Ready" : "Needs review",
      `${String(r.businessType || "Business")} · ${String(r.taxId || "Registration ID missing")}`,
    ],
    [
      "Verification documents",
      r.documents || "Missing",
      r.verification || "Ready for review",
    ],
    [
      "Payout geography",
      r.payoutCountry ? "Ready" : "Needs review",
      r.payoutCountry || "Payout country not supplied",
    ],
    [
      "Marketplace risk",
      r.risk || "Low",
      r.risk === "Low"
        ? "No elevated onboarding flag"
        : "Manual review recommended",
    ],
  ];
  const o = ["Approved", "Rejected"].includes(String(r.status || ""));
  return (
    <AppDialog
      title={`${String(r.name)} · application`}
      onClose={onClose}
      wide
      className="vendor-detail-dialog marketplace-review-dialog"
    >
      <div className="marketplace-review-hero">
        <span className="vendor-detail-avatar">{getApplicantInitials(r)}</span>
        <div>
          <small>
            {String(r.businessType || "Vendor applicant")}
            {" · "}
            {String(r.country || "—")}
          </small>
          <h2>{String(r.name)}</h2>
          <p>
            {String(r.owner || "—")}
            {" · "}
            {String(r.email || "—")}
            {" · "}
            {String(r.phone || "No phone")}
          </p>
          <div>
            <MarketplaceReviewPill value={r.status} />
            <MarketplaceReviewPill value={r.verification} />
            <MarketplaceReviewPill value={r.risk} />
          </div>
        </div>
        <div className="marketplace-review-hero-score">
          <MarketplaceReviewScore value={i} label="onboarding" />
        </div>
      </div>
      <div className="vendor-detail-metrics marketplace-review-metrics">
        <div>
          <small>Expected catalog</small>
          <strong>
            {applicationNumberFormat.format(Number(r.expectedSkus || 0))}
            {" SKUs"}
          </strong>
        </div>
        <div>
          <small>Primary category</small>
          <strong>{String(r.category || "—")}</strong>
        </div>
        <div>
          <small>Submitted</small>
          <strong>{formatApplicationDate(r.submittedAt)}</strong>
        </div>
        <div>
          <small>Reviewer</small>
          <strong>{String(r.reviewer || "Unassigned")}</strong>
        </div>
      </div>
      <div className="marketplace-review-detail-grid">
        <section>
          <div className="marketplace-review-section-head">
            <h3>Business profile</h3>
            <span>
              <Icon name="users" />
            </span>
          </div>
          <dl>
            <div>
              <dt>Owner</dt>
              <dd>{String(r.owner || "—")}</dd>
            </div>
            <div>
              <dt>Website</dt>
              <dd>{String(r.website || "—")}</dd>
            </div>
            <div>
              <dt>Registration</dt>
              <dd>{String(r.taxId || "—")}</dd>
            </div>
            <div>
              <dt>Selling categories</dt>
              <dd>{String(r.categories || r.category || "—")}</dd>
            </div>
            <div>
              <dt>Payout country</dt>
              <dd>{String(r.payoutCountry || "—")}</dd>
            </div>
          </dl>
        </section>
        <section>
          <div className="marketplace-review-section-head">
            <h3>Onboarding readiness</h3>
            <span>
              <Icon name="check-circle" />
            </span>
          </div>
          <div className="marketplace-check-list">
            {a.map(([e, t, n]) => (
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
      </div>
      <section className="vendor-detail-section marketplace-notes">
        <div>
          <h3>Reviewer notes</h3>
          <span>
            {r.decisionAt
              ? `Decision ${formatApplicationDate(r.decisionAt)}`
              : "Decision pending"}
          </span>
        </div>
        <p>{String(r.notes || "No internal notes yet.")}</p>
      </section>
      <div className="button-row vendor-detail-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => onAction("edit", id)}
        >
          Edit application
        </button>
        {o ? null : (
          <Fragment>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onAction("request", id)}
            >
              Request documents
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => onAction("approve", id)}
            >
              Approve vendor
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
