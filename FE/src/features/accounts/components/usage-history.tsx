"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CardHeading } from "@/components/ui/card-primitives";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { downloadText, toCsv } from "@/lib/download";
import { formatDate, formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { OrderService } from "@/services/order-service";
import type { DailyData, MonthlyData, OrderUsage } from "@/types/accounts";

type Level = "year" | "month" | "day";

interface UsageRow {
  id: string;
  level: Level;
  label: string;
  date: string;
  cms: number;
  cmsCredits: number;
  ndrDdr: number;
  reOpen: number;
  forward: number;
  forwardCredits: number;
  ret: number;
  retCredits: number;
  totalCredits: number;
  totalOrders: number;
  effectiveAmount: number;
}

function toRow(id: string, level: Level, label: string, date: string, d: OrderUsage | MonthlyData | DailyData): UsageRow {
  return {
    id,
    level,
    label,
    date,
    cms: d.cms_orders,
    cmsCredits: d.cms_orders_credits,
    ndrDdr: d.ndr_ddr_claims ?? 0,
    reOpen: d.reopen_claims ?? 0,
    forward: d.forward_orders,
    forwardCredits: d.forward_orders_credits,
    ret: d.return_orders,
    retCredits: d.return_orders_credits,
    totalCredits: d.total_orders_credits,
    totalOrders: d.total_orders,
    effectiveAmount: d.total_effective_amount,
  };
}

function StackedHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <span className="tv-acc-stacked-head">
      {title}
      <small>{subtitle}</small>
    </span>
  );
}

/** TrackVid `UsageHistory`: expandable year → month → day usage with a jump to credit history. */
export function UsageHistory() {
  const router = useRouter();
  const { data, loading, error, reload } = useAsync(() => OrderService.getOrderUsageHistory(), []);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(() => new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set());

  const toggle = (set: Set<string>, id: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const rows: UsageRow[] = (data ?? []).flatMap((y) => {
    const yearId = String(y.year);
    const yearRow = toRow(yearId, "year", `Year ${y.year}`, "", y);
    if (!expandedYears.has(yearId)) return [yearRow];
    return [
      yearRow,
      ...y.monthly.flatMap((m) => {
        const monthId = `${y.year}-${m.month}`;
        const monthRow = toRow(monthId, "month", m.monthName, "", m);
        if (!expandedMonths.has(monthId)) return [monthRow];
        return [monthRow, ...m.daily.map((d) => toRow(`${monthId}-${d.date}`, "day", formatDate(d.date, "dd MMM"), d.date, d))];
      }),
    ];
  });

  const openDay = (date: string) => router.push(`/account-summary?tab=credit_history&date=${date}`);

  const exportCsv = () => {
    if (!data) return;
    const all = data.flatMap((y) => y.monthly.flatMap((m) => m.daily));
    downloadText(
      toCsv([
        ["Date", "CMS Qty", "CMS Credits", "NDR/DDR Qty", "Re-Open Qty", "Forward Qty", "Forward Credits", "Return Qty", "Return Credits", "Total Credits", "Total Orders", "Effective Amount (INR)"],
        ...all.map((d) => [
          d.date,
          d.cms_orders,
          d.cms_orders_credits,
          d.ndr_ddr_claims ?? 0,
          d.reopen_claims ?? 0,
          d.forward_orders,
          d.forward_orders_credits,
          d.return_orders,
          d.return_orders_credits,
          d.total_orders_credits,
          d.total_orders,
          d.total_effective_amount.toFixed(2),
        ]),
      ]),
      `usage-history-${formatDate(new Date(), "dd-MM-yyyy")}.csv`,
      "text/csv",
    );
  };

  const qty = (a: number, b: number) => `${formatNumber(a)} / ${formatNumber(b)}`;

  const columns: DataColumn<UsageRow>[] = [
    {
      key: "toggle",
      header: "#",
      label: "Expand",
      width: 56,
      align: "center",
      render: (r) => {
        if (r.level === "day") return null;
        const isYear = r.level === "year";
        const open = isYear ? expandedYears.has(r.id) : expandedMonths.has(r.id);
        return (
          <button
            type="button"
            className="icon-button compact-button tv-acc-tree-toggle"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${r.label}`}
            onClick={() => (isYear ? toggle(expandedYears, r.id, setExpandedYears) : toggle(expandedMonths, r.id, setExpandedMonths))}
          >
            <Icon name={open ? "minus" : "plus"} />
          </button>
        );
      },
    },
    {
      key: "date",
      header: "Date",
      minWidth: 170,
      render: (r) => (
        <span className={`tv-acc-tree-label is-${r.level}`}>
          {r.label}
          {r.level === "day" ? (
            <button type="button" className="icon-button compact-button" aria-label={`Open credit history for ${r.label}`} title="Open credit history" onClick={() => openDay(r.date)}>
              <Icon name="external-link" />
            </button>
          ) : null}
        </span>
      ),
    },
    { key: "cms", header: <StackedHeader title="CMS" subtitle="(Qty / Credits)" />, label: "CMS", minWidth: 120, render: (r) => qty(r.cms, r.cmsCredits) },
    { key: "ndrDdr", header: <StackedHeader title="NDR/DDR" subtitle="(Qty)" />, label: "NDR/DDR", minWidth: 100, render: (r) => formatNumber(r.ndrDdr) },
    { key: "reOpen", header: <StackedHeader title="Re-Open" subtitle="(Qty)" />, label: "Re-Open", minWidth: 100, render: (r) => formatNumber(r.reOpen) },
    { key: "forward", header: <StackedHeader title="Forward" subtitle="(Qty / Credits)" />, label: "Forward", minWidth: 130, render: (r) => qty(r.forward, r.forwardCredits) },
    { key: "return", header: <StackedHeader title="Return" subtitle="(Qty / Credits)" />, label: "Return", minWidth: 120, render: (r) => qty(r.ret, r.retCredits) },
    { key: "totalCredits", header: "Total Credits", minWidth: 110, render: (r) => formatNumber(r.totalCredits) },
    { key: "totalOrders", header: "Total Orders", minWidth: 110, render: (r) => formatNumber(r.totalOrders) },
    {
      key: "effectiveAmount",
      header: "Effective Amount",
      minWidth: 140,
      align: "right",
      render: (r) => <span className={r.level === "year" ? "tv-strong" : undefined}>₹{formatNumber(Number(r.effectiveAmount.toFixed(2)))}</span>,
    },
  ];

  return (
    <section className="glass-card tv-table-card">
      <CardHeading
        title="Usage history"
        extra={
          <button type="button" className="secondary-button compact-button" onClick={exportCsv} disabled={!data || loading}>
            <Icon name="download" /> Export
          </button>
        }
      />
      <DataTable
        label="Usage history"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={reload}
        pagination="none"
        emptyTitle="No usage yet"
        emptyMessage="Usage appears here once videos and claims are recorded."
        rowClassName={(r) => `tv-acc-level-${r.level}`}
        storageKey="accounts-usage-history"
        minTableWidth={1100}
      />
    </section>
  );
}
