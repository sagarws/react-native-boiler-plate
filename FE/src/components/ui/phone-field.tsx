"use client";

import { useId } from "react";
import { FieldShell } from "@/components/ui/form-field";
import type { IPhone } from "@/types/common";

export const COUNTRY_CODES: readonly { countryCode: string; code: string; name: string }[] = [
  { countryCode: "IN", code: "+91", name: "India" },
  { countryCode: "US", code: "+1", name: "United States" },
  { countryCode: "GB", code: "+44", name: "United Kingdom" },
  { countryCode: "AE", code: "+971", name: "UAE" },
  { countryCode: "SG", code: "+65", name: "Singapore" },
  { countryCode: "AU", code: "+61", name: "Australia" },
  { countryCode: "CA", code: "+1", name: "Canada" },
  { countryCode: "BD", code: "+880", name: "Bangladesh" },
  { countryCode: "NP", code: "+977", name: "Nepal" },
  { countryCode: "LK", code: "+94", name: "Sri Lanka" },
];

/** Country code select + number input (replaces `mui-tel-input`). Value shape matches TrackVid `phone`. */
export function PhoneField({
  label = "Phone number",
  value,
  onChange,
  error,
  required,
  disabled,
  full,
}: {
  label?: string;
  value: IPhone;
  onChange: (value: IPhone) => void;
  error?: string | false | null;
  required?: boolean;
  disabled?: boolean;
  full?: boolean;
}) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} required={required} error={error} full={full}>
      <div className="tv-phone">
        <select
          aria-label="Country code"
          value={value.countryCode}
          disabled={disabled}
          onChange={(e) => {
            const c = COUNTRY_CODES.find((x) => x.countryCode === e.currentTarget.value);
            if (c) onChange({ ...value, code: c.code, countryCode: c.countryCode });
          }}
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.countryCode} value={c.countryCode}>
              {c.countryCode} {c.code}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(error)}
          value={value.number}
          maxLength={15}
          onChange={(e) => onChange({ ...value, number: e.currentTarget.value.replace(/[^0-9]/g, "") })}
        />
      </div>
    </FieldShell>
  );
}
