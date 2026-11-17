"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { IconTile } from "@/components/ui/card-primitives";
import { FileDrop } from "@/components/ui/file-drop";
import { SelectField, TextField } from "@/components/ui/form-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Stepper } from "@/components/ui/stepper";
import { BillingProfileDialog } from "@/features/accounts/components/billing-profile-dialog";
import { LocalFilePreview } from "@/features/accounts/components/file-preview";
import { GST_RATE, planTotals } from "@/features/accounts/lib/accounts-helpers";
import { copyText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { formatBytes, formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { AccountService } from "@/services/account-service";
import { ManualPaymentService } from "@/services/manualPayment-service";
import { UserService } from "@/services/user-service";
import type { PaymentMode, PaymentRequests } from "@/types/accounts";
import type { IPlan } from "@/types/common";

const STEPS = ["Plan summary", "Billing details", "Payment"] as const;
const UPI_ID = "vyapar.172547841020@hdfcbank";
const MERCHANT = "WHITESTONE INFOTECH LLP";
const SUPPORT_PHONE = "+91-98792 09533";
const BANK = [
  ["Account name", MERCHANT],
  ["Account no.", "50200086322142"],
  ["IFSC", "HDFC0001708"],
  ["Bank", "HDFC BANK"],
  ["Branch", "Katargam, Surat"],
  ["GST No.", "24AAEFW5097R1ZA"],
] as const;
const MAX_PROOF = 10 * 1024 * 1024;

const rupees = (n: number) => `₹${formatNumber(Number(n.toFixed(2)))}`;

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="tv-acc-section-heading">
      <h3>{title}</h3>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  );
}

/* ---------------- step 1: plan summary ---------------- */

function OfferSummary({ plan }: { plan: IPlan }) {
  const t = planTotals(plan);
  return (
    <div className="tv-stack">
      <SectionHeading title="Review your order" subtitle="Confirm the plan details and pricing before proceeding to billing." />
      <div className="tv-acc-split">
        <section className="tv-acc-panel is-highlight">
          <div className="tv-row">
            <IconTile name="sparkle" tone="amber" />
            <div>
              <span className="tv-acc-eyebrow">Selected plan</span>
              <strong className="tv-acc-panel-title">{plan.name}</strong>
            </div>
          </div>
          <hr className="tv-acc-dashed" />
          <div className="tv-acc-line">
            <span>
              <Icon name="sparkle" /> Plan credits
            </span>
            <strong>{formatNumber(plan.credit ?? 0)}</strong>
          </div>
          <div className="tv-acc-line">
            <span>
              <Icon name="gift" /> Bonus credits
            </span>
            <strong className="tv-acc-bonus">+{formatNumber(plan.bonus ?? 0)}</strong>
          </div>
          <div className="tv-acc-callout">
            <span>
              <small>Total credits</small>
              <strong>{formatNumber(t.total)}</strong>
            </span>
            <small>₹{t.perCredit} / credit</small>
          </div>
        </section>
        <section className="tv-acc-panel">
          <span className="tv-acc-eyebrow">
            <Icon name="receipt" /> Order summary
          </span>
          <div className="tv-acc-line">
            <span>
              {plan.name} <small className="tv-muted">× 1</small>
            </span>
            <strong>{rupees(plan.price)}</strong>
          </div>
          <div className="tv-acc-line">
            <span>Subtotal</span>
            <strong>{rupees(plan.price)}</strong>
          </div>
          <div className="tv-acc-line">
            <span>GST ({GST_RATE}%)</span>
            <strong>{rupees(t.gst)}</strong>
          </div>
          <hr className="tv-acc-dashed" />
          <div className="tv-acc-line is-total">
            <span>Total payable</span>
            <strong>{rupees(t.payable)}</strong>
          </div>
          <p className="tv-acc-note">
            <Icon name="lock" /> Pay online, by UPI or by bank transfer in the next steps.
          </p>
        </section>
      </div>
      <p className="tv-acc-note is-plain">
        <Icon name="info" /> Offers are subject to change without notice. GST will be added as applicable per government regulations.
      </p>
    </div>
  );
}

