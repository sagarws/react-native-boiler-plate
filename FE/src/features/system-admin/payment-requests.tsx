"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { FilePreviewDialog } from "@/features/accounts/components/file-preview";
import { PAYMENT_MODE_LABEL, paymentStatusLabel, receiptDataUri } from "@/features/accounts/lib/accounts-helpers";
import { useWalletSync } from "@/features/accounts/lib/use-wallet-sync";
import { downloadText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { ManualPaymentService } from "@/services/manualPayment-service";
import { useSelector } from "@/store";
import type { PaymentRequests, PaymentStatus } from "@/types/accounts";

type Action = "approve" | "revoke";

const STATUS_TONE: Record<PaymentStatus, "green" | "amber" | "red"> = { approved: "green", pending: "amber", revoked: "red", failed: "red" };

function SummaryCard({ icon, label, value, detail, tone }: { icon: IconName; label: string; value: string; detail: string; tone: "" | "blue" | "amber" | "red" }) {
  return (
    <article className={`payment-summary-card ${tone}`.trim()}>
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </article>
  );
}

/** TrackVid `ConfirmationDialog` ("Update Payment Status"). */
function StatusDialog({ payment, action, busy, onConfirm, onClose }: { payment: PaymentRequests; action: Action; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <AppDialog
      title="Update Payment Status"
      size="sm"
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={action === "revoke" ? "danger-button" : "primary-button"} onClick={onConfirm} disabled={busy}>
            {busy ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name={action === "revoke" ? "x-circle" : "check-circle"} />}
            {action === "revoke" ? "Revoke" : "Approve"}
          </button>
        </>
      }
    >
      <div className="tv-stack">
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          You are about to <strong>{action}</strong> the payment request of <strong>{payment.user_id.email}</strong>. Are you sure you want to proceed?{" "}
          <strong className="tv-acc-negative">This action can not be undone</strong>.
        </p>
        <dl className="tv-kv tv-acc-kv">
          <dt>Plan</dt>
          <dd>
            {payment.plan_id.name} · {formatNumber((payment.plan_id.credit ?? 0) + (payment.plan_id.bonus ?? 0))} credits
          </dd>
          <dt>Amount</dt>
          <dd>{payment.plan_id.price.toFixed(2)} INR</dd>
          <dt>Reference ID</dt>
          <dd className="tv-mono">{payment.reference_id}</dd>
        </dl>
      </div>
    </AppDialog>
  );
}

