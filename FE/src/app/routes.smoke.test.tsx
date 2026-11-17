/**
 * Runtime smoke test: mounts every route's page inside the Redux store (signed-in sample user) with a
 * mocked Next router, lets the mock services resolve, and fails on render errors or console.error.
 * Covers what `next build` cannot (pages are client-rendered).
 */
import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider } from "react-redux";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ search: "", params: {} as Record<string, string> }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(nav.search),
  useParams: () => nav.params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/link", () => ({
  // Strip Link-only props so they are not written to <a>.
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => {
    const attrs = Object.fromEntries(Object.entries(rest).filter(([k]) => !["replace", "scroll", "prefetch"].includes(k)));
    return createElement("a", { href: String(href), ...attrs }, children);
  },
}));

// Browser APIs jsdom does not implement.
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.assign(window, { ResizeObserver: NoopObserver, IntersectionObserver: NoopObserver });
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.scrollTo = (() => undefined) as Element["scrollTo"];
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => undefined;
  HTMLMediaElement.prototype.load = () => undefined;
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
  // Node's experimental global localStorage shadows jsdom's; use an in-memory Storage.
  const mem = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return mem.size;
    },
    clear: () => mem.clear(),
    getItem: (k) => mem.get(k) ?? null,
    key: (i) => [...mem.keys()][i] ?? null,
    removeItem: (k) => void mem.delete(k),
    setItem: (k, v) => void mem.set(k, String(v)),
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => undefined;
  for (const id of ["overlay-root", "toast-region"]) {
    const el = document.createElement("div");
    el.id = id;
    document.body.appendChild(el);
  }
});

