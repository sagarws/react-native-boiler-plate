// @ts-nocheck

export function syncSidebarAccessibility() {
  const e = document.querySelector(".app-shell");
  const t = document.querySelector(".sidebar");
  const n = document.querySelector(".mobile-menu");
  const r = document.querySelector(".sidebar-collapse");
  if (!e || !t || !n || !r) return;
  const i = window.innerWidth < 768;
  const a = e.classList.contains("mobile-nav-open");
  t.inert = i && !a;
  n.setAttribute("aria-expanded", String(a));
  const o = e.classList.contains("collapsed");
  r.setAttribute("aria-expanded", String(!o));
  r.setAttribute("aria-label", o ? "Expand sidebar" : "Collapse sidebar");
}

export function closeMobileSidebar() {
  const e = document.querySelector(".app-shell");
  if (e) {
    e.classList.remove("mobile-nav-open");
    document
      .querySelector(".mobile-menu")
      ?.setAttribute("aria-expanded", "false");
    syncSidebarAccessibility();
  }
}
