"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import { readStored, writeStored } from "@/lib/storage";

export type ThemeMode = "light" | "dark" | "system";

const OPTIONS: { id: ThemeMode; label: string; icon: IconName }[] = [
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
  { id: "system", label: "System", icon: "monitor" },
];

/** Apply the theme to <html data-theme>; `system` follows the OS setting. */
export function applyTheme(mode: ThemeMode): void {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** Light / dark / system switch (TrackVid `ThemeSwitch`), template popover style. */
export function ThemeMenu({ open, onToggle, onClose }: { open: boolean; onToggle: (el: HTMLElement) => void; onClose: () => void }) {
  const [mode, setMode] = useState<ThemeMode>(() => readStored<ThemeMode>("theme", "light"));

  useEffect(() => {
    applyTheme(mode);
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const current = OPTIONS.find((o) => o.id === mode) ?? OPTIONS[0];
  return (
    <div className="header-menu-wrap">
      <button
        type="button"
        className="icon-button"
        aria-label={`Theme: ${current.label}`}
        title={`Theme: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => onToggle(e.currentTarget)}
      >
        <Icon name={current.icon} />
      </button>
      {open ? (
        <div className="header-popover popover-period" role="menu" aria-label="Theme">
          <div className="popover-title">Theme</div>
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={o.id === mode}
              onClick={() => {
                setMode(o.id);
                writeStored("theme", o.id);
                onClose();
              }}
            >
              <Icon name={o.icon} />
              <span>
                <strong>{o.label}</strong>
              </span>
              {o.id === mode ? <Icon name="check-circle" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
