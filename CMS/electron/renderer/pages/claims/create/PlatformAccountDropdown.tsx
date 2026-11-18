import { useEffect, useMemo, useRef } from "react";
import { Autocomplete, TextField } from "@mui/material";
import { accountsFor, useClaimCatalogue } from "./ClaimCatalogue";

interface Props {
  /** Platform key, matching how eCommercePlatformLoginInfo stores it — the
   *  component upper-cases for comparison so "ajio", "AJIO", "Ajio" all work. */
  platform: string;
  /** Currently selected username. Empty string clears the selection. */
  value: string;
  onChange: (username: string) => void;
  /**
   * Optional floating label. Left EMPTY by every current call site because
   * the CMS form pattern is `<Typography>Label</Typography>` above the input
   * — matching the plain AWB / SKU TextFields on the same row. Passing a
   * value here re-enables the MUI floating label.
   */
  label?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Renders a red asterisk + Yup-style error styling when set. Left off by
   *  default because the dropdown is optional on every platform for now. */
  error?: boolean;
  helperText?: string;
}

const PlatformAccountDropdown = ({
  platform,
  value,
  onChange,
  label,
  disabled,
  placeholder,
  error,
  helperText,
}: Props) => {
  const catalogue = useClaimCatalogue();

  const options = useMemo<string[]>(() => {
    // Compared without the spacing, because the two sides disagree about it
    // and always have: this component is asked for "tataCliq" while the
    // credential is stored under whatever was typed on Integrations — "Tata
    // CLiQ" in the company that reported this. An exact uppercase match found
    // no accounts, so the dropdown had nothing to offer, the operator's pick
    // was never committed to the form, and the claim was created with no
    // account on it. Nothing said why: an empty dropdown looks the same as a
    // company with no credentials.
    const out = accountsFor(catalogue, platform);
    const seen = new Set(out.map((name) => name.toLowerCase()));
    // Include the currently-hydrated `value` if it's not already in the
    // integration list. This covers three real cases seen on /cms/update:
    //   1. Options list is empty on first render because the catalogue has not
    //      hydrated yet — the Autocomplete would otherwise blank out the
    //      value it was just handed.
    //   2. The credential was removed from Integrations after the claim was
    //      filed — we still need to show what's on the row, not silently
    //      swap it for an empty select.
    //   3. Case drift between the claim's stored username and the current
    //      integration entry.
    const trimmedValue = String(value || "").trim();
    if (trimmedValue && !seen.has(trimmedValue.toLowerCase())) {
      out.push(trimmedValue);
    }
    return out;
  }, [platform, catalogue, value]);

  // Auto-select the sole account when the integration list has exactly one
  // entry and nothing is picked yet. Fires on mount and when `options` grows
  // from empty to one (the catalogue arriving after this component mounts is
  // the common case on a fresh /cms/create). The `!value` gate keeps this
  // from clobbering /cms/update hydration or an operator's manual pick — if
  // they pick and then clear back to empty on a single-account platform,
  // the effect will re-select, which matches the "there's only one account
  // and every submit runs under it" reality.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const trimmedValue = String(value || "").trim();
  const shouldAutoSelectSole =
    !disabled && options.length === 1 && !trimmedValue;

  // What the operator SEES as selected. The sole account shows as picked on
  // the first paint, before the effect below has written it anywhere — without
  // this they read "Select account" for a frame and think auto-select failed.
  const displayValue = trimmedValue
    ? value
    : shouldAutoSelectSole
      ? options[0]
      : null;

  /*
   * WHAT IS SHOWN IS WHAT THE FORM HOLDS.
   *
   * These were two separate facts and they could disagree: the box rendered
   * the sole account while the form still held "", so the Return Order Number
   * lookup refused with "Choose the AJIO account to look this up" — pointing
   * at a dropdown that was plainly already filled in.
   *
   * Written as "persist whatever is displayed" rather than "auto-select once
   * when the catalogue arrives", because the old wording only covered the
   * first arrival. Anything that emptied the form afterwards — a platform
   * switch, Reset, a re-mount — left the display and the form out of step
   * again, with no second chance to reconcile.
   */
  useEffect(() => {
    if (trimmedValue || !displayValue) return;

    onChangeRef.current(displayValue);
  }, [displayValue, trimmedValue]);

  // Only pass a `label` when the caller actually wants MUI's floating-label
  // behavior. Every current call site sends `label=""` so the field renders
  // as a plain small TextField, matching the sibling AWB / SKU inputs whose
  // captions live in an external <Typography> above them.
  const floatingLabel = label ? label : undefined;

  return (
    <Autocomplete
      size="small"
      fullWidth
      disabled={disabled}
      options={options}
      value={displayValue}
      onChange={(_e, next) => onChange(next || "")}
      isOptionEqualToValue={(opt, val) =>
        String(opt).toLowerCase() === String(val || "").toLowerCase()
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={floatingLabel}
          placeholder={placeholder || "Select account"}
          error={!!error}
          helperText={helperText || undefined}
        />
      )}
    />
  );
};

export default PlatformAccountDropdown;
