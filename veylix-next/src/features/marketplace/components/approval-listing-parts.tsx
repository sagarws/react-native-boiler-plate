// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { approvalProductIconAliases } from "@/features/marketplace/lib/approval-formatters";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";

export function ApprovalProductThumb(e) {
  const t = Array.isArray(e?.mediaIds) ? e.mediaIds : [];
  return e ? (
    <OverviewProductThumb
      product={{
        mediaId: t.length ? String(t[0] || "") : void 0,
        icon:
          approvalProductIconAliases[String(e.image || "")] ||
          String(e.image || ""),
      }}
    />
  ) : (
    <span className="product-thumb-fallback" />
  );
}

export function ApprovalQualityChecks({ row }) {
  const t = [
    ["Images", row.images],
    ["Variants", row.variants],
    ["SEO", row.seo],
    ["Compliance", row.compliance],
  ];
  return (
    <div className="approval-checks">
      {t.map(([e, t]) => (
        <span
          key={String(e)}
          className={
            /ready|passed|not applicable/i.test(String(t || ""))
              ? "green"
              : /missing|blocked/i.test(String(t || ""))
                ? "red"
                : "amber"
          }
          title={`${String(e)} · ${String(t || "—")}`}
        >
          <Icon
            name={
              /ready|passed|not applicable/i.test(String(t || ""))
                ? "check-circle"
                : "info"
            }
          />
          <small>{String(e)}</small>
        </span>
      ))}
    </div>
  );
}
