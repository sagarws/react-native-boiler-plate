"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "@/components/icons/icon";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FileDrop } from "@/components/ui/file-drop";
import { SelectField, TextField } from "@/components/ui/form-field";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { FilePreviewDialog } from "@/features/accounts/components/file-preview";
import { QUARTER_LABEL, quarterOptions, receiptDataUri } from "@/features/accounts/lib/accounts-helpers";
import { errorMessage, toast } from "@/lib/events";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { useAsync } from "@/lib/use-async";
import { TDS_Reimbursement } from "@/services/tds-reimbursement-service";
import { useSelector } from "@/store";
import type { ITds, TdsStatus } from "@/types/accounts";

type SubTab = "NEW" | TdsStatus;

interface FormValues {
  companyName: string;
  tanNumber: string;
  panNumber: string;
  tdsAmount: string;
  tdsDuration: string;
  BankAccountNumber: string;
  NameOfBankAccount: string;
  IFSCcode: string;
}
type FormErrors = Partial<Record<keyof FormValues | "file", string>>;

const EMPTY: FormValues = {
  companyName: "",
  tanNumber: "",
  panNumber: "",
  tdsAmount: "",
  tdsDuration: "",
  BankAccountNumber: "",
  NameOfBankAccount: "",
  IFSCcode: "",
};

/** TrackVid TDS yup schema, plus a required certificate. */
function validate(v: FormValues, file: File | null): FormErrors {
  const e: FormErrors = {};
  if (!v.companyName.trim()) e.companyName = "Company Name is required";
  if (!v.tanNumber.trim()) e.tanNumber = "TAN Number is required";
  if (!v.panNumber.trim()) e.panNumber = "PAN Number is required";
  else if (v.panNumber.trim().length !== 10) e.panNumber = "PAN Number must be exactly 10 characters";
  const amount = Number(v.tdsAmount);
  if (!v.tdsAmount.trim()) e.tdsAmount = "TDS Amount is required";
  else if (!Number.isFinite(amount)) e.tdsAmount = "TDS Amount must be a number";
  else if (amount <= 0) e.tdsAmount = "Must be a positive number";
  if (!v.tdsDuration) e.tdsDuration = "TDS Duration is required";
  if (!v.BankAccountNumber.trim()) e.BankAccountNumber = "Bank Account Number is required";
  if (!v.NameOfBankAccount.trim()) e.NameOfBankAccount = "Name of Bank Account is required";
  if (!v.IFSCcode.trim()) e.IFSCcode = "IFSC Code is required";
  if (!file) e.file = "TDS certificate is required";
  return e;
}

function SectionLabel({ children }: { children: string }) {
  return <h4 className="tv-acc-section-label">{children}</h4>;
}

function NewRequestForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [touched, setTouched] = useState<Partial<Record<keyof FormValues, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validate(values, file);
  const quarters = quarterOptions();

  const field = (k: keyof FormValues) => ({
    name: k,
    value: values[k],
    onChange: (e: { currentTarget: { value: string } }) => {
      const value = e.currentTarget.value;
      setValues((v) => ({ ...v, [k]: value }));
    },
    onBlur: () => setTouched((t) => ({ ...t, [k]: true })),
    error: ((submitted || touched[k]) && errors[k]) || undefined,
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length || !file) return;
    setSaving(true);
    try {
      const res = await TDS_Reimbursement.createTds({
        file,
        companyName: values.companyName,
        duration: values.tdsDuration,
        tanNumber: values.tanNumber,
        panNumber: values.panNumber,
        accountNumber: values.BankAccountNumber,
        ifsc: values.IFSCcode,
        accountHolderName: values.NameOfBankAccount,
        tdsAmount: parseFloat(values.tdsAmount),
      });
      toast.success(res.message);
      setValues(EMPTY);
      setFile(null);
      setTouched({});
      setSubmitted(false);
      onSubmitted();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="tv-stack tv-acc-tds-form" onSubmit={(e) => void submit(e)} noValidate>
      <div className="tv-acc-section-heading">
        <h3>New TDS Reimbursement Request</h3>
        <p>Enter your company and bank details, attach your TDS certificate, and submit your reimbursement request.</p>
      </div>

      <SectionLabel>Company Details</SectionLabel>
      <div className="tv-acc-form-3">
        <TextField label="Company Name" placeholder="Acme Pvt. Ltd." required {...field("companyName")} />
        <TextField label="TAN Number" placeholder="ABCD12345E" required {...field("tanNumber")} />
        <TextField label="PAN Number" placeholder="ABCDE1234F" maxLength={10} required {...field("panNumber")} />
      </div>

      <SectionLabel>TDS Information</SectionLabel>
      <div className="tv-acc-form-3">
        <TextField label="TDS Amount" placeholder="0.00" inputMode="decimal" required {...field("tdsAmount")} />
        <SelectField label="TDS Duration" placeholder="Select quarter" options={quarters} required {...field("tdsDuration")} />
      </div>

      <SectionLabel>Bank Details</SectionLabel>
      <div className="tv-acc-form-3">
        <TextField label="Bank Account Number" inputMode="numeric" required {...field("BankAccountNumber")} />
        <TextField label="Account Holder Name" required {...field("NameOfBankAccount")} />
        <TextField label="IFSC Code" placeholder="ABCD0123456" required {...field("IFSCcode")} />
      </div>

      <SectionLabel>TDS Certificate</SectionLabel>
      {file ? (
        <div className="tv-acc-proof is-wide">
          <span className="tv-acc-method-icon">
            <Icon name="paperclip" />
          </span>
          <div className="tv-acc-proof-meta">
            <strong>{file.name}</strong>
            <small>{formatBytes(file.size)} · Upload an image or PDF of your TDS certificate</small>
          </div>
          <label className="secondary-button compact-button">
            Replace
            <input
              type="file"
              className="sr-only"
              accept="application/pdf,image/*"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) setFile(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <button type="button" className="danger-button compact-button" onClick={() => setFile(null)}>
            <Icon name="x" /> Remove
          </button>
        </div>
      ) : (
        <FileDrop accept="application/pdf,image/*" title="No file selected — drop your TDS certificate or click to add" hint="Upload an image or PDF of your TDS certificate" onFiles={(f) => setFile(f[0] ?? null)} />
      )}
      {submitted && errors.file ? (
        <span className="tv-field-error" role="alert">
          {errors.file}
        </span>
      ) : null}

      <div className="tv-acc-form-actions">
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="floppy-disk" />}
          {saving ? "Submitting…" : "Submit Reimbursement Request"}
        </button>
      </div>
    </form>
  );
}

