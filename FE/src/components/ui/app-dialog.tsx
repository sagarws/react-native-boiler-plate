"use client";

import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons/icon";

export type DialogSize = "sm" | "md" | "wide" | "xl";

interface AppDialogProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: DialogSize;
  className?: string;
  /** Rendered under the body, right aligned (buttons). */
  footer?: ReactNode;
  /** Block closing with Escape / backdrop (e.g. while saving). */
  locked?: boolean;
}

const sizeClass: Record<DialogSize, string> = { sm: "dialog-sm", md: "", wide: "dialog-wide", xl: "dialog-xl" };

/** Template modal (`app-dialog`): native <dialog>, focus returns to the opener on close. */
export function AppDialog({ title, onClose, children, size = "md", className = "", footer, locked = false }: AppDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const root = typeof document === "undefined" ? null : document.getElementById("overlay-root");

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  if (!root) return null;
  return createPortal(
    <dialog
      ref={ref}
      className={`app-dialog ${sizeClass[size]} ${className}`.replace(/\s+/g, " ").trim()}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(e) => {
        if (locked || e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}
    >
      <header className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={locked}>
          <Icon name="x" />
        </button>
      </header>
      <div className="dialog-body">
        {children}
        {footer ? <div className="tv-dialog-footer">{footer}</div> : null}
      </div>
    </dialog>,
    root,
  );
}
