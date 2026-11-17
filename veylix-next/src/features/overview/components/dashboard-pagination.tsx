// @ts-nocheck
import { useLayoutEffect, useRef } from "react";
import { Icon } from "@/components/icons/icon";

export function paginateDashboardRows(e, t = 1, n = 4) {
  const r = Number.isFinite(Number(n))
    ? Math.max(1, Math.floor(Number(n) || 4))
    : 4;
  const i = Math.max(1, Math.ceil(e.length / r));
  const a = Math.max(
    1,
    Math.min(i, Number.isFinite(Number(t)) ? Math.floor(Number(t) || 1) : 1),
  );
  const o = (a - 1) * r;
  return {
    rows: e.slice(o, o + r),
    current: a,
    pages: i,
    from: e.length ? o + 1 : 0,
    to: Math.min(o + r, e.length),
    total: e.length,
  };
}

export function DashboardPagination({
  kind,
  current,
  pages,
  from,
  to,
  total,
  focusCurrent,
  onPageChange,
}) {
  const c = useRef(null);
  useLayoutEffect(() => {
    if (focusCurrent) {
      c.current?.querySelector('[aria-current="page"]')?.focus({
        preventScroll: true,
      });
    }
  }, [current, focusCurrent]);
  return (
    <nav
      ref={c}
      className="dashboard-pagination"
      aria-label={`${kind === "sales" ? "Recent sales" : "Recent deliveries"} pagination`}
    >
      <span aria-live="polite">
        {from}–{to} <span>of</span> {total}
      </span>
      <div>
        <button
          type="button"
          data-page-kind={kind}
          data-page={current - 1}
          disabled={current === 1}
          aria-label="Previous page"
          onClick={() => onPageChange(current - 1, true)}
        >
          <Icon name="caret-right" />
        </button>
        {Array.from(
          {
            length: pages,
          },
          (n, r) => {
            const i = r + 1;
            return (
              <button
                key={i}
                type="button"
                data-page-kind={kind}
                data-page={i}
                aria-current={i === current ? "page" : void 0}
                aria-label={`Page ${i}`}
                onClick={() => onPageChange(i, true)}
              >
                {i}
              </button>
            );
          },
        )}
        <button
          type="button"
          data-page-kind={kind}
          data-page={current + 1}
          disabled={current === pages}
          aria-label="Next page"
          onClick={() => onPageChange(current + 1, true)}
        >
          <Icon name="caret-right" />
        </button>
      </div>
    </nav>
  );
}
