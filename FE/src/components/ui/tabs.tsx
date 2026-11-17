"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/icon";

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  icon?: IconName;
  count?: number;
  disabled?: boolean;
  hidden?: boolean;
}

/** Generic tabs in the template's workspace-nav style, with arrow-key navigation. */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  full = false,
}: {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  full?: boolean;
}) {
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const enabled = visible.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.key === value);
    const next =
      e.key === "Home"
        ? enabled[0]
        : e.key === "End"
          ? enabled[enabled.length - 1]
          : enabled[(idx + (e.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
    if (next) {
      onChange(next.key);
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.key}"]`)?.focus());
    }
  };

  return (
    <div ref={listRef} className={`tv-tabs ${full ? "is-full" : ""}`.trim()} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {visible.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            data-tab={item.key}
            id={`${base}-${item.key}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
          >
            {item.icon ? <Icon name={item.icon} /> : null}
            {item.label}
            {item.count !== undefined ? <span className="tv-tab-count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
