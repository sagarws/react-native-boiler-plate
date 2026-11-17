// @ts-nocheck
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { modulesById } from "@/config/modules/registry";
import { showToast } from "@/lib/events";
import { findRecord } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

const applicationFormSections = [
  [
    "Business profile",
    [
      "name",
      "owner",
      "email",
      "phone",
      "businessType",
      "country",
      "website",
      "taxId",
      "payoutCountry",
    ],
  ],
  ["Catalog plan", ["category", "categories", "expectedSkus"]],
  [
    "Review status",
    [
      "documents",
      "verification",
      "risk",
      "reviewer",
      "submittedAt",
      "decisionAt",
      "status",
      "notes",
    ],
  ],
];

const listingApprovalFormSections = [
  ["Listing ownership", ["productId", "vendorId", "submittedAt", "reviewer"]],
  [
    "Quality checks",
    ["completeness", "images", "variants", "seo", "compliance", "risk"],
  ],
  ["Decision", ["status", "decisionAt", "feedback"]],
];

function getReviewFieldDefaultValue(e) {
  return e.key === "status"
    ? e.options?.[0] || ""
    : e.type === "money" || e.type === "number"
      ? (e.min ?? 0)
      : "";
}

export function MarketplaceReviewFormDialog({
  moduleId,
  recordId,
  onClose,
  onChanged,
}) {
  const i = modulesById[moduleId];
  const a = recordId ? findRecord(moduleId, recordId) : void 0;
  const o =
    moduleId === "applications"
      ? applicationFormSections
      : listingApprovalFormSections;
  const [s, c] = useState("");
  const u =
    moduleId === "applications"
      ? recordId
        ? `Edit ${String(a?.name || "application")}`
        : "Add vendor application"
      : recordId
        ? "Edit listing review"
        : "Submit listing for approval";
  return (
    <AppDialog
      title={u}
      onClose={onClose}
      wide
      className="vendor-detail-dialog marketplace-review-dialog"
    >
      <form
        className="c-form vendor-editor-form marketplace-review-editor"
        onSubmit={(a) => {
          a.preventDefault();
          c("");
          try {
            const o = new FormData(a.currentTarget);
            const s = {};
            i.fields.forEach((e) => {
              const t = o.get(e.key);
              const n = typeof t == "string" ? t.trim() : "";
              s[e.key] =
                ["money", "number"].includes(e.type) && n !== ""
                  ? Number(n)
                  : n;
            });
            saveRecord(moduleId, s, recordId);
            onClose();
            onChanged();
            showToast(
              recordId
                ? "Review record updated."
                : moduleId === "applications"
                  ? "Vendor application created."
                  : "Listing submitted for marketplace review.",
            );
          } catch (e) {
            c(
              e instanceof Error
                ? e.message
                : "This record could not be saved.",
            );
          }
        }}
      >
        {o.map(([e, t]) => (
          <fieldset key={e}>
            <legend>{e}</legend>
            <div className="c-form-grid">
              {t
                .map((e) => i.fields.find((t) => t.key === e))
                .filter(Boolean)
                .map((e) => (
                  <FormField
                    key={e.key}
                    field={e}
                    value={a?.[e.key] ?? getReviewFieldDefaultValue(e)}
                  />
                ))}
            </div>
          </fieldset>
        ))}
        <div className="vendor-editor-note">
          <Icon name="info" />
          <p>
            {moduleId === "applications"
              ? "Applications should capture partner identity, catalog scope, verification readiness and reviewer ownership before a vendor account is activated."
              : "Use the moderation checklist to keep vendor listings consistent before they are published to shoppers."}
          </p>
        </div>
        <p className="c-form-error" role="alert">
          {s}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            {recordId
              ? moduleId === "applications"
                ? "Save application"
                : "Save review"
              : moduleId === "applications"
                ? "Create application"
                : "Submit listing"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
