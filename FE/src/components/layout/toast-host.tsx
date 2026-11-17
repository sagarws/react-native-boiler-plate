"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons/icon";
import { TOAST_EVENT, type ToastDetail, type ToastTone } from "@/lib/events";

const toneIcon: Record<ToastTone, IconName> = { success: "check-circle", error: "x-circle", info: "info", warning: "warning" };
const toneColor: Record<ToastTone, string> = {
  success: "var(--tv-green)",
  error: "var(--tv-red)",
  info: "var(--tv-blue)",
  warning: "var(--tv-amber)",
};

/** Template toast, stacked (up to 3), each auto-dismissed after 4.5 s. */
export function ToastHost() {
  const [toasts, setToasts] = useState<ToastDetail[]>([]);
  const timers = useRef(new Map<number, number>());

  useEffect(() => {
    const map = timers.current;
    const onToast = (e: Event) => {
      if (!(e instanceof CustomEvent)) return;
      const t = e.detail as ToastDetail;
      setToasts((list) => [...list.slice(-2), t]);
      const id = window.setTimeout(() => {
        setToasts((list) => list.filter((x) => x.id !== t.id));
        map.delete(t.id);
      }, 4500);
      map.set(t.id, id);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      map.forEach((id) => window.clearTimeout(id));
      map.clear();
    };
  }, []);

  const region = typeof document === "undefined" ? null : document.getElementById("toast-region");
  if (!region || !toasts.length) return null;
  return createPortal(
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map((t) => (
        <div key={t.id} className="toast" style={{ display: "flex" }}>
          <span style={{ color: toneColor[t.tone], display: "inline-flex" }}>
            <Icon name={toneIcon[t.tone]} />
          </span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>,
    region,
  );
}
