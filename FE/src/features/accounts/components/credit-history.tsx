"use client";

import { addDays, format, isValid, parseISO, startOfDay } from "date-fns";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { ToneBadge } from "@/components/ui/card-primitives";
import { MultiCombobox } from "@/components/ui/combobox";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { SearchInput } from "@/components/ui/form-field";
import { ACTION_FINDER } from "@/config/app-constant";
import { CREDIT_HISTORY_ACTION_OPTIONS, actionTone, isCreditDeducted } from "@/features/accounts/lib/accounts-helpers";
import { downloadText, toCsv } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { formatDate, formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { creditHistoryService } from "@/services/creditHistory-service";
import type { HistoryItem, ICreditHistoryPayload } from "@/types/accounts";

const ACTION_OPTIONS = CREDIT_HISTORY_ACTION_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }));

function initialRange(date: string | null): DateRange {
  if (date) {
    const d = parseISO(date);
    if (isValid(d)) return { startDate: startOfDay(d), endDate: startOfDay(d) };
  }
  return { startDate: startOfDay(addDays(new Date(), -6)), endDate: new Date() };
}

const awbOf = (h: HistoryItem): string =>
  h.cmsData?.AWBNumber || (h.orderData ? `${h.orderData.trackingId} (${h.orderData.orderType})` : "—");

function CreditCell({ row }: { row: HistoryItem }) {
  const credit = row.credit ?? 0;
  if (credit === 0) {
    return (
      <span className="tv-acc-credit is-zero">
        <Icon name="minus" />
        {formatNumber(0)}
      </span>
    );
  }
  const deducted = isCreditDeducted(row.actionType);
  return (
    <span className={`tv-acc-credit ${deducted ? "is-down" : "is-up"}`}>
      <Icon name={deducted ? "arrow-down" : "arrow-up"} />
      {deducted ? "-" : "+"}
      {formatNumber(Math.abs(credit))}
    </span>
  );
}

/**
 * TrackVid `CreditHistory`: AWB search (debounced), action type filter, date range, server paging.
 * `initialDate` comes from `?date=` (the usage history day link).
 */
export function CreditHistory({ initialDate }: { initialDate: string | null }) {
  const [range, setRange] = useState<DateRange>(() => initialRange(initialDate));
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [actionTypes, setActionTypes] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 600);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const payload: ICreditHistoryPayload = {
    page,
    limit,
    startDate: format(range.startDate, "yyyy-MM-dd"),
    endDate: format(range.endDate, "yyyy-MM-dd"),
    search,
    actionType: actionTypes.length ? actionTypes.join(",") : undefined,
  };
  const { data, loading, error, reload } = useAsync(
    () => creditHistoryService.getCreditHistory(payload),
    [payload.page, payload.limit, payload.startDate, payload.endDate, payload.search, payload.actionType],
  );

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await creditHistoryService.getCreditHistory({ ...payload, page: 1, limit: 100000 });
      downloadText(
        toCsv([
          ["Date / Time", "Credit", "Action", "AWB Number", "Feed"],
          ...all.history.map((h) => [
            formatDate(h.createdAt, "dd MMM yyyy, hh:mm a"),
            h.credit === 0 ? 0 : isCreditDeducted(h.actionType) ? -h.credit : h.credit,
            ACTION_FINDER[h.actionType] ?? "",
            awbOf(h),
            h.feedData?.feedName ?? "",
          ]),
        ]),
        `credit-history-${payload.startDate}-to-${payload.endDate}.csv`,
        "text/csv",
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const columns: DataColumn<HistoryItem>[] = [
    {
      key: "createdAt",
      header: "Date / Time",
      minWidth: 160,
      render: (r) => (
        <span className="tv-acc-two-line">
          <strong>{formatDate(r.createdAt, "dd MMM yyyy")}</strong>
          <small>{formatDate(r.createdAt, "hh:mm a")}</small>
        </span>
      ),
    },
    { key: "credit", header: "Credit", minWidth: 120, render: (r) => <CreditCell row={r} /> },
    { key: "action", header: "Action", minWidth: 160, render: (r) => <ToneBadge label={ACTION_FINDER[r.actionType] ?? "—"} tone={actionTone(r.actionType)} /> },
    {
      key: "awb",
      header: "AWB Number",
      minWidth: 180,
      render: (r) => {
        const v = awbOf(r);
        return v === "—" ? <span className="tv-muted">—</span> : <span className="tv-mono">{v}</span>;
      },
    },
    { key: "feed", header: "Feed", minWidth: 130, render: (r) => r.feedData?.feedName ?? <span className="tv-muted">—</span> },
  ];

  return (
    <section className="glass-card tv-table-card">
      <div className="c-toolbar tv-acc-toolbar">
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search by AWB number" label="Search by AWB number" />
        <div className="tv-acc-toolbar-end">
          <div className="tv-acc-action-filter">
            <MultiCombobox
              label="Action Type"
              options={ACTION_OPTIONS}
              values={actionTypes}
              placeholder="All actions"
              onChange={(v) => {
                setActionTypes(v);
                setPage(1);
              }}
            />
          </div>
          <DateRangePicker
            value={range}
            onChange={(r) => {
              if (!r) return;
              setRange(r);
              setPage(1);
            }}
          />
          <button type="button" className="secondary-button" onClick={() => void exportCsv()} disabled={exporting || !data?.metadata.total}>
            {exporting ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="download" />}
            Export
          </button>
        </div>
      </div>
      <DataTable
        label="Credit history"
        columns={columns}
        rows={data?.history ?? []}
        getRowId={(r) => r._id}
        loading={loading}
        error={error}
        onRetry={reload}
        pagination="server"
        page={page}
        pageSize={limit}
        total={data?.metadata.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setLimit(s);
          setPage(1);
        }}
        emptyTitle="No credit activity"
        emptyMessage="Nothing matches these filters. Try a wider date range or clear the search."
        storageKey="accounts-credit-history"
      />
    </section>
  );
}