// Messages that come from jsdom limits, not from our code.
const IGNORED = [/Failed to create chart/i, /Not implemented: (HTMLCanvasElement|navigation|window\.(scrollTo|print))/i, /Error: Could not parse CSS stylesheet/i];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const errors: string[] = [];
const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  const msg = args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ""}` : String(a))).join(" ");
  if (!IGNORED.some((r) => r.test(msg))) errors.push(msg);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

afterAll(() => spy.mockRestore());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Loader = () => Promise<{ default: ComponentType }>;

const ROUTES: [string, Loader, string?, Record<string, string>?][] = [
  ["/", () => import("@/app/(dashboard)/page")],
  ["/profile", () => import("@/app/(dashboard)/profile/page")],
  ["/profile?tab=change_password", () => import("@/app/(dashboard)/profile/page"), "tab=change_password"],
  ["/manage-users", () => import("@/app/(dashboard)/manage-users/page")],
  ["/manage-roles", () => import("@/app/(dashboard)/manage-roles/page")],
  ["/settings", () => import("@/app/(dashboard)/settings/page")],
  ["/settings?tab=integrations", () => import("@/app/(dashboard)/settings/page"), "tab=integrations"],
  ["/integrations", () => import("@/app/(dashboard)/integrations/page")],
  ["/integrations?provider=myntra", () => import("@/app/(dashboard)/integrations/page"), "provider=myntra"],
  ["/refer-and-earn", () => import("@/app/(dashboard)/refer-and-earn/page")],
  ["/video-link", () => import("@/app/(dashboard)/video-link/page")],
  ["/feed", () => import("@/app/(dashboard)/feed/page")],
  ["/pending-failed-orders", () => import("@/app/(dashboard)/pending-failed-orders/page")],
  ["/system-admin", () => import("@/app/(dashboard)/system-admin/page")],
  ["/account-summary", () => import("@/app/(dashboard)/account-summary/page")],
  ["/account-summary?tab=my_usage", () => import("@/app/(dashboard)/account-summary/page"), "tab=my_usage"],
  ["/master-data", () => import("@/app/(dashboard)/master-data/page")],
  ["/sku", () => import("@/app/(dashboard)/sku/page")],
  ["/imports", () => import("@/app/(dashboard)/imports/page")],
  ["/emails", () => import("@/app/(dashboard)/emails/page")],
  ["/emails?tab=mailboxes", () => import("@/app/(dashboard)/emails/page"), "tab=mailboxes"],
  ["/mailboxes/:id/logs", () => import("@/app/(dashboard)/mailboxes/[mailboxId]/logs/page"), "", { mailboxId: "mbx000000000000000000001" }],
  ["/cms", () => import("@/app/(dashboard)/cms/page")],
  ["/rms", () => import("@/app/(dashboard)/rms/page")],
  ["/vms", () => import("@/app/(dashboard)/vms/page")],
  ["/favorite", () => import("@/app/(dashboard)/favorite/page")],
  ["/support", () => import("@/app/(dashboard)/support/page")],
  ["/whats-new", () => import("@/app/(dashboard)/whats-new/page")],
  ["/cms/create", () => import("@/app/(dashboard)/cms/create/page")],
  ["/cms/update", () => import("@/app/(dashboard)/cms/update/page"), "awb=1490823311&platform=Ajio"],
  ["404", () => import("@/app/(dashboard)/[...unknownPath]/page")],
  ["/auth/login", () => import("@/app/(auth)/auth/login/page")],
  ["/auth/register", () => import("@/app/(auth)/auth/register/[[...companyId]]/page")],
  ["/auth/subuser-register", () => import("@/app/(auth)/auth/subuser-register/page"), "email=a@b.in&token=abc"],
  ["/auth/forgot-password", () => import("@/app/(auth)/auth/forgot-password/page")],
  ["/auth/reset-password", () => import("@/app/(auth)/auth/reset-password/page"), "token=abc"],
  ["/auth/invitation", () => import("@/app/(auth)/auth/invitation/page"), "token=abc&email=a@b.in"],
  ["/impersonate/:id", () => import("@/app/impersonate/[userId]/page"), "", { userId: "64f0c0ffee0000000000a001" }],
  ["/oauth/zoho/callback", () => import("@/app/oauth/zoho/callback/page"), "code=x&state=y"],
];

describe("every route mounts without runtime errors", () => {
  it.each(ROUTES)("%s", async (_name, load, search = "", params = {}) => {
    nav.search = search;
    nav.params = params;
    errors.length = 0;
    const [{ default: Page }, { makeStore }, { setUserProfile }, { sampleUser }] = await Promise.all([
      load(),
      import("@/store"),
      import("@/store/profile-slice"),
      import("@/mocks/user"),
    ]);
    const store = makeStore();
    store.dispatch(setUserProfile(structuredClone(sampleUser)));
    host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    root = r;
    await act(async () => {
      r.render(<Provider store={store}>{createElement(Page)}</Provider>);
    });
    await act(async () => {
      await wait(2200);
    });
    expect(host.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(errors, errors.join("\n---\n")).toEqual([]);
  }, 20000);
});

describe("dashboard shell", () => {
  it("mounts sidebar, topbar, banners and a page for a signed-in user", async () => {
    nav.search = "";
    nav.params = {};
    errors.length = 0;
    window.localStorage.setItem("trackvid-ui:token", JSON.stringify("mock.token"));
    const [{ default: AppShell }, { makeStore }, { ComingSoon }] = await Promise.all([
      import("@/components/layout/app-shell"),
      import("@/store"),
      import("@/components/layout/coming-soon"),
    ]);
    const store = makeStore();
    host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    root = r;
    await act(async () => {
      r.render(
        <Provider store={store}>
          <AppShell>
            <ComingSoon title="Smoke" />
          </AppShell>
        </Provider>,
      );
    });
    await act(async () => {
      await wait(1500);
    });
    expect(host.querySelector(".sidebar")).not.toBeNull();
    expect(host.querySelector(".topbar")).not.toBeNull();
    expect(host.querySelectorAll(".nav-link").length).toBeGreaterThan(10);
    expect(errors, errors.join("\n---\n")).toEqual([]);
    window.localStorage.removeItem("trackvid-ui:token");
  }, 20000);
});
