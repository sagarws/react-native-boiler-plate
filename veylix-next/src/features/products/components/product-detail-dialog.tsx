// @ts-nocheck
import Link from "next/link";
import { useEffect, useRef } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { SummaryList } from "@/components/ui/summary-list";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import {
  findProductById,
  formatProductUpdatedAt,
  getProductStockStatus,
  getProductThumbnail,
  productsModule,
} from "@/features/products/lib/product-helpers";
import { ResourceCellValue } from "@/features/resources/components/resource-cell-value";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { compactUsdFormatter, integerFormatter } from "@/lib/intl-formatters";
import { hydrateProductImages } from "@/lib/media-storage";
import { buildHref } from "@/lib/navigation";

export function ProductDetailDialog({ productId, onClose, onEdit }) {
  const r = findProductById(productId);
  const i = useRef(null);
  if (
    (useEffect(() => {
      if (i.current) {
        hydrateProductImages(i.current).catch((e) =>
          showToast(
            e instanceof Error
              ? e.message
              : "Product image could not be loaded.",
          ),
        );
      }
    }, [productId]),
    !r)
  )
    return null;
  const a = !!r._archived;
  return (
    <AppDialog
      title={String(r.name || productsModule.title)}
      onClose={onClose}
      wide
    >
      <div ref={i}>
        <div className="c-product-hero">
          <OverviewProductThumb product={getProductThumbnail(r)} />
          <div>
            <strong>{formatCurrency(Number(r.price || 0), 2)}</strong>
            <p>{String(r.description || "")}</p>
          </div>
        </div>
        <SummaryList
          items={[
            [
              "Sales",
              integerFormatter.format(Number(r.sold || 0)),
              "Units sold",
            ],
            [
              "Revenue",
              compactUsdFormatter.format(
                Number(r.sold || 0) * Number(r.price || 0),
              ),
              "Gross catalog revenue",
            ],
            [
              "Rating",
              Number(r.rating || 0) ? Number(r.rating || 0).toFixed(1) : "—",
              "Customer score",
            ],
            ["Modified", formatProductUpdatedAt(r), getProductStockStatus(r)],
          ]}
        />
        <div className="button-row">
          {a ? null : (
            <Link
              className="secondary-button"
              href={buildHref(
                `/commerce/products/edit?id=${encodeURIComponent(r.id)}`,
              )}
            >
              {"Manage options & variants"}
            </Link>
          )}
          <Link
            className="secondary-button"
            href={buildHref("/commerce/reviews")}
          >
            Customer reviews
          </Link>
        </div>
        <dl className="c-details">
          {productsModule.fields.map((e) => (
            <div key={e.key}>
              <dt>{e.label}</dt>
              <dd>
                <ResourceCellValue
                  module={productsModule}
                  row={r}
                  fieldKey={e.key}
                />
              </dd>
            </div>
          ))}
        </dl>
        {a ? null : (
          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                onClose();
                onEdit(r.id);
              }}
            >
              Edit record
            </button>
          </div>
        )}
      </div>
    </AppDialog>
  );
}
