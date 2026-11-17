// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons/icon";
import { TOAST_EVENT } from "@/lib/events";

export function ToastHost() {
  const [e, t] = useState("");
  const n = useRef(void 0);
  const r =
    typeof document > "u" ? null : document.querySelector("#toast-region");
  useEffect(() => {
    const e = (e) => {
      const r = e.detail;
      window.clearTimeout(n.current);
      t(String(r || ""));
      n.current = window.setTimeout(() => t(""), 4500);
    };
    window.addEventListener(TOAST_EVENT, e);
    return () => {
      window.removeEventListener(TOAST_EVENT, e);
      window.clearTimeout(n.current);
    };
  }, []);
  return !r || !e
    ? null
    : createPortal(
        <div className="toast">
          <Icon name="check-circle" />
          <span>{e}</span>
        </div>,
        r,
      );
}