/** TrackVid `PaymentRequests`: manual payment requests with approve / revoke, proof and invoice. */
export function PaymentRequestsTable() {
  const currentUserId = useSelector((s) => s.profile.userProfile?._id);
  const syncWallet = useWalletSync();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [tick, setTick] = useState(0);
  const [pending, setPending] = useState<{ payment: PaymentRequests; action: Action } | null>(null);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<PaymentRequests | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(() => ManualPaymentService.getAllPaymentRequests({ limit, page }), [limit, page, tick]);

  const rows = data?.payments ?? [];
  const meta = data?.metadata;
  const counts = data?.counts;

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await ManualPaymentService.updatePaymentStatus({ paymentId: pending.payment._id, actionType: pending.action });
      toast.success(res.message);
      if (res.creditAdded > 0 && res.payment.user_id._id === currentUserId) {
        await syncWallet({ creditPlan: res.payment.plan_id });
      }
      setPending(null);
      setTick((t) => t + 1);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
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

  const columns: DataColumn<PaymentRequests>[] = [
    { key: "sr_no", header: "Sr. No", width: 70, render: (_r, i) => (meta ? meta.per_page * (meta.current_page - 1) + i + 1 : i + 1) },
    { key: "admin_email", header: "Admin Email", minWidth: 200, render: (r) => r.user_id.email },
    { key: "payment_time", header: "Payment Time", minWidth: 170, render: (r) => formatDateTime(r.payment_date) },
    {
      key: "payment_proof",
      header: "Payment Proof",
      minWidth: 120,
      render: (r) => (
        <button type="button" className="tv-link" onClick={() => setProof(r)}>
          View Proof
        </button>
      ),
    },
    { key: "reference_id", header: "Reference ID", minWidth: 160, render: (r) => <span className="tv-mono">{r.reference_id}</span> },
    { key: "payment_amount", header: "Payment Amount", minWidth: 130, render: (r) => `${r.plan_id.price.toFixed(2)} INR` },
    { key: "payment_status", header: "Payment Status", minWidth: 120, render: (r) => <StatusPill value={paymentStatusLabel(r.payment_status)} tone={STATUS_TONE[r.payment_status]} /> },
    { key: "payment_method", header: "Payment Method", minWidth: 140, render: (r) => `Manual · ${PAYMENT_MODE_LABEL[r.payment_mode]}` },
    {
      key: "action",
      header: "Action",
      minWidth: 200,
      render: (r) => (
        <span className="tv-row" style={{ flexWrap: "nowrap" }}>
          <button type="button" className="danger-button compact-button" disabled={r.payment_status !== "pending"} onClick={() => setPending({ payment: r, action: "revoke" })}>
            Revoke
          </button>
          <button type="button" className="primary-button compact-button" disabled={r.payment_status !== "pending"} onClick={() => setPending({ payment: r, action: "approve" })}>
            Approve
          </button>
        </span>
      ),
    },
    {
      key: "invoice",
      header: "Download Invoice",
      minWidth: 170,
      render: (r) =>
        r.payment_status === "approved" ? (
          <button type="button" className="secondary-button compact-button" onClick={() => void downloadInvoice(r._id)} disabled={invoiceId === r._id}>
            {invoiceId === r._id ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="download" />}
            Download Invoice
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <section className="payment-summary-grid tv-acc-admin-summary" aria-label="Payment requests overview">
        <SummaryCard icon="timer" label="Pending" value={formatNumber(counts?.pending ?? 0)} detail="Waiting for verification" tone="amber" />
        <SummaryCard icon="check-circle" label="Approved" value={formatNumber(counts?.approved ?? 0)} detail="Credits added" tone="" />
        <SummaryCard icon="x-circle" label="Revoked" value={formatNumber(counts?.revoked ?? 0)} detail="Rejected requests" tone="red" />
        <SummaryCard icon="receipt" label="Total requests" value={formatNumber(meta?.total ?? 0)} detail="UPI and bank transfers" tone="blue" />
      </section>
      <DataTable
        label="Payment requests"
        columns={columns}
        rows={rows}
        getRowId={(r) => r._id}
        loading={loading}
        error={error}
        onRetry={reload}
        pagination="server"
        page={page}
        pageSize={limit}
        pageSizes={[10, 25, 50, 100]}
        total={meta?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setLimit(s);
          setPage(1);
        }}
        emptyTitle="No payment requests"
        emptyMessage="Manual UPI and bank transfer payments appear here for approval."
        storageKey="system-admin-payment-requests"
        minTableWidth={1500}
      />
      {pending ? <StatusDialog payment={pending.payment} action={pending.action} busy={busy} onConfirm={() => void confirm()} onClose={() => setPending(null)} /> : null}
      {proof ? (
        <FilePreviewDialog
          title={`Payment proof · ${proof.reference_id}`}
          load={() => ManualPaymentService.getPaymentProof(proof._id)}
          fallbackSrc={receiptDataUri(proof.payment_mode === "bank" ? "Bank transfer receipt" : "UPI payment receipt", [
            `Paid to: WHITESTONE INFOTECH LLP`,
            `Amount: INR ${formatNumber(Number((proof.plan_id.price * 1.18).toFixed(2)))}`,
            `Remarks: ${proof.reference_id}`,
            `Date: ${formatDateTime(proof.payment_date)}`,
            `From: ${proof.billing_profile_id?.billing_name ?? proof.user_email}`,
          ])}
          onClose={() => setProof(null)}
        />
      ) : null}
    </>
  );
}
