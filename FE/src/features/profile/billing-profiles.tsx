"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { CardHeading } from "@/components/ui/card-primitives";
import { TextField } from "@/components/ui/form-field";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, toast } from "@/lib/events";
import { useAsync } from "@/lib/use-async";
import { UserService, type IBillingProfile, type ICreateBillingProfile } from "@/services/user-service";
import { validateBilling, type BillingErrors } from "@/features/profile/profile-validation";

const EMPTY: ICreateBillingProfile = {
  billing_name: "",
  billing_email: "",
  billing_phone: "",
  gst_number: "",
  address_line_1: "",
  address_line_2: "",
  city: "",
  state: "",
  country: "India",
  pincode: "",
};

const FIELDS: readonly { key: keyof ICreateBillingProfile; label: string; required?: boolean; full?: boolean; type?: string; inputMode?: "numeric" | "email" | "tel" }[] = [
  { key: "billing_name", label: "Company Name", required: true },
  { key: "billing_email", label: "Email", required: true, type: "email", inputMode: "email" },
  { key: "billing_phone", label: "Phone", required: true, type: "tel", inputMode: "tel" },
  { key: "gst_number", label: "GST No." },
  { key: "address_line_1", label: "Address Line 1", required: true, full: true },
  { key: "address_line_2", label: "Address Line 2", full: true },
  { key: "city", label: "City", required: true },
  { key: "state", label: "State", required: true },
  { key: "country", label: "Country", required: true },
  { key: "pincode", label: "Pin Code", required: true, inputMode: "numeric" },
];

/** TrackVid `NewBillingProfile` (PaymentStepsDialog): GST invoice details used at checkout. */
function NewBillingProfileDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (profile: IBillingProfile) => void }) {
  const [values, setValues] = useState<ICreateBillingProfile>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof ICreateBillingProfile, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const errors: BillingErrors = validateBilling(values);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched(Object.fromEntries(FIELDS.map((f) => [f.key, true])));
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])) as ICreateBillingProfile;
      const created = await UserService.createBillingProfile({ ...trimmed, gst_number: trimmed.gst_number.toUpperCase() });
      toast.success("Billing Profile created successfully");
      onSaved(created);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDialog title="New billing profile" size="wide" onClose={onClose} locked={saving}>
      <form className="c-form-grid" onSubmit={submit} noValidate>
        {FIELDS.map((f) => (
          <TextField
            key={f.key}
            label={f.label}
            required={f.required}
            full={f.full}
            type={f.type ?? "text"}
            inputMode={f.inputMode}
            maxLength={f.key === "gst_number" ? 15 : 120}
            value={values[f.key] ?? ""}
            error={touched[f.key] ? errors[f.key] : undefined}
            onChange={(e) => {
              const value = e.currentTarget.value;
              setValues((v) => ({ ...v, [f.key]: value }));
            }}
            onBlur={() => setTouched((t) => ({ ...t, [f.key]: true }))}
          />
        ))}
        <div className="tv-dialog-footer span-full">
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}

/** Billing profiles of the company (picked at checkout in TrackVid's payment dialog). */
export function BillingProfiles({ canEdit }: { canEdit: boolean }) {
  const { data, loading, error, reload, setData } = useAsync(() => UserService.getBillingProfiles(), []);
  const [adding, setAdding] = useState(false);
  const profiles = data ?? [];

  return (
    <section className="glass-card">
      <CardHeading
        title="Billing Profiles"
        extra={
          canEdit ? (
            <button type="button" className="secondary-button compact-button" onClick={() => setAdding(true)}>
              <Icon name="plus" />
              Add billing profile
            </button>
          ) : null
        }
      />
      <p className="tv-muted tv-profile-card-intro">GST invoice details used when you buy credits or storage.</p>
      {loading ? (
        <div className="tv-stack">
          <Skeleton height={72} />
          <Skeleton height={72} />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : profiles.length === 0 ? (
        <EmptyState icon="receipt" title="No billing profiles" message={canEdit ? "Add one now, or when you check out a plan." : "Your admin has not added billing details."} />
      ) : (
        <ul className="tv-profile-billing">
          {profiles.map((b) => (
            <li key={b._id}>
              <div className="tv-row-between">
                <strong>{b.billing_name}</strong>
                {b.gst_number ? <span className="tv-mono tv-small">{b.gst_number}</span> : <span className="tv-muted tv-small">No GST</span>}
              </div>
              <span className="tv-muted tv-small">
                {b.billing_email} · {b.billing_phone}
              </span>
              <span className="tv-small">
                {[b.address_line_1, b.address_line_2, b.city, b.state, b.pincode, b.country].filter(Boolean).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding ? <NewBillingProfileDialog onClose={() => setAdding(false)} onSaved={(p) => setData((prev) => [...(prev ?? []), p])} /> : null}
    </section>
  );
}
