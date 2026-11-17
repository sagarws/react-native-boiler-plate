// @ts-nocheck
import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons/icon";

export function AppDialog({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}) {
  const a = useRef(null);
  const o = useRef(null);
  const s = document.querySelector("#overlay-root");
  useLayoutEffect(() => {
    const e = a.current;
    if (e) {
      o.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      e.showModal();
      return () => {
        if (e.open) {
          e.close();
        }
        if (o.current?.isConnected) {
          o.current.focus();
        }
      };
    }
  }, []);
  return s
    ? createPortal(
        <dialog
          ref={a}
          className={`app-dialog ${wide ? "dialog-wide" : ""} ${className}`.trim()}
          aria-labelledby="dialog-title"
          onCancel={(e) => {
            e.preventDefault();
            onClose();
          }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            const t = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < t.left ||
              e.clientX > t.right ||
              e.clientY < t.top ||
              e.clientY > t.bottom
            ) {
              onClose();
            }
          }}
        >
          <header className="dialog-heading">
            <h2 id="dialog-title">{title}</h2>
            <button
              type="button"
              className="icon-button"
              data-action="close-dialog"
              aria-label="Close dialog"
              onClick={onClose}
            >
              <Icon name="x" />
            </button>
          </header>
          <div className="dialog-body">{children}</div>
        </dialog>,
        s,
      )
    : null;
}
