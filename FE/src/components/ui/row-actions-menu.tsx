"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons/icon";

const ROW_MENU_OPEN_EVENT = "trackvid:row-menu-open";

export interface RowAction {
  label: string;
  icon: IconName;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  hidden?: boolean;
}

interface Position {
  top: number;
  left: number;
}

let rowMenuCounter = 0;

/** Template row "…" menu, rendered in a portal and kept inside the viewport. */
export function RowActionsMenu({ label, actions }: { label: string; actions: readonly RowAction[] }) {
  const [pos, setPos] = useState<Position | null>(null);
  const idRef = useRef<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const visible = actions.filter((a) => !a.hidden);

  useEffect(() => {
    rowMenuCounter += 1;
    idRef.current = `row-menu-${rowMenuCounter}`;
  }, []);

  const place = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = panelRef.current?.offsetWidth || 230;
    const h = Math.min(panelRef.current?.scrollHeight || 260, Math.max(120, vh - 24));
    const left = Math.max(12, Math.min(r.right - w, vw - w - 12));
    let top = r.bottom + 8;
    if (top + h > vh - 12) top = Math.max(12, r.top - h - 8);
    setPos({ top: Math.round(top), left: Math.round(left) });
  };

  const open = pos !== null;

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    const onOther = (e: Event) => {
      if (e instanceof CustomEvent && e.detail !== idRef.current) setPos(null);
    };
    window.addEventListener(ROW_MENU_OPEN_EVENT, onOther);
    return () => window.removeEventListener(ROW_MENU_OPEN_EVENT, onOther);
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const { signal } = controller;
    document.addEventListener(
      "click",
      (e) => {
        const t = e.target;
        if (t instanceof Node && !panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setPos(null);
      },
      { signal },
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          setPos(null);
          triggerRef.current?.focus();
        }
      },
      { signal, capture: true },
    );
    document.addEventListener("scroll", () => setPos(null), { signal, capture: true });
    window.addEventListener("resize", () => setPos(null), { signal });
    return () => controller.abort();
  }, [open]);

  const panelStyle = pos ? ({ "--row-menu-top": `${pos.top}px`, "--row-menu-left": `${pos.left}px` } as CSSProperties) : undefined;

  return (
    <>
      <span className="product-row-menu catalog-row-menu">
        <button
          ref={triggerRef}
          type="button"
          className="product-row-menu-trigger"
          aria-label={`Open actions for ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            if (open) {
              setPos(null);
              return;
            }
            window.dispatchEvent(new CustomEvent(ROW_MENU_OPEN_EVENT, { detail: idRef.current }));
            const r = e.currentTarget.getBoundingClientRect();
            setPos({ top: r.bottom + 8, left: Math.max(12, r.right - 230) });
          }}
        >
          <Icon name="dots-three-vertical" />
        </button>
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div ref={panelRef} className="product-row-menu-panel catalog-row-menu-panel is-positioned" role="menu" style={panelStyle}>
              {visible.map((a, i) => (
                <Fragment key={`${a.label}-${i}`}>
                  {a.separatorBefore ? <span className="product-menu-rule" /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    className={a.danger ? "danger" : undefined}
                    disabled={a.disabled}
                    onClick={() => {
                      setPos(null);
                      a.onClick();
                    }}
                  >
                    <Icon name={a.icon} />
                    <span>{a.label}</span>
                  </button>
                </Fragment>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
