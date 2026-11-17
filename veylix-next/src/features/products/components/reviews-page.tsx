// @ts-nocheck
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { BulkSelectionBar } from "@/components/ui/bulk-selection-bar";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { modulesById } from "@/config/modules/registry";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import {
  ReviewDetailDialog,
  ReviewReplyDialog,
} from "@/features/products/components/review-dialogs";
import { getProductThumbnail } from "@/features/products/lib/product-helpers";
import { ResourceRecordDialog } from "@/features/resources/components/resource-record-dialog";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { integerFormatter } from "@/lib/intl-formatters";
import { hydrateProductImages } from "@/lib/media-storage";
import { buildHref, navigate } from "@/lib/navigation";
import { findRecord, listRecords } from "@/lib/store/core";
import { archiveRecords, saveRecord } from "@/lib/store/records";

const catalogMerchNavLinks = [
  ["brands", "Brands"],
  ["collections", "Collections"],
  ["tags", "Tags"],
  ["reviews", "Reviews & ratings"],
];

const reviewSourceOptions = ["Verified purchase", "Storefront", "Imported"];

const reviewStatusOptions = ["Pending", "Published", "Hidden", "Flagged"];

function renderReviewStars(e) {
  const t = Math.max(0, Math.min(5, Number(e) || 0));
  return `${"★".repeat(t)}${"☆".repeat(Math.max(0, 5 - t))}`;
}

function formatReviewDate(e) {
  const t = new Date(String(e || ""));
  return Number.isNaN(t.getTime())
    ? String(e || "—")
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(t);
}

function ReviewStatusPill({ value }) {
  const t = String(value || "");
  const n = /active|published|positive|featured/i.test(t)
    ? "green"
    : /pending|scheduled|neutral|standard/i.test(t)
      ? "amber"
      : /hidden|flagged|negative|draft/i.test(t)
        ? "red"
        : "blue";
  return (
    <span className={`product-status ${n}`}>
      <i />
      {t}
    </span>
  );
}

