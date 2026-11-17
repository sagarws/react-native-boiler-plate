"use client";

import { Fragment, useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { SearchInput } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { TablePagination } from "@/components/ui/table-pagination";
import { formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { PendingFailedOrdersService } from "@/services/pendingFailedOrders-service";
import type { PendingFailedFeed, PendingFailedOrder } from "@/types/pending-failed-orders";

const ROWS_PER_PAGE_OPTIONS = [25, 50, 100] as const;

type OrderStatus = "pending" | "failed";

type FeedOrderRow = {
  key: string;
  awbNumber: string;
  orderType: string;
  platform: string;
  status: OrderStatus;
};

type FeedRow = {
  feedId: string;
  feedName: string;
  orders: FeedOrderRow[];
  pendingCount: number;
  failedCount: number;
  /** True when the search hit an AWB rather than the feed name — those open by default. */
  matchedByAwb: boolean;
};

/** One list per feed: failed first, then pending, with a status column (TrackVid `toOrderRows`). */
function toOrderRows(feed: PendingFailedFeed): FeedOrderRow[] {
  const build = (orders: PendingFailedOrder[] | undefined, status: OrderStatus) =>
    (orders ?? []).map((order, index) => ({
      key: `${feed.feedId}-${status}-${order._id || order.AWBNumber}-${index}`,
      awbNumber: order.AWBNumber ? String(order.AWBNumber) : "",
      orderType: order.orderType ? String(order.orderType) : "",
      // null means "no matching order row" or a capped lookup, not "blank platform".
      platform: order.eCommercePlatform ? String(order.eCommercePlatform) : "",
      status,
    }));
  return [...build(feed.failed_orders, "failed"), ...build(feed.pending_orders, "pending")];
}

/** Feed-name hit keeps every AWB; otherwise only matching AWBs survive. All-zero feeds are hidden. */
function filterFeeds(feeds: PendingFailedFeed[], term: string): FeedRow[] {
  return feeds
    .map((feed) => {
      const orders = toOrderRows(feed);
      const nameMatches = (feed.feedName || "").toLowerCase().includes(term);
      const visible = !term || nameMatches ? orders : orders.filter((o) => o.awbNumber.toLowerCase().includes(term));
      return {
        feedId: String(feed.feedId),
        feedName: feed.feedName || "",
        orders: visible,
        pendingCount: visible.filter((o) => o.status === "pending").length,
        failedCount: visible.filter((o) => o.status === "failed").length,
        matchedByAwb: Boolean(term) && !nameMatches,
      };
    })
    .filter((row) => row.pendingCount + row.failedCount > 0)
    .sort((a, b) => b.pendingCount + b.failedCount - (a.pendingCount + a.failedCount) || a.feedName.localeCompare(b.feedName));
}

function CountCell({ value, danger = false }: { value: number; danger?: boolean }) {
  return <td className={`tv-pfo-count ${value > 0 ? (danger ? "is-danger" : "is-set") : "is-zero"}`}>{formatNumber(value)}</td>;
}

/** TrackVid `PendingFailedOrders`: feeds with stuck orders, expandable to their AWB numbers. */
export function PendingFailedOrdersPage() {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<number>(ROWS_PER_PAGE_OPTIONS[0]);
  // Explicit user toggles only; a feed without an entry is open when the search hit one of its AWBs.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // The endpoint is company-scoped, so one call returns every feed; search and paging run here.
  const { data, loading, error, reload } = useAsync(() => PendingFailedOrdersService.getPendingAndFailedOrders({ page: 1, limit: 1, search: "" }), []);

  // Debounced search (400 ms, like TrackVid's lodash debounce).
  useEffect(() => {
    const next = search.trim().toLowerCase();
    const id = window.setTimeout(() => {
      setTerm(next);
      setPage(1);
      setExpanded({});
    }, 400);
    return () => window.clearTimeout(id);
  }, [search]);

  const feeds = (data?.CompanyWiseData ?? []).flatMap((c) => c.feeds ?? []);
  const filtered = filterFeeds(feeds, term);
  const pendingTotal = filtered.reduce((s, f) => s + f.pendingCount, 0);
  const failedTotal = filtered.reduce((s, f) => s + f.failedCount, 0);
  const visible = filtered.slice((page - 1) * limit, page * limit);

  const isOpen = (feed: FeedRow) => expanded[feed.feedId] ?? feed.matchedByAwb;
  const toggle = (feed: FeedRow) => setExpanded((prev) => ({ ...prev, [feed.feedId]: !(prev[feed.feedId] ?? feed.matchedByAwb) }));

  let body;
  if (loading) {
    body = Array.from({ length: 6 }, (_, i) => (
      <tr key={`sk-${i}`} className="tv-table-loading">
        <td>
          <Skeleton width={`${50 + ((i * 13) % 35)}%`} />
        </td>
        <td>
          <Skeleton width="40%" style={{ marginLeft: "auto" }} />
        </td>
        <td>
          <Skeleton width="40%" style={{ marginLeft: "auto" }} />
        </td>
      </tr>
    ));
  } else if (error) {
    body = (
      <tr>
        <td colSpan={3}>
          <ErrorState title="Failed to load pending & failed orders" message={error} onRetry={reload} />
        </td>
      </tr>
    );
  } else if (filtered.length === 0) {
    body = (
      <tr>
        <td colSpan={3}>
          <EmptyState
            icon={term ? "search" : "check-circle"}
            title={term ? "No matches" : "All caught up"}
            message={term ? "No feeds or AWB numbers match your search." : "No feeds with pending or failed orders."}
          />
        </td>
      </tr>
    );
  } else {
    body = visible.map((feed) => {
      const open = isOpen(feed);
      return (
        <Fragment key={feed.feedId}>
          <tr className={`is-clickable tv-pfo-feed ${open ? "is-open" : ""}`.trim()} onClick={() => toggle(feed)}>
            <td>
              <span className="tv-row" style={{ flexWrap: "nowrap", gap: 6 }}>
                <button
                  type="button"
                  className="icon-button compact-button"
                  aria-expanded={open}
                  aria-label={open ? "Collapse AWB numbers" : "Expand AWB numbers"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(feed);
                  }}
                >
                  <Icon name={open ? "caret-down" : "caret-right"} />
                </button>
                <strong>{feed.feedName || "—"}</strong>
              </span>
            </td>
            <CountCell value={feed.pendingCount} />
            <CountCell value={feed.failedCount} danger />
          </tr>
          {open ? (
            <tr className="tv-pfo-detail">
              <td colSpan={3}>
                <div className="tv-pfo-detail-inner">
                  <table className="c-table tv-pfo-subtable">
                    <thead>
                      <tr>
                        <th scope="col" style={{ width: "40%" }}>
                          AWB Number
                        </th>
                        <th scope="col" style={{ width: "20%" }}>
                          Order Type
                        </th>
                        <th scope="col" style={{ width: "20%" }}>
                          Platform
                        </th>
                        <th scope="col" style={{ width: "20%", textAlign: "right" }}>
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {feed.orders.map((order) => (
                        <tr key={order.key}>
                          <td className="tv-mono">{order.awbNumber || "—"}</td>
                          <td className="tv-muted">{order.orderType || "—"}</td>
                          <td>{order.platform ? <PlatformLogo name={order.platform} /> : <span className="tv-muted">—</span>}</td>
                          <td style={{ textAlign: "right" }}>
                            <StatusPill value={order.status === "failed" ? "Failed" : "Pending"} tone={order.status === "failed" ? "red" : "amber"} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
          ) : null}
        </Fragment>
      );
    });
  }

  return (
    <div className="tv-page">
      <PageHeading title="Pending & Failed Orders" subtitle="Feeds with orders still waiting to import or rejected during import. Open a feed to see its AWB numbers." />
      <section className="glass-card tv-table-card">
        <div className="c-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search feed or AWB number..." label="Search feed or AWB number" />
        </div>
        <div className="table-scroll c-table-scroll" tabIndex={0} role="region" aria-label="Pending and failed orders by feed" aria-busy={loading}>
          <table className="c-table tv-pfo-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: "60%", paddingLeft: 52 }}>
                  Feeds
                </th>
                <th scope="col" style={{ width: "20%", textAlign: "right" }}>
                  Pending Orders ({formatNumber(pendingTotal)})
                </th>
                <th scope="col" style={{ width: "20%", textAlign: "right" }}>
                  Failed Orders ({formatNumber(failedTotal)})
                </th>
              </tr>
            </thead>
            <tbody>{body}</tbody>
          </table>
        </div>
        <TablePagination
          total={filtered.length}
          page={page}
          size={limit}
          sizes={ROWS_PER_PAGE_OPTIONS}
          onPageChange={setPage}
          onSizeChange={(size) => {
            setLimit(size);
            setPage(1);
          }}
        />
      </section>
    </div>
  );
}
