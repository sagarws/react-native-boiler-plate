"use client";

import { useEffect, useRef } from "react";
import { Combobox } from "@/components/ui/combobox";
import { useSelector } from "@/store";
import { getAccountByAwb } from "@/services/cms-autofetch-service";
import { platformAccounts } from "@/features/cms-create/platforms";
import { useDebounced, useUnmounted } from "@/features/cms-create/hooks";

/**
 * TrackVid `PlatformAccountDropdown`: optional seller-account picker fed by the company's Integrations list. A stored
 * value missing from the list is still offered (removed credential / case drift). With exactly one account and
 * nothing picked, that account is selected.
 */
export function PlatformAccountDropdown({ platform, label, value, onChange, disabled }: { platform: string; label: string; value: string; onChange: (username: string) => void; disabled?: boolean }) {
  const user = useSelector((s) => s.profile.userProfile);
  const options = platformAccounts(user, platform);
  const trimmed = value.trim();
  if (trimmed && !options.some((o) => o.toLowerCase() === trimmed.toLowerCase())) options.push(trimmed);
  const autoSole = !disabled && options.length === 1 && !trimmed;
  const sole = autoSole ? options[0] : "";
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    if (sole) onChangeRef.current(sole);
  }, [sole]);

  return (
    <Combobox
      label={label}
      value={trimmed ? (options.find((o) => o.toLowerCase() === trimmed.toLowerCase()) ?? trimmed) : sole}
      onChange={(v) => onChange(v)}
      options={options.map((o) => ({ value: o, label: o }))}
      placeholder="Select account"
      disabled={disabled}
      hint={options.length === 0 ? "No account on Integrations for this platform" : undefined}
    />
  );
}

/**
 * TrackVid `usePlatformAccountAutoSelect`: on AWB settle (and on a platform switch with an AWB already typed) ask
 * the master data which account owns the AWB and fill it — never over a value already picked.
 */
export function usePlatformAccountAutoSelect({ platform, awb, currentValue, onResolve }: { platform: string; awb: string; currentValue: string; onResolve: (account: string) => void }) {
  const unmounted = useUnmounted();
  const seq = useRef(0);
  const live = useRef({ currentValue, onResolve });
  useEffect(() => {
    live.current = { currentValue, onResolve };
  });

  const lookup = useDebounced((value: string, type: "Return" | "Forward") => {
    const v = value.trim();
    if (!v || live.current.currentValue.trim()) return;
    const id = ++seq.current;
    getAccountByAwb(v, platform, type)
      .then((res) => {
        if (id !== seq.current || unmounted.current) return;
        const account = res.data?.account ?? "";
        if (!account || live.current.currentValue.trim()) return;
        live.current.onResolve(account);
      })
      .catch(() => {
        // Optional field: a lookup miss leaves the dropdown for a manual pick.
      });
  }, 500);

  const call = lookup.call;
  const awbRef = useRef(awb);
  useEffect(() => {
    awbRef.current = awb;
  });
  // Re-run for a platform switch on a settled AWB (typing is handled by the change handlers).
  useEffect(() => {
    if (awbRef.current.trim()) call(awbRef.current, "Return");
  }, [platform, call]);

  return { onReturnAwb: (v: string) => call(v, "Return"), onForwardAwb: (v: string) => call(v, "Forward") };
}
