// @ts-nocheck
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { OverlayHost } from "@/components/layout/overlay-host";
import { Sidebar } from "@/components/layout/sidebar";
import { ToastHost } from "@/components/layout/toast-host";
import { Topbar } from "@/components/layout/topbar";
import { useInternalLinkNavigation, useRoute } from "@/components/layout/use-route";
import { translateDom } from "@/i18n/translate";
import { registerAppRouter } from "@/lib/navigation";
import { findPeriodOption } from "@/lib/period";
import { readStoredValue } from "@/lib/storage";

const PeriodContext = createContext(null);

/** The dashboard reporting period chosen in the topbar (7, 30, 90 days…). */
export function usePeriod() {
  return useContext(PeriodContext);
}

/** Keeps the Next.js router reachable from plain navigation helpers and
 * announces committed URL changes with the original `veylix:navigate` event. */
function useRouterBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const isFirstRender = useRef(true);
  useEffect(() => {
    registerAppRouter(router);
    return () => registerAppRouter(null);
  }, [router]);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.dispatchEvent(new Event("veylix:navigate"));
  }, [pathname, search]);
}

export default function AppShell({ children }) {
  const e = useRoute();
  useRouterBridge();
  useInternalLinkNavigation();
  const [t, n] = useState(() =>
    findPeriodOption(readStoredValue("period", "30")),
  );
  const [, r] = useState(0);
  const i = useMemo(
    () => e.route?.parentPath || e.path,
    [e.route?.parentPath, e.path],
  );
  const a =
    typeof window < "u" &&
    window.innerWidth >= 768 &&
    readStoredValue("sidebar-collapsed", false);
  useEffect(() => {
    if (readStoredValue("solid-glass", false)) {
      document.body.classList.add("solid-glass");
    } else {
      document.body.classList.remove("solid-glass");
    }
  }, []);
  useEffect(() => {
    const e = (e) => {
      const t = e.detail;
      n(findPeriodOption(t));
    };
    const t = () => r((e) => e + 1);
    window.addEventListener("veylix:period", e);
    window.addEventListener("veylix:profile", t);
    window.addEventListener("veylix:locale", t);
    window.addEventListener("veylix:branding", t);
    window.addEventListener("veylix:commerce", t);
    return () => {
      window.removeEventListener("veylix:period", e);
      window.removeEventListener("veylix:profile", t);
      window.removeEventListener("veylix:locale", t);
      window.removeEventListener("veylix:branding", t);
      window.removeEventListener("veylix:commerce", t);
    };
  }, []);
  useEffect(() => translateDom(document.getElementById("app")), []);
  return (
    <PeriodContext.Provider value={t}>
      <div className={`app-shell${a ? " collapsed" : ""}`}>
        <Sidebar activePath={i} />
        <div className="workspace">
          <Topbar period={t} />
          {children}
          <OverlayHost period={t} />
          <ToastHost />
        </div>
      </div>
    </PeriodContext.Provider>
  );
}
