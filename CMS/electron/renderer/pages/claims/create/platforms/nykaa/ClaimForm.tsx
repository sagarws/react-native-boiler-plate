import { Box, MenuItem, TextField, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef } from "react";
import AjioForm, { type PlatformFormProps } from "../ajio/ClaimForm";
import { accountsFor, useClaimCatalogue } from "../../ClaimCatalogue";

/**
 * Nykaa form: same layout as Ajio (common) but adds Vendor Code / SKU ID /
 * Return Type on the left. Mirrors NykaaExtraFields.tsx from the App.
 */
const NykaaForm = (props: PlatformFormProps) => {
  const { formik, side, existingClaim } = props;
  const catalogue = useClaimCatalogue();

  // Formik v2 wraps `setFieldValue` in useEventCallback internally, so the
  // reference is stable across renders — depend on it instead of the whole
  // formik object (which is a fresh reference every render).
  const setFieldValue = formik.setFieldValue;

  // Nykaa has no per-CMS account field on the BE model prior to the username
  // slot being added — older rows come back from find-by-awb with
  // nykaaClaimDetails.{vendorCode, skuId, returnType} but no username.
  // The puppeteer worker submits every Nykaa claim under the company's
  // single verified Nykaa credential (see triggerPuppeteerForCms.ts:571-591),
  // so when the loaded claim has no stored username we default the dropdown
  // to that same credential — the operator still sees (and can override)
  // exactly what will be used at submit time, and old rows get backfilled
  // on save.
  const fallbackNykaaUsername = useMemo(() => {
    // The catalogue already filtered and de-duplicated this company's Nykaa
    // logins, so the first entry is the one a claim would run under. The web
    // app prefers a verified account here; the catalogue does not carry the
    // verified flag, and every account it returns is one the company has
    // configured — the operator can still override from the dropdown.
    const accounts = accountsFor(catalogue, "nykaa");

    return accounts[0] ?? "";
  }, [catalogue]);

  // /cms/update hydration: seed nykaaClaimDetails from the loaded claim.
  // useCreateCmsForm.applyExistingClaim ALSO writes this bundle, but two
  // real-world races were leaving `nykaaClaimDetails.username` blank on the
  // dropdown:
  //   (a) applyExistingClaim's bundle merge and the account-username
  //       setFieldValue are batched in the same commit; MUI Autocomplete
  //       occasionally rendered from the pre-merge value.
  //   (b) Nykaa is a wrapper (NykaaForm → AjioForm), so the dropdown lives
  //       inside a child that doesn't own the bundle hydration — timing of
  //       parent-vs-child effect resolution can drop the initial value.
  // Writing vendorCode/skuId/returnType from here (ref-guarded per claim id)
  // is idempotent with applyExistingClaim's merge and guarantees the fields
  // preselect on direct /cms/update visits. Username hydration is handled by
  // a second effect below so it can wait on `fallbackNykaaUsername` (which
  // resolves once the catalogue is loaded) without re-writing the other slots.
  const nykaaHydratedClaimIdRef = useRef<string | null>(null);
  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || nykaaHydratedClaimIdRef.current === claimId) return;
    const bundle = (existingClaim?.nykaaClaimDetails as any) || null;
    if (!bundle) return;
    nykaaHydratedClaimIdRef.current = claimId;
    const stringOrEmpty = (v: unknown) =>
      typeof v === "string" ? v.trim() : "";
    const storedVendor = stringOrEmpty(bundle.vendorCode);
    const storedSku = stringOrEmpty(bundle.skuId);
    const storedReturnType = stringOrEmpty(bundle.returnType);
    if (storedVendor) {
      setFieldValue("nykaaClaimDetails.vendorCode", storedVendor);
    }
    if (storedSku) {
      setFieldValue("nykaaClaimDetails.skuId", storedSku);
    }
    if (
      storedReturnType === "RTO" ||
      storedReturnType === "DTO" ||
      storedReturnType === "REPL"
    ) {
      setFieldValue("nykaaClaimDetails.returnType", storedReturnType);
    }
  }, [existingClaim, setFieldValue]);

  // Account Username hydration — separate from the bundle effect so that
  // when the catalogue arrives AFTER existingClaim (fresh /cms/update visit),
  // the fallback still fires. Ref-guarded per claim id so the fallback runs
  // at most once per loaded claim; a subsequent manual clear by the user is
  // NOT re-filled.
  const nykaaUsernameHydratedClaimIdRef = useRef<string | null>(null);
  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || nykaaUsernameHydratedClaimIdRef.current === claimId) return;
    const bundle = (existingClaim?.nykaaClaimDetails as any) || null;
    const storedUsername =
      typeof bundle?.username === "string" ? bundle.username.trim() : "";
    const effective = storedUsername || fallbackNykaaUsername;
    if (!effective) return; // no BE value and no company credential — wait
    nykaaUsernameHydratedClaimIdRef.current = claimId;
    setFieldValue("nykaaClaimDetails.username", effective);
  }, [existingClaim, fallbackNykaaUsername, setFieldValue]);

  // Redirect AjioForm's Account Username row at the Nykaa integration list +
  // nykaaClaimDetails.username. Nykaa has no master-data feed, so no auto-
  // select — the operator picks manually or leaves it blank.
  //
  // Stabilized with useCallback + useMemo. `accountConfig` gets forwarded
  // into AjioForm which passes `value` / `onChange` into MUI Autocomplete,
  // and also uses `accountConfig` as an effect dep in the hydration effect.
  // A new object literal every render was:
  //  (a) churning Autocomplete's controlled-value handling (each render
  //      passed a fresh `onChange` reference; the field visibly stopped
  //      responding to clicks under fast re-renders — reproducible when
  //      formik.values.nykaaClaimDetails updated for a sibling field),
  //  (b) re-firing the hydration effect on every render (ref-guarded but
  //      still noisy).
  const nykaaUsername = (formik.values.nykaaClaimDetails?.username as string) || "";
  const handleAccountChange = useCallback(
    (v: string) => setFieldValue("nykaaClaimDetails.username", v),
    [setFieldValue],
  );
  const accountConfig = useMemo(
    () => ({
      platform: "nykaa",
      label: "Nykaa Account Username",
      value: nykaaUsername,
      onChange: handleAccountChange,
    }),
    [nykaaUsername, handleAccountChange],
  );

  if (side === "right") {
    return <AjioForm {...props} remarkLabel="Subject" accountConfig={accountConfig} />;
  }

  const nykaaTouched = (formik.touched as any)?.nykaaClaimDetails || {};
  const nykaaErrors = (formik.errors as any)?.nykaaClaimDetails || {};

  return (
    <>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
          gap: "16px",
          marginBottom: 2,
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Typography>
            Vendor Code <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
          </Typography>
          <TextField
            size="small"
            fullWidth
            name="nykaaClaimDetails.vendorCode"
            placeholder="Enter Vendor Code"
            value={formik.values.nykaaClaimDetails?.vendorCode || ""}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            error={!!(nykaaTouched.vendorCode && nykaaErrors.vendorCode)}
            helperText={nykaaTouched.vendorCode && (nykaaErrors.vendorCode as string)}
          />
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Typography>
            SKU ID <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
          </Typography>
          <TextField
            size="small"
            fullWidth
            name="nykaaClaimDetails.skuId"
            placeholder="Enter SKU ID"
            value={formik.values.nykaaClaimDetails?.skuId || ""}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            error={!!(nykaaTouched.skuId && nykaaErrors.skuId)}
            helperText={nykaaTouched.skuId && (nykaaErrors.skuId as string)}
          />
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Typography>
            Return Type <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
          </Typography>
          <TextField
            size="small"
            select
            fullWidth
            name="nykaaClaimDetails.returnType"
            value={formik.values.nykaaClaimDetails?.returnType || ""}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            error={!!(nykaaTouched.returnType && nykaaErrors.returnType)}
            helperText={nykaaTouched.returnType && (nykaaErrors.returnType as string)}
          >
            <MenuItem value="RTO">RTO</MenuItem>
            <MenuItem value="DTO">DTO</MenuItem>
            <MenuItem value="REPL">REPL</MenuItem>
          </TextField>
        </Box>
      </Box>

      <AjioForm {...props} accountConfig={accountConfig} />
    </>
  );
};

export default NykaaForm;
