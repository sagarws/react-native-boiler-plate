import AjioForm, { type PlatformFormProps } from "../ajio/ClaimForm";

/**
 * Scaffold for Shopify: currently delegates to Ajio (common) layout. No
 * TrackVid-App reference exists yet. Add Shopify-specific fields here
 * without disturbing other platforms once backend/spec is defined.
 *
 * accountConfig override prevents the Ajio parent from rendering
 * "AJIO Account Username" for Shopify claims. Shopify has no dedicated
 * bundle field yet, so the picker writes into `otherClaimDetails.username`
 * (same bucket other non-AJIO platforms use). Dropdown will be empty
 * until Shopify accounts land in the Integrations page.
 */
const ShopifyForm = (props: PlatformFormProps) => (
  <AjioForm
    {...props}
    accountConfig={{
      platform: "shopify",
      label: "Shopify Account Username",
      value: (props.formik.values.otherClaimDetails?.username as string) || "",
      onChange: (v) =>
        props.formik.setFieldValue("otherClaimDetails.username", v),
    }}
  />
);

export default ShopifyForm;