function TdsList({ status }: { status: TdsStatus }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [preview, setPreview] = useState<{ row: ITds; kind: "certificate" | "attachment" } | null>(null);
  const { data, loading, error, reload } = useAsync(() => TDS_Reimbursement.GetTdsDetails({ page, limit, status }), [page, limit, status]);
  const closed = status === "2";

  const mono = (v: string) => (v ? <span className="tv-mono">{v}</span> : <span className="tv-muted">—</span>);
  const columns: DataColumn<ITds>[] = [
    { key: "companyName", header: "Company Name", minWidth: 170, render: (r) => <strong>{r.companyName || "—"}</strong> },
    { key: "tanNumber", header: "TAN Number", minWidth: 130, render: (r) => mono(r.tanNumber) },
    { key: "panNumber", header: "PAN Number", minWidth: 130, render: (r) => mono(r.panNumber) },
    { key: "tdsAmount", header: "TDS Amount", minWidth: 120, render: (r) => <strong>{r.tdsAmount ? `₹${formatNumber(r.tdsAmount)}` : "—"}</strong> },
    { key: "createdAt", header: "Created At", minWidth: 170, hidden: closed, render: (r) => formatDateTime(r.createdAt) },
    { key: "closedAt", header: "Closed At", minWidth: 170, hidden: !closed, render: (r) => formatDateTime(r.closedAt) },
    {
      key: "duration",
      header: "Duration",
      minWidth: 170,
      render: (r) => <span className="badge badge-info">{r.duration ? `${QUARTER_LABEL[r.duration.quarter]} ${r.duration.year}` : "—"}</span>,
    },
    { key: "accountNumber", header: "Bank A/C Number", minWidth: 160, render: (r) => mono(r.accountNumber) },
    { key: "accountHolderName", header: "Account Holder", minWidth: 160, render: (r) => r.accountHolderName || "—" },
    { key: "ifsc", header: "IFSC Code", minWidth: 130, render: (r) => mono(r.ifsc) },
    {
      key: "certificate",
      header: "Certificate",
      minWidth: 120,
      render: (r) => (
        <button type="button" className="secondary-button compact-button" onClick={() => setPreview({ row: r, kind: "certificate" })}>
          <Icon name="file-text" /> View
        </button>
      ),
    },
    {
      key: "tdsRefundedAmount",
      header: "Refunded Amount",
      minWidth: 150,
      hidden: !closed,
      render: (r) => (r.tdsRefundedAmount ? <strong className="tv-acc-positive">₹{formatNumber(r.tdsRefundedAmount)}</strong> : <span className="tv-muted">—</span>),
    },
    {
      key: "attachment",
      header: "Attachment",
      minWidth: 120,
      hidden: !closed,
      render: (r) =>
        r.attachment ? (
          <button type="button" className="secondary-button compact-button" title={r.attachment} onClick={() => setPreview({ row: r, kind: "attachment" })}>
            <Icon name="paperclip" /> View
          </button>
        ) : (
          <span className="tv-muted">—</span>
        ),
    },
  ];

  return (
    <>
      <DataTable
        label={closed ? "Closed TDS requests" : "TDS requests in process"}
        columns={columns}
        rows={data?.tds ?? []}
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
        emptyTitle={closed ? "No closed requests" : "No requests in process"}
        emptyMessage={closed ? "Refunded requests appear here." : "Submit a new request from the New Request tab."}
        storageKey={`accounts-tds-${status}`}
        minTableWidth={1400}
      />
      {preview ? (
        <FilePreviewDialog
          title={preview.kind === "certificate" ? "TDS certificate" : "Refund attachment"}
          load={() => TDS_Reimbursement.getTdsFile(preview.row._id, preview.kind)}
          fallbackSrc={
            preview.kind === "certificate"
              ? receiptDataUri("TDS certificate (Form 16A)", [
                  `Deductor: ${preview.row.companyName}`,
                  `TAN: ${preview.row.tanNumber}   PAN: ${preview.row.panNumber}`,
                  `${QUARTER_LABEL[preview.row.duration.quarter]} ${preview.row.duration.year}`,
                  `TDS amount: INR ${formatNumber(preview.row.tdsAmount)}`,
                ])
              : receiptDataUri("TDS refund transfer", [
                  `Paid to: ${preview.row.accountHolderName}`,
                  `A/C ${preview.row.accountNumber} · ${preview.row.ifsc}`,
                  `Amount: INR ${formatNumber(preview.row.tdsRefundedAmount ?? 0)}`,
                  `Date: ${formatDateTime(preview.row.closedAt)}`,
                ])
          }
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}

/** TrackVid `TdsReimbursement`: New Request form, In Process and Closed lists. */
export function TdsReimbursement() {
  const user = useSelector((s) => s.profile.userProfile);
  const canEdit = canAccess(user, ["admin"], ["accounts::tds_reimbursement::edit"]);
  const [tab, setTab] = useState<SubTab>(canEdit ? "NEW" : "1");
  const items: TabItem<SubTab>[] = [
    { key: "NEW", label: "New Request", icon: "plus", hidden: !canEdit },
    { key: "1", label: "In Process", icon: "clock" },
    { key: "2", label: "Closed", icon: "check-circle" },
  ];
  const active: SubTab = tab === "NEW" && !canEdit ? "1" : tab;

  return (
    <section className="glass-card tv-table-card tv-stack">
      <Tabs items={items} value={active} onChange={setTab} label="TDS reimbursement tabs" />
      {active === "NEW" ? <NewRequestForm onSubmitted={() => setTab("1")} /> : <TdsList key={active} status={active} />}
    </section>
  );
}
