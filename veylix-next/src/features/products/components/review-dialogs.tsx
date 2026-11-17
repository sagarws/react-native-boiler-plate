// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { getProductThumbnail } from "@/features/products/lib/product-helpers";
import { showToast } from "@/lib/events";
import { integerFormatter } from "@/lib/intl-formatters";
import { hydrateProductImages } from "@/lib/media-storage";
import { navigate } from "@/lib/navigation";
import { findRecord } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

function formatReviewDialogDate(e) {
  const t = new Date(String(e || ""));
  return Number.isNaN(t.getTime())
    ? String(e || "—")
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(t);
}

function renderReviewDialogStars(e) {
  const t = Math.max(0, Math.min(5, Number(e) || 0));
  return `${"★".repeat(t)}${"☆".repeat(Math.max(0, 5 - t))}`;
}

function ReviewDialogStatusPill({ value }) {
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

export function ReviewDetailDialog({ recordId, onClose, onReply, onChanged }) {
  const i = useRef(null);
  const a = findRecord("reviews", recordId);
  const o = a ? findRecord("products", a.productId) : void 0;
  if (
    (useEffect(() => {
      if (i.current) {
        hydrateProductImages(i.current).catch(() => void 0);
      }
    }, [recordId]),
    !a)
  )
    return null;
  const s = (e) => {
    try {
      saveRecord(
        "reviews",
        {
          status: e,
        },
        a.id,
      );
      onChanged();
      showToast(`Review marked ${e.toLowerCase()}.`);
      onClose();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Review status could not be updated.",
      );
    }
  };
  return (
    <AppDialog
      title={`${String(o?.name || "Product")} · review`}
      onClose={onClose}
      wide
      className="marketplace-review-dialog"
    >
      <div ref={i}>
        <div className="review-detail-hero">
          {o ? (
            <OverviewProductThumb product={getProductThumbnail(o)} />
          ) : (
            <span className="catalog-detail-icon">
              <Icon name="star" />
            </span>
          )}
          <div>
            <small>
              {String(a.customer || "")}
              {" · "}
              {String(a.source || "")}
              {" · "}
              {formatReviewDialogDate(a.submittedAt)}
            </small>
            <h2>{String(a.title || "Customer review")}</h2>
            <span className="review-stars large">
              {renderReviewDialogStars(a.rating)}
            </span>
          </div>
          <ReviewDialogStatusPill value={a.status} />
        </div>
        <blockquote className="review-quote">
          {String(a.review || "")}
        </blockquote>
        <div className="catalog-detail-metrics">
          <div>
            <small>Helpful votes</small>
            <strong>{integerFormatter.format(Number(a.helpful || 0))}</strong>
          </div>
          <div>
            <small>Sentiment</small>
            <strong>{String(a.sentiment || "—")}</strong>
          </div>
          <div>
            <small>Rating</small>
            <strong>
              {Number(a.rating || 0).toFixed(1)}
              {" / 5"}
            </strong>
          </div>
          <div>
            <small>Response</small>
            <strong>
              {String(a.reply || "").trim() ? "Answered" : "Open"}
            </strong>
          </div>
        </div>
        <section className="review-reply-panel">
          <small>MERCHANT REPLY</small>
          <p>{String(a.reply || "").trim() || "No merchant reply yet."}</p>
        </section>
        <div className="button-row">
          <button type="button" className="primary-button" onClick={onReply}>
            {String(a.reply || "").trim() ? "Edit reply" : "Reply"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => s("Published")}
          >
            Publish
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => s("Hidden")}
          >
            Hide
          </button>
          {o ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                onClose();
                navigate(
                  `/commerce/products?q=${encodeURIComponent(String(o.name || ""))}`,
                );
              }}
            >
              View product
            </button>
          ) : null}
        </div>
      </div>
    </AppDialog>
  );
}

export function ReviewReplyDialog({ recordId, onClose, onSaved }) {
  const r = findRecord("reviews", recordId);
  const [i, a] = useState(String(r?.reply || ""));
  const [o, s] = useState("");
  return r ? (
    <AppDialog
      title={`Reply to ${String(r.customer || "customer")}`}
      onClose={onClose}
    >
      <form
        className="c-form"
        data-c-form="review-reply"
        onSubmit={(e) => {
          e.preventDefault();
          const a = i.trim();
          if (!a) s("Write a reply before saving.");
          else
            try {
              saveRecord(
                "reviews",
                {
                  reply: a,
                },
                r.id,
              );
              onSaved();
              onClose();
              showToast("Merchant reply saved.");
            } catch (e) {
              s(
                e instanceof Error
                  ? e.message
                  : "Merchant reply could not be saved.",
              );
            }
        }}
      >
        <fieldset>
          <legend>Merchant response</legend>
          <label className="c-field">
            <span>Reply</span>
            <textarea
              name="reply"
              rows={5}
              required
              value={i}
              onChange={(e) => a(e.currentTarget.value)}
            />
          </label>
        </fieldset>
        <p className="c-form-error" role="alert">
          {o}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            Save reply
          </button>
        </div>
      </form>
    </AppDialog>
  ) : null;
}
