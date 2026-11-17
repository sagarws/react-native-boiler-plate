// @ts-nocheck
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { legacyPathAliases } from "@/config/navigation";
import { navigate, resolveRoute } from "@/lib/navigation";

const staticRoutePaths = legacyPathAliases;

/**
 * Resolves the current Next.js URL into the Veylix route record
 * ({ path, params, route }).
 */
export function useRoute() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  return useMemo(
    () => resolveRoute(`${pathname}${search ? `?${search}` : ""}`),
    [pathname, search],
  );
}

/**
 * Sends clicks on plain internal `<a href>` links (for example links inside
 * rendered HTML) through the Next.js router. `next/link` links handle
 * themselves and are skipped because they call preventDefault first.
 */
export function useInternalLinkNavigation() {
  useEffect(() => {
    const n = (e) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const t = e.target?.closest("a[href]");
      if (
        !t ||
        t.target === "_blank" ||
        t.hasAttribute("download") ||
        (t.getAttribute("href") || "").startsWith("#")
      )
        return;
      const n = new URL(t.href, location.href);
      if (n.origin !== location.origin) return;
      const r = resolveRoute(n.toString());
      if (r.path === "/overview" || r.route || staticRoutePaths[r.path]) {
        e.preventDefault();
        navigate(`${r.path}${n.search}`);
      }
    };
    document.addEventListener("click", n);
    return () => document.removeEventListener("click", n);
  }, []);
}
