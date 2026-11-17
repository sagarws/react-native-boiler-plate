"use client";

import { format } from "date-fns";
import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { BulkSelectionBar, DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { StatusPill } from "@/components/ui/status-pill";
import { useDismiss } from "@/components/ui/use-dismiss";
import { PAYMENT_MODE_LABEL, paymentStatusLabel } from "@/features/accounts/lib/accounts-helpers";
import { downloadBlob, downloadText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { ManualPaymentService } from "@/services/manualPayment-service";
import type { IPurchaseHistoryItem, PaymentStatus } from "@/types/accounts";

const STATUS_TONE: Record<PaymentStatus, "green" | "amber" | "red"> = { approved: "green", pending: "amber", revoked: "red", failed: "red" };

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** TrackVid `PurchaseHistory`: plan purchases, export menu and invoice download. */
export function PurchaseHistory() {
  const [range, setRange] = useState<DateRange>(() => ({ startDate: new Date(2024, 9, 25), endDate: new Date() }));
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuOpen, menuRef, closeMenu);

  const startDate = ymd(range.startDate);
  const endDate = ymd(range.endDate);
  const { data, loading, error, reload } = useAsync(
    () => ManualPaymentService.getPaymentHistory({ page, limit, startDate, endDate }),
    [page, limit, startDate, endDate],
  );
  const rows = data?.order ?? [];
  const total = data?.metadata.total ?? 0;

  const exportRows = async (kind: "selected" | "page" | "all") => {
    setMenuOpen(false);
    setExporting(true);
    try {
      const blob = await ManualPaymentService.downloadPurchaseHistory({
        selectedOrders: kind === "selected" ? [...selected] : [],
        page: kind === "page" ? page : 1,
        limit,
        exportLimit: kind === "all" ? "all" : limit,
        startDate,
        endDate,
      });
      downloadBlob(blob, `report-${format(new Date(), "dd-MM-yyyy")}.csv`);
    } catch (err) {
      toast.error(errorMessage(err, "Error downloading the file."));
    } finally {
      setExporting(false);
    }
  };

  const downloadInvoice = async (id: string) => {
    setInvoiceId(id);
    try {
      const inv = await ManualPaymentService.getInvoice(id);
      downloadText(inv.html, inv.fileName, "text/html");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to generate the invoice."));
    } finally {
      setInvoiceId(null);
    }
  };

  const columns: DataColumn<IPurchaseHistoryItem>[] = [
    { key: "plan", header: "Plan", minWidth: 130, render: (r) => r.plan.name || "—" },
    { key: "amount", header: "Amount", minWidth: 110, render: (r) => <strong>₹{formatNumber(Number(r.plan.price.toFixed(2)))}</strong> },
    { key: "payment_date", header: "Purchase Date", minWidth: 170, render: (r) => formatDateTime(r.payment_date) },
    {
      key: "credit",
      header: "Credit",
      minWidth: 100,
      render: (r) =>
        r.payment_status === "revoked" ? <span className="tv-acc-negative">-{formatNumber(r.plan.credit ?? 0)}</span> : formatNumber(r.plan.credit ?? 0),
    },
    { key: "bonus", header: "Bonus", minWidth: 90, render: (r) => formatNumber(r.plan.bonus ?? 0) },
    { key: "mode", header: "Mode", minWidth: 110, render: (r) => PAYMENT_MODE_LABEL[r.payment_mode] },
    { key: "status", header: "Status", minWidth: 110, render: (r) => <StatusPill value={paymentStatusLabel(r.payment_status)} tone={STATUS_TONE[r.payment_status]} /> },
    {
      key: "invoice",
      header: "Invoice",
      minWidth: 140,
      render: (r) =>
        r.payment_status === "approved" ? (
          <button type="button" className="secondary-button compact-button" onClick={() => void downloadInvoice(r._id)} disabled={invoiceId === r._id}>
            {invoiceId === r._id ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="download" />}
            Download
          </button>
        ) : (
          <span className="tv-muted">—</span>
        ),
    },
  ];

  return (
    <section className="glass-card tv-table-card">
      <div className="c-toolbar tv-acc-toolbar">
        <div className="tv-acc-toolbar-end">
          <DateRangePicker
            value={range}
            onChange={(r) => {
              if (!r) return;
              setRange(r);
              setPage(1);
              setSelected(new Set());
            }}
          />
          <div className="tv-popover-wrap" ref={menuRef}>
            <button type="button" className="primary-button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)} disabled={exporting}>
              {exporting ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="upload" />}
              Export
            </button>
            {menuOpen ? (
              <div className="tv-popover" role="menu" aria-label="Export purchase history">
                <div className="tv-menu-list">
                  <button type="button" role="menuitem" disabled={!selected.size} onClick={() => void exportRows("selected")}>
                    Selected{selected.size ? ` (${selected.size})` : ""}
                  </button>
                  <button type="button" role="menuitem" onClick={() => void exportRows("page")}>
                    Page Orders
                  </button>
                  <button type="button" role="menuitem" onClick={() => void exportRows("all")}>
                    All {formatNumber(total)} Orders
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <button type="button" className="secondary-button compact-button" onClick={() => void exportRows("selected")}>
          <Icon name="download" /> Export selected
        </button>
      </BulkSelectionBar>
      <DataTable
        label="Purchase history"
        columns={columns}
        rows={rows}
        getRowId={(r) => r._id}
        loading={loading}
        error={error}
        onRetry={reload}
        selected={selected}
        onSelectedChange={setSelected}
        pagination="server"
        page={page}
        pageSize={limit}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setLimit(s);
          setPage(1);
        }}
        emptyTitle="No purchases in this period"
        emptyMessage="Buy a credit plan from the Plans tab, or pick a wider date range."
        storageKey="accounts-purchase-history"
      />
    </section>
  );
}