function ReviewSummaryCard({ icon, label, value, detail, tone = "green" }) {
  return (
    <div className={`product-summary-card ${tone}`}>
      <div className="product-summary-top">
        <span className="product-summary-icon">
          <Icon name={icon} />
        </span>
        <small>{detail}</small>
      </div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function ReviewsPage({ initialQuery = "" }) {
  const t = useRef(null);
  const n = modulesById.reviews;
  const [r, i] = useState(initialQuery);
  const [a, o] = useState("");
  const [s, c] = useState("");
  const [u, d] = useState("");
  const [f, p] = useState(false);
  const [m, h] = useState(1);
  const [g, _] = useState(8);
  const [v, y] = useState(() => new Set());
  const [b, x] = useState(0);
  const [S, C] = useState(null);
  const w = useMemo(() => listRecords("reviews"), [b]);
  const T = useMemo(
    () =>
      listRecords("reviews", {
        archived: f,
      }),
    [f, b],
  );
  const E = useMemo(
    () =>
      T.filter(
        (e) =>
          !(
            (r &&
              !`${findRecord("products", e.productId)?.name || ""} ${e.customer || ""} ${e.title || ""} ${e.review || ""} ${e.reply || ""}`
                .toLowerCase()
                .includes(r.toLowerCase())) ||
            (a && e.status !== a) ||
            (s && e.source !== s) ||
            (u && Number(e.rating) !== Number(u))
          ),
      ).sort((e, t) =>
        String(t.submittedAt || "").localeCompare(String(e.submittedAt || "")),
      ),
    [T, r, a, s, u],
  );
  const D = Math.max(1, Math.ceil(E.length / g));
  const O = Math.min(m, D);
  const k = E.slice((O - 1) * g, O * g);
  const A = E.length ? (O - 1) * g + 1 : 0;
  const j = Math.min(O * g, E.length);
  const M = () => y(new Set());
  const N = () => x((e) => e + 1);
  const ee = (e) => {
    try {
      e();
      N();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This change could not be completed.",
      );
    }
  };
  const te = () => {
    downloadFile(
      "veylix-reviews.csv",
      "﻿" +
        buildCsv(
          E,
          [
            "productId",
            "customer",
            "rating",
            "source",
            "title",
            "review",
            "submittedAt",
            "helpful",
            "sentiment",
            "status",
            "reply",
          ],
          [
            "Product ID",
            "Customer",
            "Rating",
            "Source",
            "Review title",
            "Review",
            "Submitted",
            "Helpful votes",
            "Sentiment",
            "Status",
            "Merchant reply",
          ],
        ),
    );
    showToast("Filtered reviews exported.");
  };
  const ne = w.filter((e) => e.status === "Published");
  const re = ne.length
    ? ne.reduce((e, t) => e + Number(t.rating || 0), 0) / ne.length
    : 0;
  const ie = w.filter((e) =>
    ["Pending", "Flagged"].includes(String(e.status || "")),
  ).length;
  const ae = ne.filter((e) => String(e.reply || "").trim()).length;
  const oe = ne.length || 1;
  const se = k.length > 0 && k.every((e) => v.has(e.id));
  useEffect(() => {
    if (t.current) {
      hydrateProductImages(t.current).catch(() => void 0);
    }
  }, [k, b]);
  const ce = (e, t) =>
    ee(() => {
      saveRecord(
        "reviews",
        {
          status: t,
        },
        e,
      );
      showToast(`Review marked ${t.toLowerCase()}.`);
    });
  return (
    <div ref={t}>
      <CommercePageHeading
        title={"Reviews & ratings"}
        onExport={te}
        onCreate={() =>
          C({
            mode: "create",
          })
        }
        createLabel="Add review"
      />
      <nav
        className="resource-shortcuts catalog-merch-nav"
        aria-label="Catalog merchandising pages"
      >
        {catalogMerchNavLinks.map(([e, t]) =>
          e === "reviews" ? (
            <span key={e} className="secondary-button is-active">
              {t}
            </span>
          ) : (
            <Link
              key={e}
              className="secondary-button"
              href={buildHref(`/commerce/${e}`)}
            >
              {t}
            </Link>
          ),
        )}
      </nav>
      <section className="product-summary-grid catalog-merch-summary">
        <ReviewSummaryCard
          icon="star"
          label="Average rating"
          value={re ? re.toFixed(1) : "—"}
          detail={`${ne.length} published reviews`}
        />
        <ReviewSummaryCard
          icon="check-circle"
          label="Published"
          value={String(ne.length)}
          detail="Visible to shoppers"
          tone="green"
        />
        <ReviewSummaryCard
          icon="info"
          label="Needs moderation"
          value={String(ie)}
          detail="Pending or flagged"
          tone="amber"
        />
        <ReviewSummaryCard
          icon="chats-circle"
          label="Response rate"
          value={ne.length ? `${Math.round((ae / ne.length) * 100)}%` : "0%"}
          detail="Published reviews answered"
          tone="blue"
        />
      </section>
      <section className="glass-card review-insight-grid">
        <div className="review-distribution">
          <div className="catalog-ops-heading">
            <div>
              <span>RATING DISTRIBUTION</span>
              <h2>Customer sentiment at a glance</h2>
              <p>
                Published feedback only, so moderation work does not distort
                storefront sentiment.
              </p>
            </div>
          </div>
          <div className="review-bars">
            {[5, 4, 3, 2, 1].map((e) => {
              const t = ne.filter((t) => Number(t.rating) === e).length;
              const n = (t / oe) * 100;
              return (
                <div key={e}>
                  <span>
                    {e} <Icon name="star" />
                  </span>
                  <i>
                    <b
                      style={{
                        width: `${n}%`,
                      }}
                    />
                  </i>
                  <em>{t}</em>
                </div>
              );
            })}
          </div>
        </div>
        <div className="review-queue-guide">
          <span>MODERATION FLOW</span>
          <h2>Protect trust without hiding criticism</h2>
          <div>
            <b>
              <Icon name="check-circle" />
            </b>
            <p>
              <strong>Publish genuine feedback</strong>
              <small>
                Verified or storefront reviews can stay visible even when the
                rating is low.
              </small>
            </p>
          </div>
          <div>
            <b>
              <Icon name="info" />
            </b>
            <p>
              <strong>Flag policy concerns</strong>
              <small>
                Use Flagged for content that needs a closer policy or support
                review.
              </small>
            </p>
          </div>
          <div>
            <b>
              <Icon name="chats-circle" />
            </b>
            <p>
              <strong>Reply with context</strong>
              <small>
                Merchant responses stay attached to the original review.
              </small>
            </p>
          </div>
        </div>
      </section>
      <section className="glass-card product-filter-card catalog-ops-filter">
        <div className="c-toolbar product-toolbar">
          <label className="c-filter">
            <select
              data-review-source
              value={s}
              onChange={(e) => {
                c(e.currentTarget.value);
                h(1);
                M();
              }}
            >
              <option value="">All sources</option>
              {reviewSourceOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <select
              data-review-rating
              value={u}
              onChange={(e) => {
                d(e.currentTarget.value);
                h(1);
                M();
              }}
            >
              <option value="">All ratings</option>
              {[5, 4, 3, 2, 1].map((e) => (
                <option key={e} value={e}>
                  {e}
                  {" stars"}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <select
              data-c-filter
              value={a}
              onChange={(e) => {
                o(e.currentTarget.value);
                h(1);
                M();
              }}
            >
              <option value="">All statuses</option>
              {reviewStatusOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-archive-toggle">
            <input
              type="checkbox"
              data-c-archive
              checked={f}
              onChange={(e) => {
                p(e.currentTarget.checked);
                h(1);
                M();
              }}
            />
            {" Archived reviews"}
          </label>
          <label className="c-search product-search">
            <Icon name="search" />
            <input
              data-c-search
              type="search"
              placeholder="Search product, customer or review..."
              value={r}
              onChange={(e) => {
                i(e.currentTarget.value);
                h(1);
                M();
              }}
            />
          </label>
        </div>
      </section>
      <section className="glass-card c-resource catalog-ops-resource">
        <div className="product-list-heading catalog-ops-list-heading">
          <div>
            <span>VOICE OF CUSTOMER</span>
            <h2>Review moderation queue</h2>
            <p>
              Keep ratings, policy review and merchant responses connected to
              each product.
            </p>
          </div>
          <small>
            {E.length}
            {" matching reviews"}
          </small>
        </div>
        <div id="resource-results">
          <BulkSelectionBar
            count={v.size}
            archived={f}
            onBulkArchive={() =>
              ee(() => {
                archiveRecords("reviews", [...v], f);
                M();
                showToast(f ? "Records restored." : "Records archived.");
              })
            }
            onClear={M}
          />
          <div className="table-scroll c-table-scroll catalog-ops-table-scroll">
            <table className="c-table catalog-ops-table catalog-merch-table review-table">
              <thead>
                <tr>
                  <th className="c-check">
                    <input
                      type="checkbox"
                      checked={se}
                      onChange={(e) => {
                        const t = e.currentTarget.checked;
                        y((e) => {
                          const n = new Set(e);
                          k.forEach((e) => (t ? n.add(e.id) : n.delete(e.id)));
                          return n;
                        });
                      }}
                      aria-label="Select all visible reviews"
                    />
                  </th>
                  <th>Review</th>
                  <th>Rating</th>
                  <th>Source</th>
                  <th>Helpful</th>
                  <th>Sentiment</th>
                  <th>Response</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {k.map((e) => {
                  const t = findRecord("products", e.productId);
                  const n = f
                    ? [
                        {
                          label: "Restore review",
                          icon: "check-circle",
                          onClick: () =>
                            ee(() => {
                              archiveRecords("reviews", [e.id], true);
                              showToast("Records restored.");
                            }),
                        },
                      ]
                    : [
                        {
                          label: "Moderate review",
                          icon: "eye",
                          onClick: () =>
                            C({
                              mode: "detail",
                              id: e.id,
                            }),
                        },
                        {
                          label: String(e.reply || "").trim()
                            ? "Edit reply"
                            : "Reply to review",
                          icon: "chats-circle",
                          onClick: () =>
                            C({
                              mode: "reply",
                              id: e.id,
                            }),
                        },
                        {
                          label: "View product",
                          icon: "package",
                          onClick: () =>
                            navigate(
                              `/commerce/products?q=${encodeURIComponent(String(t?.name || ""))}`,
                            ),
                        },
                        {
                          label: "Publish",
                          icon: "check-circle",
                          onClick: () => ce(e.id, "Published"),
                        },
                        {
                          label: "Hide review",
                          icon: "info",
                          onClick: () => ce(e.id, "Hidden"),
                        },
                        {
                          label: "Flag for review",
                          icon: "info",
                          onClick: () => ce(e.id, "Flagged"),
                        },
                        {
                          label: "Archive review",
                          icon: "trash",
                          danger: true,
                          separatorBefore: true,
                          onClick: () =>
                            ee(() => {
                              archiveRecords("reviews", [e.id]);
                              showToast("Records archived.");
                            }),
                        },
                      ];
                  return (
                    <tr key={e.id}>
                      <td className="c-check">
                        <input
                          type="checkbox"
                          checked={v.has(e.id)}
                          onChange={(t) =>
                            y((n) => {
                              const r = new Set(n);
                              if (t.currentTarget.checked) {
                                r.add(e.id);
                              } else {
                                r.delete(e.id);
                              }
                              return r;
                            })
                          }
                          aria-label={`Select review by ${String(e.customer || "")}`}
                        />
                      </td>
                      <td>
                        <button
                          className="review-record-cell"
                          type="button"
                          onClick={() =>
                            C({
                              mode: "detail",
                              id: e.id,
                            })
                          }
                        >
                          {t ? (
                            <OverviewProductThumb
                              product={getProductThumbnail(t)}
                            />
                          ) : null}
                          <span>
                            <strong>
                              {String(t?.name || "Missing product")}
                            </strong>
                            <small>
                              {String(e.customer || "")}
                              {" · "}
                              {String(e.title || e.review || "").slice(0, 44)}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="review-stars">
                          {renderReviewStars(e.rating)}
                        </span>
                        <small className="catalog-cell-note">
                          {Number(e.rating || 0).toFixed(1)}
                        </small>
                      </td>
                      <td>
                        <strong>{String(e.source || "")}</strong>
                        <small className="catalog-cell-note">
                          {e.source === "Verified purchase"
                            ? "Verified buyer"
                            : "Customer feedback"}
                        </small>
                      </td>
                      <td>
                        <strong>
                          {integerFormatter.format(Number(e.helpful || 0))}
                        </strong>
                        <small className="catalog-cell-note">votes</small>
                      </td>
                      <td>
                        <ReviewStatusPill value={e.sentiment} />
                      </td>
                      <td>
                        {String(e.reply || "").trim() ? (
                          <span className="review-response answered">
                            <Icon name="check-circle" />
                            {" Replied"}
                          </span>
                        ) : (
                          <span className="review-response">No reply</span>
                        )}
                      </td>
                      <td>
                        <ReviewStatusPill value={e.status} />
                      </td>
                      <td>
                        <strong>{formatReviewDate(e.submittedAt)}</strong>
                      </td>
                      <td className="product-actions-cell">
                        <RowActionsMenu
                          label={String(t?.name || "review")}
                          actions={n}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {E.length ? null : (
              <div className="c-empty">
                <Icon name="basket" />
                <h3>No reviews match</h3>
                <p>Try another status, source, rating or search term.</p>
              </div>
            )}
          </div>
          <footer className="c-pagination">
            <span>
              {A}–{j}
              {" of "}
              {E.length}
              {" reviews"}
            </span>
            <label>
              {"Per page "}
              <select
                data-c-page-size
                value={g}
                onChange={(e) => {
                  _(Number(e.currentTarget.value));
                  h(1);
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
                disabled={O === 1}
                onClick={() => h(Math.max(1, O - 1))}
              >
                Previous
              </button>
              <span>
                {O}
                {" / "}
                {D}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={O === D}
                onClick={() => h(Math.min(D, O + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {S?.mode === "create" ? (
        <ResourceRecordDialog
          module={n}
          mode="create"
          onClose={() => C(null)}
          onChanged={N}
        />
      ) : null}
      {S?.mode === "detail" ? (
        <ReviewDetailDialog
          recordId={S.id}
          onClose={() => C(null)}
          onReply={() =>
            C({
              mode: "reply",
              id: S.id,
            })
          }
          onChanged={N}
        />
      ) : null}
      {S?.mode === "reply" ? (
        <ReviewReplyDialog
          recordId={S.id}
          onClose={() => C(null)}
          onSaved={N}
        />
      ) : null}
    </div>
  );
}
