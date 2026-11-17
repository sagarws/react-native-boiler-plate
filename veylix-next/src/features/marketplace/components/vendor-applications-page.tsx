// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { MarketplaceOperationsNav } from "@/features/marketplace/components/marketplace-operations-nav";
import { MarketplaceReviewFormDialog } from "@/features/marketplace/components/marketplace-review-form-dialog";
import {
  MarketplaceReviewPill,
  MarketplaceReviewScore,
  MarketplaceSortableHeader,
  VendorSummaryCard,
} from "@/features/marketplace/components/marketplace-review-ui";
import { VendorApplicationActivityDialog } from "@/features/marketplace/components/vendor-application-activity-dialog";
import { VendorApplicationDecisionDialog } from "@/features/marketplace/components/vendor-application-decision-dialog";
import { VendorApplicationDetailDialog } from "@/features/marketplace/components/vendor-application-detail-dialog";
import {
  applicationNumberFormat,
  formatApplicationDate,
  getApplicantInitials,
} from "@/features/marketplace/lib/application-formatters";
import {
  getApplicationReadinessScore,
  marketplaceReviewStatusOptions,
  summarizeVendorApplications,
} from "@/features/marketplace/lib/marketplace-review";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { listRecords } from "@/lib/store/core";

export function VendorApplicationsPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState(1);
  const [u, d] = useState(1);
  const [f, p] = useState(8);
  const [m, h] = useState(null);
  const [g, _] = useState(0);
  const v = useMemo(() => listRecords("applications"), [g]);
  const y = summarizeVendorApplications(v);
  const b = useMemo(() => {
    let e = [...v];
    if (t) {
      const n = t.toLowerCase();
      e = e.filter((e) =>
        [
          e.name,
          e.owner,
          e.email,
          e.country,
          e.category,
          e.categories,
          e.businessType,
          e.verification,
          e.risk,
          e.status,
          e.reviewer,
        ]
          .join(" ")
          .toLowerCase()
          .includes(n),
      );
    }
    if (r) {
      e = e.filter((e) => e.status === r);
    }
    if (a) {
      e.sort((e, t) => {
        const n = (e) =>
          ({
            submittedAt: Date.parse(String(e.submittedAt || "")) || 0,
            expectedSkus: Number(e.expectedSkus || 0),
            readiness: getApplicationReadinessScore(e),
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
      name: e.name,
      owner: e.owner,
      email: e.email,
      businessType: e.businessType,
      country: e.country,
      category: e.category,
      expectedSkus: e.expectedSkus,
      documents: e.documents,
      verification: e.verification,
      risk: e.risk,
      readiness: getApplicationReadinessScore(e),
      reviewer: e.reviewer,
      submittedAt: e.submittedAt,
      decisionAt: e.decisionAt,
      status: e.status,
    }));
    downloadFile(
      "veylix-marketplace-applications.csv",
      "﻿" +
        buildCsv(e, Object.keys(e[0] || {}), [
          "Applicant",
          "Owner",
          "Email",
          "Business type",
          "Country",
          "Primary category",
          "Expected SKUs",
          "Documents",
          "Verification",
          "Risk",
          "Readiness",
          "Reviewer",
          "Submitted",
          "Decision",
          "Status",
        ]),
    );
    showToast("Filtered vendor applications exported.");
  };
  const D = (e) => [
    {
      label: "Review application",
      icon: "eye",
      onClick: () =>
        h({
          mode: "review",
          id: e.id,
        }),
    },
    {
      label: "Edit application",
      icon: "pencil",
      onClick: () =>
        h({
          mode: "edit",
          id: e.id,
        }),
    },
    {
      label: "Review activity",
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
            label: "Request documents",
            icon: "paper-plane",
            separatorBefore: true,
            onClick: () =>
              h({
                mode: "request",
                id: e.id,
              }),
          },
          {
            label: "Approve vendor",
            icon: "check-circle",
            onClick: () =>
              h({
                mode: "approve",
                id: e.id,
              }),
          },
          {
            label: "Reject application",
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
  return (
    <Fragment>
      <CommercePageHeading
        title="Vendor applications"
        onExport={E}
        onCreate={() =>
          h({
            mode: "create",
          })
        }
        createLabel="Add application"
      />
      <MarketplaceOperationsNav active="applications" />
      <section
        className="vendor-summary-grid marketplace-review-summary"
        aria-label="Application overview"
      >
        <VendorSummaryCard
          icon="clipboard-text"
          label="Awaiting decision"
          value={applicationNumberFormat.format(y.waiting)}
          detail={
            y.waiting
              ? "Onboarding queue needs review"
              : "No applications waiting"
          }
          tone="amber"
        />
        <VendorSummaryCard
          icon="check-circle"
          label="Documents ready"
          value={applicationNumberFormat.format(y.ready)}
          detail={`${v.length} total applications`}
        />
        <VendorSummaryCard
          icon="info"
          label="Risk review"
          value={applicationNumberFormat.format(y.risk)}
          detail={
            y.risk
              ? "Medium or high-risk applicants"
              : "No elevated onboarding risk"
          }
          tone={y.risk ? "red" : "green"}
        />
        <VendorSummaryCard
          icon="users"
          label="Approved partners"
          value={applicationNumberFormat.format(y.approved)}
          detail="Approved application records"
          tone="blue"
        />
      </section>
      <section className="glass-card marketplace-pipeline">
        <div className="marketplace-pipeline-copy">
          <span>ONBOARDING PIPELINE</span>
          <h2>Turn applications into verified partners</h2>
          <p>
            Review business fit, ownership documents, payout readiness and risk
            before marketplace access is granted.
          </p>
        </div>
        <div className="marketplace-pipeline-steps">
          {[
            [
              "Submitted",
              v.filter((e) => e.status === "Pending").length,
              "New partner requests",
            ],
            [
              "Verification",
              v.filter((e) => e.status === "Under review").length,
              "Documents and identity",
            ],
            [
              "Changes",
              v.filter((e) => e.status === "Changes requested").length,
              "Applicant follow-up",
            ],
            [
              "Decision",
              v.filter((e) =>
                ["Approved", "Rejected"].includes(String(e.status)),
              ).length,
              "Recorded outcomes",
            ],
          ].map(([e, t, n], r) => (
            <div key={String(e)}>
              <span>{r + 1}</span>
              <strong>{String(e)}</strong>
              <em>{applicationNumberFormat.format(Number(t))}</em>
              <small>{String(n)}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="glass-card c-resource marketplace-review-resource">
        <div className="marketplace-review-heading">
          <div>
            <span>PARTNER ONBOARDING</span>
            <h2>Application review queue</h2>
            <p>
              Keep commercial fit, documentation, verification and reviewer
              ownership visible before making a decision.
            </p>
          </div>
          <small>
            {applicationNumberFormat.format(b.length)}
            {" matching applications"}
          </small>
        </div>
        <div className="c-toolbar marketplace-review-toolbar">
          <label className="c-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search applicants, owners, countries..."
              value={t}
              aria-label="Search vendor applications"
              onChange={(e) => {
                n(e.currentTarget.value);
                d(1);
              }}
            />
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter application status</span>
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
              aria-label="Vendor applications table"
            >
              <table className="marketplace-review-table application-review-table">
                <thead>
                  <tr>
                    <MarketplaceSortableHeader
                      label="Applicant"
                      sortKey="name"
                      sort={a}
                      direction={s}
                      onSort={T}
                    />
                    <th>Business</th>
                    <MarketplaceSortableHeader
                      label="Catalog plan"
                      sortKey="expectedSkus"
                      sort={a}
                      direction={s}
                      onSort={T}
                    />
                    <th>Verification</th>
                    <th>Risk</th>
                    <MarketplaceSortableHeader
                      label="Readiness"
                      sortKey="readiness"
                      sort={a}
                      direction={s}
                      onSort={T}
                    />
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
                  {C.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <button
                          type="button"
                          className="vendor-identity marketplace-applicant"
                          onClick={() =>
                            h({
                              mode: "review",
                              id: e.id,
                            })
                          }
                        >
                          <span className="vendor-avatar">
                            {getApplicantInitials(e)}
                          </span>
                          <span>
                            <strong>{String(e.name)}</strong>
                            <small>
                              {String(e.owner || "Applicant")}
                              {" · "}
                              {String(e.email || "—")}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <div className="vendor-category">
                          <strong>{String(e.businessType || "—")}</strong>
                          <small>{String(e.country || "—")}</small>
                        </div>
                      </td>
                      <td>
                        <div className="marketplace-catalog-plan">
                          <strong>{String(e.category || "—")}</strong>
                          <small>
                            {applicationNumberFormat.format(
                              Number(e.expectedSkus || 0),
                            )}
                            {" planned SKUs"}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div className="marketplace-verification-stack">
                          <MarketplaceReviewPill
                            value={e.verification || "Ready for review"}
                          />
                          <small>
                            {String(e.documents || "Missing")}
                            {" documents"}
                          </small>
                        </div>
                      </td>
                      <td>
                        <MarketplaceReviewPill value={e.risk || "Low"} />
                      </td>
                      <td>
                        <MarketplaceReviewScore
                          value={getApplicationReadinessScore(e)}
                        />
                      </td>
                      <td>
                        <strong>{formatApplicationDate(e.submittedAt)}</strong>
                        <small className="vendor-cell-note">
                          {String(e.reviewer || "Unassigned")}
                        </small>
                      </td>
                      <td>
                        <MarketplaceReviewPill value={e.status || "Pending"} />
                      </td>
                      <td className="vendor-action-cell">
                        <RowActionsMenu
                          label={String(e.name || "application")}
                          actions={D(e)}
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
                  <h3>
                    {t || r
                      ? "No application matches"
                      : "No vendor applications"}
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
                {" applications"}
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
          moduleId="applications"
          recordId={m.id}
          onClose={() => h(null)}
          onChanged={w}
        />
      ) : null}
      {m?.mode === "review" && m.id ? (
        <VendorApplicationDetailDialog
          id={m.id}
          onClose={() => h(null)}
          onAction={(e, t) =>
            h({
              mode: e,
              id: t,
            })
          }
        />
      ) : null}
      {(m?.mode === "approve" ||
        m?.mode === "request" ||
        m?.mode === "reject") &&
      m.id ? (
        <VendorApplicationDecisionDialog
          mode={m.mode}
          id={m.id}
          onClose={() => h(null)}
          onChanged={w}
        />
      ) : null}
      {m?.mode === "activity" && m.id ? (
        <VendorApplicationActivityDialog id={m.id} onClose={() => h(null)} />
      ) : null}
    </Fragment>
  );
}
