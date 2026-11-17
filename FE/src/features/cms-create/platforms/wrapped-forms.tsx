"use client";

import { useEffect, useRef } from "react";
import { SelectField } from "@/components/ui/form-field";
import { useSelector } from "@/store";
import { FormText, req, type PlatformFormProps } from "@/features/cms-create/form-bits";
import { errorAt } from "@/features/cms-create/hooks";
import { platformIdentity } from "@/features/cms-create/platforms";
import { AjioForm } from "@/features/cms-create/platforms/ajio-form";

/**
 * TrackVid `NykaaForm`: the common layout plus Vendor Code / SKU ID / Return Type (nykaaClaimDetails) and the Nykaa
 * account at `nykaaClaimDetails.username`. On /cms/update a claim stored without an account falls back to the
 * company's verified Nykaa login.
 */
export function NykaaForm(props: PlatformFormProps) {
  const { formik, existingClaim } = props;
  const user = useSelector((s) => s.profile.userProfile);
  const entry = user?.company?.settings?.eCommercePlatformLoginInfo?.find((e) => platformIdentity(e.eComPlatform) === "NYKAA");
  const fallback = (entry?.info.find((a) => a.is_verified) ?? entry?.info[0])?.username?.trim() ?? "";
  const hydrated = useRef<string | null>(null);
  const setFieldValue = formik.setFieldValue;
  useEffect(() => {
    const id = existingClaim?._id ?? null;
    if (!id || hydrated.current === id) return;
    const effective = existingClaim?.nykaaClaimDetails?.username?.trim() || fallback;
    if (!effective) return;
    hydrated.current = id;
    void setFieldValue("nykaaClaimDetails.username", effective);
  }, [existingClaim, fallback, setFieldValue]);

  const extraLeft = (
    <div className="tv-grid-3 tv-cmsc-row">
      <FormText formik={formik} name="nykaaClaimDetails.vendorCode" label="Vendor Code" required placeholder="Enter Vendor Code" />
      <FormText formik={formik} name="nykaaClaimDetails.skuId" label="SKU ID" required placeholder="Enter SKU ID" />
      <SelectField
        label={req("Return Type")}
        name="nykaaClaimDetails.returnType"
        value={formik.values.nykaaClaimDetails?.returnType ?? ""}
        onChange={(e) => void formik.setFieldValue("nykaaClaimDetails.returnType", e.currentTarget.value)}
        onBlur={() => void formik.setFieldTouched("nykaaClaimDetails.returnType", true)}
        options={["RTO", "DTO", "REPL"].map((v) => ({ value: v, label: v }))}
        placeholder="Select Return Type"
        error={errorAt(formik, "nykaaClaimDetails.returnType")}
      />
    </div>
  );

  return (
    <AjioForm
      {...props}
      extraLeft={extraLeft}
      accountConfig={{
        platform: "nykaa",
        label: "Nykaa Account Username",
        value: formik.values.nykaaClaimDetails?.username ?? "",
        onChange: (v) => void formik.setFieldValue("nykaaClaimDetails.username", v),
      }}
    />
  );
}

/** TrackVid `ShopifyForm`: the common layout with the account at `otherClaimDetails.username`. */
export function ShopifyForm(props: PlatformFormProps) {
  const { formik } = props;
  return (
    <AjioForm
      {...props}
      accountConfig={{
        platform: "shopify",
        label: "Shopify Account Username",
        value: formik.values.otherClaimDetails?.username ?? "",
        onChange: (v) => void formik.setFieldValue("otherClaimDetails.username", v),
      }}
    />
  );
}
