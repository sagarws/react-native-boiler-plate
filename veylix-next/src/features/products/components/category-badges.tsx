// @ts-nocheck
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { getCategoryIconName } from "@/features/products/lib/category-metrics";
import { getMediaFile } from "@/lib/media-storage";

export function CategoryMediaTile({ row, compact = false }) {
  const n = String(row.thumbnailImageId || row.coverImageId || "");
  const [r, i] = useState("");
  useEffect(() => {
    let e = true;
    let t = "";
    i("");
    return n
      ? (getMediaFile(n)
          .then((n) => {
            if (
              e &&
              !n?.trashed &&
              n?.blob &&
              /^image\/(png|jpeg|webp|gif)$/.test(String(n.type || ""))
            ) {
              t = URL.createObjectURL(n.blob);
              i(t);
            }
          })
          .catch(() => i("")),
        () => {
          e = false;
          if (t) {
            URL.revokeObjectURL(t);
          }
        })
      : () => void 0;
  }, [n]);
  const a = compact ? "category-mini-media" : "category-icon-tile";
  return r ? (
    <span className={`${a} category-media-has-image`}>
      <span>
        <img src={r} alt={String(row.imageAlt || "")} decoding="async" />
      </span>
    </span>
  ) : (
    <span className={a}>
      <Icon name={getCategoryIconName(String(row.name || ""))} />
    </span>
  );
}

export function CategoryVisibilityBadge({ row }) {
  const t = String(row.status || "") !== "Hidden";
  return (
    <span className={`category-status ${t ? "visible" : "hidden"}`}>
      <i />
      {t ? "Visible" : "Hidden"}
    </span>
  );
}

export function CategoryTrendIndicator({ value }) {
  return (
    <span className={`category-trend ${value < 0 ? "down" : "up"}`}>
      <Icon name={value < 0 ? "arrow-down" : "arrow-up"} />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

export function CategoryShareBar({ value }) {
  return (
    <div className="category-share">
      <span>
        <i
          style={{
            width: `${Math.max(2, Math.min(100, value)).toFixed(1)}%`,
          }}
        />
      </span>
      <small>{value.toFixed(1)}%</small>
    </div>
  );
}
