"use client";

import { useState, type FormEvent } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { TextField } from "@/components/ui/form-field";
import { errorMessage, toast } from "@/lib/events";
import { UserService, type IBillingProfile, type ICreateBillingProfile } from "@/services/user-service";

type Values = Required<ICreateBillingProfile>;
type Errors = Partial<Record<keyof Values, string>>;

const EMPTY: Values = {
  billing_name: "",
  billing_email: "",
  billing_phone: "",
  gst_number: "",
  address_line_1: "",
  address_line_2: "",
  city: "",
  state: "",
  country: "",
  pincode: "",
};

const GST_RE = /^([0][1-9]|[1-2][0-9]|[3][0-7])([a-zA-Z]{5}[0-9]{4}[a-zA-Z]{1}[1-9a-zA-Z]{1}[zZ]{1}[0-9a-zA-Z]{1})+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Same rules as TrackVid's `NewBillingProfile` yup schema. */
function validate(v: Values): Errors {
  const e: Errors = {};
  if (!v.billing_name.trim()) e.billing_name = "Company Name is required";
  if (!v.billing_email.trim()) e.billing_email = "Email is required";
  else if (!EMAIL_RE.test(v.billing_email.trim())) e.billing_email = "Invalid email address";
  if (!v.billing_phone.trim()) e.billing_phone = "Phone is required";
  const gst = v.gst_number.trim();
  if (gst) {
    if (gst.length !== 15) e.gst_number = "GST number must be at least 15 characters";
    else if (!GST_RE.test(gst)) e.gst_number = "Invalid GST number.";
  }
  if (!v.address_line_1.trim()) e.address_line_1 = "Address Line 1 is required";
  if (!v.city.trim()) e.city = "City is required";
  if (!v.state.trim()) e.state = "State is required";
  if (!v.country.trim()) e.country = "Country is required";
  if (!v.pincode.trim()) e.pincode = "Pin Code is required";
  return e;
}

/** TrackVid `NewBillingProfile` dialog ("Create new billing profile"). */
export function BillingProfileDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (profile: IBillingProfile) => void }) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof Values, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validate(values);
  const show = (k: keyof Values) => ((submitted || touched[k]) && errors[k]) || undefined;

  const field = (k: keyof Values) => ({
    name: k,
    value: values[k],
    onChange: (e: { currentTarget: { value: string } }) => {
      const value = e.currentTarget.value;
      setValues((v) => ({ ...v, [k]: value }));
    },
    onBlur: () => setTouched((t) => ({ ...t, [k]: true })),
    error: show(k),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const profile = await UserService.createBillingProfile({
        ...values,
        gst_number: values.gst_number.trim().toUpperCase(),
        address_line_2: values.address_line_2 || undefined,
      });
      toast.success("Billing Profile created successfully");
      onCreated(profile);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDialog
      title="Create new billing profile"
      size="wide"
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <button
            type="button"
            className="secondary-button"
            disabled={saving}
            onClick={() => {
              setValues(EMPTY);
              setTouched({});
              setSubmitted(false);
            }}
          >
            Reset
          </button>
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="tv-acc-billing-form" className="primary-button" disabled={saving}>
            {saving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {saving ? "Saving…" : "Save profile"}
          </button>
        </>
      }
    >
      <p className="tv-muted" style={{ marginTop: 0 }}>
        Used to generate invoices for your purchases.
      </p>
      <form id="tv-acc-billing-form" className="c-form-grid" onSubmit={(e) => void submit(e)} noValidate>
        <TextField label="Company Name" required {...field("billing_name")} />
        <TextField label="Email" type="email" required {...field("billing_email")} />
        <TextField label="Phone" type="tel" required {...field("billing_phone")} />
        <TextField label="GST No." placeholder="24ABCDE1234F1Z5" {...field("gst_number")} />
        <TextField label="Address Line 1" required full {...field("address_line_1")} />
        <TextField label="Address Line 2" full {...field("address_line_2")} />
        <TextField label="City" required {...field("city")} />
        <TextField label="State" required {...field("state")} />
        <TextField label="Country" required {...field("country")} />
        <TextField label="Pin Code" inputMode="numeric" required {...field("pincode")} />
      </form>
    </AppDialog>
  );
}