/* ---------------- step 2: billing details ---------------- */

function BillingDetails({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const [tick, setTick] = useState(0);
  const [creating, setCreating] = useState(false);
  const { data: profiles, loading, error, reload } = useAsync(() => UserService.getBillingProfiles(), [tick]);
  const current = profiles?.find((p) => p._id === selected);

  return (
    <div className="tv-stack">
      <SectionHeading title="Billing details" subtitle="Choose which billing profile we should use to generate your invoice." />
      {loading && !profiles ? (
        <LoadingState label="Loading billing profiles…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div className="tv-acc-split is-billing">
          <section className="tv-acc-panel">
            <span className="tv-acc-eyebrow">Bill to</span>
            <p className="tv-muted tv-small" style={{ margin: 0 }}>
              Pick an existing profile, or add a new one.
            </p>
            <SelectField
              label="Billing profile"
              value={selected}
              placeholder="Select billing profile"
              options={(profiles ?? []).map((p) => ({ value: p._id, label: `${p.gst_number || "No GST"} - ${p.billing_name}` }))}
              onChange={(e) => onSelect(e.currentTarget.value)}
            />
            <button type="button" className="secondary-button compact-button" style={{ alignSelf: "flex-start" }} onClick={() => setCreating(true)}>
              <Icon name="plus" /> Add new billing profile
            </button>
            <p className="tv-acc-note is-warn">
              <Icon name="warning" /> Double-check your billing details — they cannot be changed after submission.
            </p>
          </section>
          <section className="tv-acc-panel">
            {current ? (
              <>
                <span className="tv-acc-eyebrow">Invoice preview</span>
                <dl className="tv-kv tv-acc-kv">
                  <dt>Company</dt>
                  <dd>{current.billing_name}</dd>
                  <dt>GST No.</dt>
                  <dd>{current.gst_number || "—"}</dd>
                  <dt>Address 1</dt>
                  <dd>{current.address_line_1}</dd>
                  <dt>Address 2</dt>
                  <dd>{current.address_line_2 || "—"}</dd>
                  <dt>City / State</dt>
                  <dd>
                    {current.city}, {current.state}
                  </dd>
                  <dt>Country</dt>
                  <dd>{current.country}</dd>
                  <dt>Phone</dt>
                  <dd>{current.billing_phone}</dd>
                  <dt>Email</dt>
                  <dd>{current.billing_email}</dd>
                </dl>
              </>
            ) : (
              <EmptyState icon="receipt" title="No billing profile selected" message="Select a profile to preview the invoice details." />
            )}
          </section>
        </div>
      )}
      {creating ? (
        <BillingProfileDialog
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            setTick((n) => n + 1);
            onSelect(p._id);
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------------- step 3: payment ---------------- */

function MethodTile({ selected, icon, title, subtitle, onClick }: { selected: boolean; icon: IconName; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={`tv-acc-method ${selected ? "is-selected" : ""}`.trim()} onClick={onClick}>
      <span className="tv-acc-method-icon">
        <Icon name={icon} />
      </span>
      <span className="tv-acc-method-copy">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <span className="tv-acc-radio" aria-hidden="true" />
    </button>
  );
}

interface PaymentForm {
  method: PaymentMode;
  reference: string;
  file: File | null;
}

function ConfirmPayment({ plan, form, onChange }: { plan: IPlan; form: PaymentForm; onChange: (patch: Partial<PaymentForm>) => void }) {
  const t = planTotals(plan);
  const [copied, setCopied] = useState(false);
  const upiUrl = `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(MERCHANT)}&am=${t.payable.toFixed(2)}&cu=INR`;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (text: string, okMessage?: string) => {
    if (await copyText(text)) {
      if (okMessage) toast.success(okMessage);
      else setCopied(true);
    } else toast.error("Could not copy. Select the text and copy it manually.");
  };

  let methodPanel: ReactNode;
  if (form.method === "online") {
    methodPanel = (
      <div className="tv-stack">
        <span className="tv-acc-eyebrow">
          <Icon name="credit-card" /> Online checkout
        </span>
        <p className="tv-muted" style={{ margin: 0 }}>
          Pay with card, UPI or net banking in a secure checkout window. Credits are added to your wallet as soon as the payment succeeds.
        </p>
        <Banner tone="info">This preview uses a simulated checkout instead of Razorpay — no real payment is taken.</Banner>
      </div>
    );
  } else if (form.method === "upi") {
    methodPanel = (
      <div className="tv-acc-upi">
        <div className="tv-acc-qr">
          <QRCodeSVG value={upiUrl} size={168} marginSize={0} title="UPI payment QR code" />
        </div>
        <div className="tv-stack">
          <div>
            <span className="tv-acc-eyebrow">UPI ID</span>
            <div className="tv-row">
              <strong>{UPI_ID}</strong>
              <button type="button" className="icon-button compact-button" aria-label="Copy UPI ID" onClick={() => void copy(UPI_ID, "UPI ID copied")}>
                <Icon name="copy" />
              </button>
            </div>
          </div>
          <div>
            <span className="tv-acc-eyebrow">Beneficiary</span>
            <div>{MERCHANT}</div>
          </div>
          <small className="tv-muted">Open any UPI app and scan the QR, or pay to the UPI ID directly.</small>
        </div>
      </div>
    );
  } else {
    methodPanel = (
      <div className="tv-stack">
        <span className="tv-acc-eyebrow">Bank account details</span>
        <dl className="tv-kv tv-acc-kv">
          {BANK.map(([k, v]) => (
            <span key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </span>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div className="tv-stack">
      <SectionHeading title="Choose how to pay" subtitle="Pay online, or pay via UPI / bank transfer and upload the proof below." />
      <div className="tv-acc-methods" role="radiogroup" aria-label="Payment method">
        <MethodTile selected={form.method === "online"} icon="credit-card" title="Pay online" subtitle="Card, UPI or net banking" onClick={() => onChange({ method: "online" })} />
        <MethodTile selected={form.method === "upi"} icon="qr-code" title="UPI Payment" subtitle="Scan the QR or copy the UPI ID" onClick={() => onChange({ method: "upi" })} />
        <MethodTile selected={form.method === "bank"} icon="bank" title="Bank Transfer" subtitle="NEFT / RTGS / IMPS" onClick={() => onChange({ method: "bank" })} />
      </div>

      <div className="tv-acc-split is-pay">
        <section className="tv-acc-panel">{methodPanel}</section>
        <section className="tv-acc-panel is-highlight">
          <span className="tv-acc-eyebrow">Amount to pay</span>
          <strong className="tv-acc-amount">{rupees(t.payable)}</strong>
          <small className="tv-muted">
            Includes {rupees(t.gst)} GST ({GST_RATE}%)
          </small>
          {form.method !== "online" ? (
            <>
              <hr className="tv-acc-dashed" />
              <span className="tv-acc-eyebrow">Reference number</span>
              <div className="tv-row">
                <strong className="tv-mono">{form.reference}</strong>
                <button type="button" className="icon-button compact-button" aria-label="Copy reference number" onClick={() => void copy(form.reference)}>
                  <Icon name="copy" />
                </button>
                {copied ? <small className="tv-acc-copied">Copied</small> : null}
              </div>
              <small className="tv-acc-warn-text">
                Add this in the payment <strong>“Remarks”</strong> field.
              </small>
            </>
          ) : null}
        </section>
      </div>

      {form.method !== "online" ? (
        <section className="tv-acc-panel">
          <span className="tv-acc-eyebrow">
            <Icon name="upload" /> Submit payment proof
          </span>
          <p className="tv-muted tv-small" style={{ margin: 0 }}>
            Once you&apos;ve paid, upload the screenshot or receipt and we&apos;ll credit your account after verification.
          </p>
          <div className="c-form-grid">
            <TextField label="Reference number" required value={form.reference} onChange={(e) => onChange({ reference: e.currentTarget.value })} />
            <div className="c-field">
              <span className="tv-acc-field-label">
                Payment screenshot / receipt <small>*</small>
              </span>
              {form.file ? (
                <div className="tv-acc-proof">
                  <LocalFilePreview file={form.file} compact />
                  <div className="tv-acc-proof-meta">
                    <strong>{form.file.name}</strong>
                    <small>{formatBytes(form.file.size)}</small>
                  </div>
                  <button type="button" className="icon-button compact-button" aria-label="Remove file" onClick={() => onChange({ file: null })}>
                    <Icon name="x" />
                  </button>
                </div>
              ) : (
                <FileDrop
                  accept="application/pdf,image/*"
                  title="Drop the screenshot here or click to browse"
                  hint="PNG, JPG or PDF up to 10 MB"
                  onFiles={(files) => {
                    const f = files[0];
                    if (!f) return;
                    if (f.size > MAX_PROOF) {
                      toast.error("Payment proof must be 10 MB or smaller.");
                      return;
                    }
                    onChange({ file: f });
                  }}
                />
              )}
            </div>
          </div>
        </section>
      ) : null}

      <div className="tv-acc-split">
        <div className="tv-acc-help is-green">
          <Icon name="chats-circle" />
          <span>
            <strong>Faster verification (≈30 min)</strong>
            <small>
              Send the screenshot + reference on WhatsApp to <b>{SUPPORT_PHONE}</b>
            </small>
          </span>
        </div>
        <div className="tv-acc-help">
          <Icon name="info" />
          <span>
            <strong>Need help?</strong>
            <small>
              Contact us at <b>{SUPPORT_PHONE}</b>
            </small>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- simulated checkout (replaces Razorpay) ---------------- */

type CheckoutState = "idle" | "paying" | "failed";

function MockCheckoutDialog({
  plan,
  billingProfileId,
  onClose,
  onPaid,
}: {
  plan: IPlan;
  billingProfileId: string;
  onClose: () => void;
  onPaid: (payment: PaymentRequests, creditAdded: number) => void;
}) {
  const t = planTotals(plan);
  const [outcome, setOutcome] = useState<"success" | "failure">("success");
  const [state, setState] = useState<CheckoutState>("idle");
  const [failure, setFailure] = useState("");

  const pay = async () => {
    setState("paying");
    try {
      const res = await AccountService.purchasePlan({ plan_id: plan._id, billing_profile_id: billingProfileId, simulateFailure: outcome === "failure" });
      toast.success(res.message);
      onPaid(res.payment, res.creditAdded);
    } catch (err) {
      setFailure(errorMessage(err));
      setState("failed");
    }
  };

  return (
    <AppDialog
      title="TrackVid checkout"
      size="sm"
      onClose={onClose}
      locked={state === "paying"}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={state === "paying"}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void pay()} disabled={state === "paying"}>
            {state === "paying" ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="lock" />}
            {state === "paying" ? "Processing…" : state === "failed" ? "Try again" : `Pay ${rupees(t.payable)}`}
          </button>
        </>
      }
    >
      <div className="tv-stack">
        <div className="tv-acc-checkout-head">
          <span className="tv-muted tv-small">{MERCHANT}</span>
          <strong className="tv-acc-amount">{rupees(t.payable)}</strong>
          <small className="tv-muted">
            {plan.name} plan · {formatNumber(t.total)} credits
          </small>
        </div>
        {state === "failed" ? (
          <Banner tone="error" title="Payment failed">
            {failure}
          </Banner>
        ) : null}
        <fieldset className="tv-acc-outcome" disabled={state === "paying"}>
          <legend>Simulated result</legend>
          <label className="tv-check">
            <input type="radio" name="tv-acc-outcome" checked={outcome === "success"} onChange={() => setOutcome("success")} />
            Payment succeeds
          </label>
          <label className="tv-check">
            <input type="radio" name="tv-acc-outcome" checked={outcome === "failure"} onChange={() => setOutcome("failure")} />
            Payment fails (bank declines)
          </label>
        </fieldset>
        <small className="tv-muted">Razorpay is not connected in this preview. No money is taken.</small>
      </div>
    </AppDialog>
  );
}

/* ---------------- the dialog ---------------- */

export type PurchaseResult = { kind: "online"; payment: PaymentRequests; creditAdded: number } | { kind: "manual" };

/** TrackVid `PaymentStepsDialog`: plan summary → billing profile → payment (online / UPI / bank). */
export function PaymentStepsDialog({ plan, onClose, onComplete }: { plan: IPlan; onClose: () => void; onComplete: (result: PurchaseResult) => void }) {
  const [step, setStep] = useState(0);
  const [billingProfile, setBillingProfile] = useState("");
  const [form, setForm] = useState<PaymentForm>(() => ({ method: "online", reference: `REF${Date.now()}`, file: null }));
  const [submitting, setSubmitting] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const t = planTotals(plan);

  const next = () => {
    if (step === 1 && !billingProfile) {
      toast.error("Please select a billing profile");
      return;
    }
    setStep((s) => s + 1);
  };

  const submitManual = async () => {
    if (!form.file) {
      toast.error("Please upload a screenshot of your payment.");
      return;
    }
    if (!form.reference.trim()) {
      toast.error("Please enter your reference number.");
      return;
    }
    setSubmitting(true);
    try {
      await ManualPaymentService.createPayment({
        file: form.file,
        reference_id: form.reference,
        billing_profile_id: billingProfile,
        plan_id: plan._id,
        payment_mode: form.method,
      });
      toast.success("Your payment has been submitted successfully");
      onComplete({ kind: "manual" });
    } catch (err) {
      toast.error(errorMessage(err, "An error occurred while submitting your payment. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <AppDialog
        title={`Purchase ${plan.name}`}
        size="xl"
        onClose={onClose}
        locked={submitting}
        footer={
          <div className="tv-acc-steps-footer">
            <span className="tv-muted tv-small">
              Step {step + 1} of {STEPS.length}
            </span>
            <div className="tv-row">
              {step !== 0 ? (
                <button type="button" className="secondary-button" onClick={() => setStep((s) => s - 1)} disabled={submitting}>
                  Previous
                </button>
              ) : null}
              {step !== 2 ? (
                <button type="button" className="primary-button" onClick={next}>
                  Continue
                </button>
              ) : form.method === "online" ? (
                <button type="button" className="primary-button" onClick={() => setCheckout(true)}>
                  <Icon name="lock" /> Pay {rupees(t.payable)}
                </button>
              ) : (
                <button type="button" className="primary-button" onClick={() => void submitManual()} disabled={submitting}>
                  {submitting ? <span className="tv-spinner small" aria-hidden="true" /> : null}
                  Submit payment
                </button>
              )}
            </div>
          </div>
        }
      >
        <p className="tv-muted" style={{ marginTop: 0 }}>
          Complete your purchase in {STEPS.length} quick steps
        </p>
        <Stepper steps={STEPS} active={step} />
        {step === 0 ? <OfferSummary plan={plan} /> : null}
        {step === 1 ? <BillingDetails selected={billingProfile} onSelect={setBillingProfile} /> : null}
        {step === 2 ? <ConfirmPayment plan={plan} form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} /> : null}
      </AppDialog>
      {checkout ? (
        <MockCheckoutDialog
          plan={plan}
          billingProfileId={billingProfile}
          onClose={() => setCheckout(false)}
          onPaid={(payment, creditAdded) => {
            setCheckout(false);
            onComplete({ kind: "online", payment, creditAdded });
          }}
        />
      ) : null}
    </>
  );
}
