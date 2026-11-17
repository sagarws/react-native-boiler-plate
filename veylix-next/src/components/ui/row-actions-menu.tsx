// @ts-nocheck
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons/icon";

const ROW_MENU_OPEN_EVENT = "veylix:commerce-row-menu-open";

let rowMenuIdCounter = 0;

export function RowActionsMenu({
  label,
  actions,
  triggerClassName = "",
  panelClassName = "",
  estimatedHeight = 300,
}) {
  const [a, o] = useState(null);
  const s = useRef(null);
  s.current ||= `commerce-row-menu-${++rowMenuIdCounter}`;
  const c = useRef(null);
  const u = useRef(null);
  const d = () => {
    const e = c.current;
    const t = u.current;
    if (!e || !a) return;
    const n = e.getBoundingClientRect();
    const r = document.documentElement.clientWidth;
    const s = document.documentElement.clientHeight;
    const l = t?.offsetWidth || 230;
    const d = Math.min(
      t?.scrollHeight || t?.offsetHeight || estimatedHeight,
      Math.max(120, s - 24),
    );
    let f = n.right - l;
    f = Math.max(12, Math.min(f, r - l - 12));
    let p = n.bottom + 8;
    if (p + d > s - 12) {
      p = Math.max(12, n.top - d - 8);
    }
    o({
      top: Math.round(p),
      left: Math.round(f),
    });
  };
  useLayoutEffect(() => {
    if (a) {
      d();
    }
  }, [!!a]);
  useEffect(() => {
    const e = (e) => {
      const t = e.detail;
      if (t && t !== s.current) {
        o(null);
      }
    };
    window.addEventListener(ROW_MENU_OPEN_EVENT, e);
    return () => window.removeEventListener(ROW_MENU_OPEN_EVENT, e);
  }, []);
  useEffect(() => {
    if (!a) return;
    const e = (e) => {
      if (!u.current?.contains(e.target) && !c.current?.contains(e.target)) {
        o(null);
      }
    };
    const t = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        o(null);
        c.current?.focus();
      }
    };
    const n = () => d();
    document.addEventListener("click", e);
    document.addEventListener("keydown", t, true);
    document.addEventListener("scroll", n, true);
    window.addEventListener("resize", n);
    return () => {
      document.removeEventListener("click", e);
      document.removeEventListener("keydown", t, true);
      document.removeEventListener("scroll", n, true);
      window.removeEventListener("resize", n);
    };
  }, [a]);
  const f = a ? (
    <div
      ref={u}
      className={`product-row-menu-panel catalog-row-menu-panel is-positioned ${panelClassName}`.trim()}
      role="menu"
      style={{
        "--row-menu-top": `${a.top}px`,
        "--row-menu-left": `${a.left}px`,
      }}
    >
      {actions.map((e, t) => (
        <Fragment key={`${e.label}-${t}`}>
          {e.separatorBefore ? <span className="product-menu-rule" /> : null}
          <button
            type="button"
            role="menuitem"
            className={e.danger ? "danger" : void 0}
            onClick={() => {
              o(null);
              e.onClick();
            }}
          >
            <Icon name={e.icon} />
            <span>{e.label}</span>
          </button>
        </Fragment>
      ))}
    </div>
  ) : null;
  return (
    <Fragment>
      <span
        className={`product-row-menu catalog-row-menu ${triggerClassName}`.trim()}
      >
        <button
          ref={c}
          type="button"
          className="product-row-menu-trigger"
          aria-label={`Open actions for ${label}`}
          aria-haspopup="menu"
          aria-expanded={!!a}
          onClick={(e) => {
            if ((e.stopPropagation(), a)) {
              o(null);
              return;
            }
            window.dispatchEvent(
              new CustomEvent(ROW_MENU_OPEN_EVENT, {
                detail: s.current || "",
              }),
            );
            const t = e.currentTarget.getBoundingClientRect();
            o({
              top: t.bottom + 8,
              left: Math.max(12, t.right - 230),
            });
          }}
        >
          <Icon name="dots-three-vertical" />
        </button>
      </span>
      {f && typeof document < "u" ? createPortal(f, document.body) : null}
    </Fragment>
  );
}
