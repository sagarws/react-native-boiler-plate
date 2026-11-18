import { useEffect } from "react";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { useClaimCatalogue } from "./ClaimCatalogue";
import type { HeaderField } from "./platforms/registry";
import type { ClaimForm } from "./useClaimForm";
import { getIn } from "./useClaimForm";
import type { ICms } from "@shared/types/cmsCreate";

/**
 * One of the extra controls a platform puts in the page header.
 *
 * Delhivery's freight lane and subcategory, Flipkart's claim area, Amazon's
 * fulfilment channel. In TrackVid-FE each is forty lines of JSX behind an
 * `if (platformLower === …)` on the page; here they are DATA in
 * `platforms/registry.ts` and this renders whichever the active platform
 * declares. Adding a marketplace with a fifth such field is a registry entry,
 * not an edit to the page.
 *
 * Every one of them is required, so every one gets the asterisk — there is no
 * optional header field today and a platform that needs one should say so in
 * the registry rather than have this guess.
 */

interface Props {
  field: HeaderField
  formik: ClaimForm<ICms>
  /** Where the form keeps the picked seller account — for `optionsForAccount`. */
  accountPath?: string | null
}

export const HeaderFieldControl = ({ field, formik, accountPath = null }: Props) => {
  const catalogue = useClaimCatalogue();
  const touched = getIn(formik.touched, field.path);
  const error = getIn(formik.errors, field.path);
  const message = touched && typeof error === "string" ? error : undefined;
  const picked: unknown = accountPath ? getIn(formik.values, accountPath) : "";
  const username = typeof picked === "string" ? picked : "";
  const accountOptions = field.optionsForAccount && username ? field.optionsForAccount(catalogue, username) : null;
  const options = (accountOptions ?? field.options ?? []) as string[];
  const value = (getIn(formik.values, field.path) as string) || "";

  // A pick from another account's list is not this one's: clear it, so the
  // claim is never filed under a Domestic this login cannot act on.
  useEffect(() => {
    if (accountOptions && value && !accountOptions.includes(value)) {
      formik.setFieldValue(field.path, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountOptions, value, field.path]);

  /*
   * ONE OPTION IS NOT A CHOICE. A Delhivery login with a single Domestic (or
   * any header field down to one value) is filled in with it and shown as a
   * fixed value — a dropdown with one entry only asks the operator to click
   * the answer the form already knows. When the account changes to one with
   * several, the dropdown comes back.
   */
  const soleOption = field.fixedValue === undefined && options.length === 1 ? options[0] : undefined;

  useEffect(() => {
    if (soleOption !== undefined && value !== soleOption) {
      formik.setFieldValue(field.path, soleOption);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleOption, value, field.path]);

  return (
    <Box sx={{ flex: "1 1 260px" }}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        <Typography>
          {field.label} <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
        </Typography>
        {field.fixedValue !== undefined ? (
          /*
           * Shown, not asked. The value is the same on every claim this
           * platform takes — it is rendered so the operator can see what is
           * being filed, and stamped onto the form elsewhere so it is actually
           * sent.
           */
          <TextField size="small" disabled value={field.fixedValue} name={field.path} />
        ) : soleOption !== undefined ? (
          // The only value there is — picked for the operator, not offered.
          <TextField size="small" disabled value={soleOption} name={field.path} />
        ) : (
          <Autocomplete
            size="small"
            options={options}
            value={value || null}
            onChange={(_, value) => {
              formik.setFieldValue(field.path, value || "");
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                name={field.path}
                onBlur={() => formik.setFieldTouched(field.path, true)}
                error={Boolean(message)}
                helperText={message}
                placeholder={field.placeholder}
              />
            )}
          />
        )}
      </Box>
    </Box>
  );
};

export default HeaderFieldControl;
