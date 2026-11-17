// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { GlobalSearchDialog } from "@/components/layout/global-search-dialog";
import {
  MobileMenuButton,
  SearchTrigger,
} from "@/components/layout/header-controls";
import { HeaderMetrics } from "@/components/layout/header-metrics";
import { LanguageMenu } from "@/components/layout/language-menu";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { PeriodMenu } from "@/components/layout/period-menu";
import { ProfileMenu } from "@/components/layout/profile-menu";

function getHeaderPopoverFocusables(e) {
  return e
    ? Array.from(
        e.querySelectorAll(
          ".header-popover button:not(:disabled),.header-popover a",
        ),
      )
    : [];
}

export function Topbar({ period }) {
  const t = useRef(null);
  const n = useRef(null);
  const [r, i] = useState();
  const [a, o] = useState(false);
  const s = useRef(null);
  const [c, u] = useState(() => typeof window < "u" && window.scrollY > 12);
  function d(e = false) {
    const t = n.current;
    i(void 0);
    if (e) {
      requestAnimationFrame(() => t?.focus());
    }
  }
  function f(e, t) {
    if (r === e) {
      d();
    } else {
      n.current = t;
      i(e);
    }
  }
  useEffect(() => {
    const e = new AbortController();
    const { signal } = e;
    let n = 0;
    const r = (e) => {
      const t = e.target;
      if (t instanceof Element && !t.closest(".header-menu-wrap")) {
        d();
      }
    };
    const i = () => {
      n ||= requestAnimationFrame(() => {
        n = 0;
        u(window.scrollY > 12);
      });
    };
    const a = () => {
      d();
      o(false);
    };
    document.addEventListener("click", r, {
      signal: signal,
    });
    window.addEventListener("scroll", i, {
      signal: signal,
      passive: true,
    });
    window.addEventListener("popstate", a, {
      signal: signal,
    });
    window.addEventListener("veylix:navigate", a, {
      signal: signal,
    });
    window.addEventListener(
      "veylix:search",
      () => {
        s.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        d();
        o(true);
      },
      {
        signal: signal,
      },
    );
    return () => {
      e.abort();
      if (n) {
        cancelAnimationFrame(n);
      }
    };
  }, []);
  function p(e = false) {
    if ((o(false), e)) {
      const e = s.current;
      requestAnimationFrame(() => {
        if (e?.isConnected) {
          e.focus();
        }
      });
    }
  }
  function m(e) {
    const a = (e.target instanceof Element ? e.target : null)?.closest(
      "[data-header-menu]",
    );
    if (!r && a && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const r = a.dataset.headerMenu;
      n.current = a;
      i(r);
      requestAnimationFrame(() => {
        const n = getHeaderPopoverFocusables(t.current);
        (e.key === "ArrowDown" ? n[0] : n.at(-1))?.focus();
      });
      return;
    }
    if (!r) return;
    if (e.key === "Escape") {
      e.preventDefault();
      d(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const o = getHeaderPopoverFocusables(t.current);
    if (
      !o.length ||
      !(document.activeElement instanceof HTMLElement) ||
      !t.current?.contains(document.activeElement)
    )
      return;
    e.preventDefault();
    const s = o.indexOf(document.activeElement);
    o[
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? o.length - 1
          : s < 0
            ? e.key === "ArrowDown"
              ? 0
              : o.length - 1
            : (s + (e.key === "ArrowDown" ? 1 : -1) + o.length) % o.length
    ]?.focus();
  }
  function h(e) {
    if (r && e.relatedTarget && e.relatedTarget instanceof Node) {
      if (!n.current?.parentElement?.contains(e.relatedTarget)) {
        d();
      }
    }
  }
  return (
    <header
      ref={t}
      className={`topbar${c ? " is-scrolled" : ""}`}
      onKeyDown={m}
      onBlur={h}
    >
      <MobileMenuButton />
      <div className="header-primary">
        <SearchTrigger />
        <HeaderMetrics period={period} />
      </div>
      <div className="header-tools">
        <PeriodMenu
          period={period}
          open={r === "period"}
          onToggle={(e) => f("period", e)}
          onClose={d}
        />
        <LanguageMenu
          open={r === "language"}
          onToggle={(e) => f("language", e)}
          onClose={d}
        />
        <NotificationsMenu
          open={r === "notifications"}
          onToggle={(e) => f("notifications", e)}
          onClose={d}
        />
        <ProfileMenu
          open={r === "profile"}
          onToggle={(e) => f("profile", e)}
          onClose={d}
        />
      </div>
      {a ? <GlobalSearchDialog open onClose={p} /> : null}
    </header>
  );
}
