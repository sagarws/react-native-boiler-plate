// @ts-nocheck
import { modulePath } from "@/config/modules/registry";
import { legacyPathAliases, navigationRoutes } from "@/config/navigation";

const knownRoutes = navigationRoutes;

const pathAliases = legacyPathAliases;

const BASE_PATH = "";

function normalizePathname(e) {
  return e || "/";
}

export function buildHref(e = "/overview") {
  const t = String(e || "/overview");
  return `${BASE_PATH}${t.startsWith("/") ? t : `/${t}`}` || "/";
}

export function resolveRoute(e = `${location.pathname}${location.search}`) {
  const t = e instanceof URL ? e : new URL(String(e), location.origin);
  const n = normalizePathname(t.pathname) || "/";
  const r = pathAliases[n]
    ? modulePath(pathAliases[n])
    : n === "/"
      ? "/overview"
      : n;
  return {
    path: r,
    params: new URLSearchParams(t.search),
    route: knownRoutes.find((e) => e.path === r),
  };
}

/**
 * Next.js App Router instance, registered by the app shell on mount.
 * Plain functions (event handlers, store actions) navigate through it.
 */
let appRouter = null;

export function registerAppRouter(router) {
  appRouter = router;
}

/**
 * Client-side navigation. When the URL changes, the app shell dispatches
 * `veylix:navigate` once Next.js has committed the new route; navigating to
 * the current URL dispatches it straight away so listeners still refresh.
 */
export function navigate(e, { replace = false } = {}) {
  const n = new URL(buildHref(e), location.origin);
  const r = `${location.pathname}${location.search}`;
  const i = `${n.pathname}${n.search}`;
  if (r === i) {
    window.dispatchEvent(new Event("veylix:navigate"));
    return;
  }
  if (appRouter) {
    if (replace) appRouter.replace(i, { scroll: false });
    else appRouter.push(i, { scroll: false });
    return;
  }
  history[replace ? "replaceState" : "pushState"](null, "", i);
  window.dispatchEvent(new Event("veylix:navigate"));
}
