# Veylix admin dashboard (Next.js)

A Next.js App Router version of the Veylix ecommerce admin dashboard. The design and behaviour match the original build in `../resource/veylix-react.vercel.app`.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
```

## How it is organised

```
src/
  app/                     App Router: routes, metadata, layouts
    layout.tsx             <html>, global styles, #app / #overlay-root / #toast-region
    (dashboard)/layout.tsx shared shell (sidebar, topbar, dialogs, toasts)
    (dashboard)/overview/
    (dashboard)/commerce/[moduleId]/        one prerendered page per module
    (dashboard)/commerce/products/          product list
    (dashboard)/commerce/products/[editorMode]/  product editor (new | edit)
    (dashboard)/[...unknownPath]/           in-shell "Page not found"
  components/
    layout/                app shell, sidebar, topbar, header menus, router bridge
    ui/                    shared UI (dialog, field, pagination, status pills…)
    charts/                Chart.js setup and tooltip
    icons/                 SVG icon set and <Icon>
  features/<domain>/       page components, dialogs and logic per area
  config/                  navigation, module (page) definitions, route groups
  data/                    dashboard sample data
  i18n/                    locales, dictionary, DOM translator
  lib/                     storage, store, navigation, events, formatting, CSV…
  styles/                  the original stylesheet, split by area (index.css sets the order)
docs/inventory.md          route, page and data inventory
```

## How it works

- **Routing.** Each URL is a real App Router route with its own `<title>` (`<Page> | Veylix`). The short URLs from the original (`/orders`, `/products`, `/shipping` …) redirect to their pages, and `/` redirects to `/overview`. Navigation goes through the Next.js router: internal links are `next/link`, and code calls `navigate()` in `src/lib/navigation.ts`.
- **Client-only dashboard.** Route files and layouts are server components. The dashboard itself loads with `ssr: false` (see `components/layout/dashboard-shell.tsx` and `route-view.tsx`), because it reads `localStorage`, IndexedDB and the window size while rendering, just like the original. This keeps the markup identical and avoids hydration mismatches.
- **Data.** All data is local sample data kept in the browser (`localStorage` keys start with `veylix:`). There is no backend.
- **Styles.** The original CSS is split into ordered files under `src/styles`. Keep the import order in `src/styles/index.css`, because later files override earlier ones.

## Types and lint

The page and feature code was converted from the original production bundle. Each converted file starts with `// @ts-nocheck`. Remove that line once a file has real types. The route files and the integration layer are fully typed: `src/app`, `config/route-manifest.ts`, `components/charts/chart-setup.ts`, `components/layout/dashboard-shell.tsx` and `components/layout/route-view.tsx`. `npm run lint` passes with warnings. The warnings flag React patterns that were kept from the original on purpose, so they work as a to-do list.
