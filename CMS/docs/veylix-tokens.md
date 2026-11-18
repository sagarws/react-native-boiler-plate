# Veylix tokens (read from the template CSS)

Source: `/Users/apple/Documents/Sagar/Other/veylix-next/src/styles/**` (read only), read 2026-11-17.
Every visual value used by `electron/renderer/theme/veylixTheme.ts` comes from this table. Values are copied
verbatim (8-digit hex = colour + alpha). "Derived" rows are the dark-mode values, which the template does not have.

## Type

| Token | Value | Source |
|---|---|---|
| Font family | `"Manrope Variable", "Segoe UI", sans-serif`, weights 200–800 | `base/tailwind-layers.css` `--font-sans`; `base/document.css` `@font-face` |
| Font file | `public/assets/manrope-latin-wght-normal-DHIcAJRg.woff2` | `base/document.css` |
| Body size | 14px (`--font-body`), heading 17px (`--font-heading`), caption 14px | `base/foundation.css :root` |
| Page title (dashboard) | 28–40px (`clamp(28px, 2.05vw, 40px)`), weight 800, letter-spacing −1.6px, line-height 1.2 | `foundation.css .page-title h1` |
| Page title (commerce pages) | 28px, weight 750, letter-spacing −0.8px, line-height 1.25 | `commerce-ui.css .commerce-heading h1` |
| Title accent "." | `#dba923` (commerce) / `#d6a223` (dashboard) | `.commerce-heading h1 > span`, `.heading-dot` |
| Dialog title | 18px, letter-spacing −0.5px | `dialogs-search-toast.css .dialog-heading h2` |
| Empty-state title | 19px, weight 750, colour `#474235` | `.c-empty h3` |
| Summary figure | 22–30px, weight 800, letter-spacing −0.6px | `.c-summary strong` |
| Label / field | 14px, weight 650, colour `#5d574b` | `.c-field` |
| Badge / status | 14px, weight 650, line-height 1.4 | `.badge`, `.c-status` |
| Button | 14px, weight 800 | `.primary-button, .secondary-button` |
| Nav link | 14px, weight 600 | `.nav-link`, `.nav-label` |

## Colour — text

| Token | Value | Source |
|---|---|---|
| Text primary | `#25251f` | `foundation.css :root color` |
| Text secondary | `#696b61` (`--text-secondary`) | `foundation.css :root` |
| Muted / caption | `#857b6a` (empty text), `#82796b` (pagination), `#8a8275` (record sub-line), `#958b78` (placeholder) | `commerce-ui.css` |
| Breadcrumb | `#756c5c` | `.commerce-breadcrumb` |
| Accent text (hover / links) | `#805b12` | `.text-link:hover` |
| Accent text (sorted column, icons) | `#a97813`, `#b58215` (checkbox `accent-color`) | `.c-table th[aria-sort]`, `input[type=checkbox]` |
| Error text | `#aa3e26` | `.c-form .c-form-error` |

## Colour — accent (gold)

| Token | Value | Source |
|---|---|---|
| Primary fill | `linear-gradient(120deg, #ffda75, #f5bc34)`, border `#f4ba30`, text `#49340b` | `.primary-button` |
| Primary hover | `#ffd16a` | `.primary-button:hover` |
| Primary shadow | `inset 0 1px 1px #fff7, 0 3px 6px #c28c1721` | `.primary-button` |
| **primaryColorConfig entry** | main `#F5BC34`, light `#FFDA75`, dark `#B58215` | from the three rows above |
| Selection band | `#fff2c9` | `.c-selection` |
| Nav active | `linear-gradient(115deg, #ffe387ef, #fff2bfdb)`, border `#fffde9`, text `#554014`, shadow `0 3px 9px #c7992430, inset 0 1px 4px #fff9`, bar `#e8b025` 3px | `shell-sidebar.css .nav-link.active` |
| Avatar | `linear-gradient(120deg, #ffe08a, #fabc27)`, text `#302817`, 3px white ring | `document.css .avatar` |
| Brand mark | `linear-gradient(125deg, #ffeaa5, #efb425 66%, #d49b1c)` | `.brand-mark` |

## Colour — status (badge / c-status)

| Tone | Text | Fill | Source |
|---|---|---|---|
| success / green | `#0b7843` (badge) · `#23744d` (c-status) | `#d9f5e1` · `#d7f4e1` | `.badge-success`, `.c-status.green` |
| info / blue | `#0766a6` · `#386986` | `#e1f0ff` · `#e1eef6` | `.badge-info`, `.c-status.blue` |
| warning / amber | `#835b10` · `#866319` | `#fff0b9` · `#fff0c6` | `.badge-amber`, `.c-status.amber` |
| error / red / coral | `#b54124` · `#ab4932` | `#ffeadf` · `#ffe5db` | `.badge-danger`, `.c-status.red` |
| neutral | `#555950` | `#eeeee8` | `.badge-neutral` |
| Icon tiles | success `#14804b`/`#dff5e8`, info `#187cb5`/`#e1f1fd`, danger `#d35b37`/`#ffebe1`, neutral `#50534a`/`#eaeae4`, amber `#95610d`/`linear-gradient(130deg,#fff0b8,#ffdc72)` | `.tile-*` (36×36, radius 11px) |
| Status dot | `#34bf78` | `.status-dot` |
| Progress | track `#dadcd24d`, fill `#44bf81`, amber fill `#f6b727`, radius 8px, height 6px | `.progress-*` |
| Palette mains used for MUI `success/info/warning/error` | `#34bf78`, `#187cb5`, `#f6b727`, `#d35b37` | dot, tile-info, fill-amber, tile-danger |

## Surfaces

| Token | Value | Source |
|---|---|---|
| Page background | `#e9dfce` + `radial-gradient(at 2% 12%, #b7a48766, #0000 42%), radial-gradient(at 58% 58%, #ffe4a352, #0000 48%), radial-gradient(at 100% 22%, #f9f7f1cf, #0000 46%), linear-gradient(115deg, #dfd2bd, #f4ecdd 40%, #e8dec9 75%, #f4eee3)`, `background-attachment: fixed` | `document.css body` |
| Glass card | `linear-gradient(135deg, #fffdf9ed, var(--glass-fill))`, `--glass-fill: #fffef9c2`, border 1px `#fffffff2`, radius 16px, padding 20px, shadow `0 5px 18px -9px #775e2d24, inset 0 1px 0 #fff`, `backdrop-filter: blur(16px)` | `foundation.css .glass-card` |
| Solid fallback | `#fcfaf5` | `.solid-glass .glass-card`, `prefers-reduced-transparency` |
| Summary tile | `linear-gradient(130deg, #fffaf0bd, #ffffffa3)`, border `#ffffffeb`, radius 17px, padding 20px, shadow `0 7px 17px #735b2510` | `.c-summary > div` |
| Chrome (sidebar / top-bar pills) | `linear-gradient(135deg, #fffefab8, #d7c4aa6b 48%, #faf4e89e)`, border 1px `#ffffffe6`, shadow `0 8px 28px -14px #6649244d, inset 0 1px 2px #fffffff2, inset 0 -1px 1px #ad895626`, `backdrop-filter: blur(24px) saturate(135%)` | `--chrome-fill`, `--chrome-shadow`, `.sidebar` |
| Popover / menu | `linear-gradient(135deg, #fffcf7fa, #f4ead9fa)`, border `#fff`, radius 20px, padding 9px, shadow `0 18px 45px #59442629, inset 0 1px 1px #fff`, blur 28px; item radius 12px, min-height 44px, hover `#fff8`, checked `#ffe9b3a8` / `#694d16` | `topbar.css .header-popover` |
| Dialog | `#fcfaf3f7`, border 1.5px `#fff`, radius 23px, width `min(620px, 100vw − 32px)` (wide 850px), shadow `0 25px 100px #58462235`, blur 30px; backdrop `#40371f33` blur 6px | `.app-dialog` |
| Dialog header | padding 19px 23px, bottom border `#cabc9c36` | `.dialog-heading` |
| Dialog body | padding 22px 24px 26px; body copy `#746d5e` | `.dialog-body` |
| Toast | `#fffdf6`, border `#eee0bc`, radius 13px, padding 13px 18px, shadow `0 10px 40px #62532933`, icon `#25975d`, bottom-right 23/24px | `#toast-region`, `.toast` |
| Divider / hairline | `#e9dfce` (details), `#eadfcf` (toolbar), `#e9e0cf` (fieldset), `#cabc9c36` (dialog) | `commerce-ui.css` |
| Form note | `#f0eadc` fill, `#74664b` text, radius 9px | `.form-note` |

## Controls

| Token | Value | Source |
|---|---|---|
| Button shape | radius 10px, min-height 41px, padding 10px 17px, gap 7px, `:active` scale .98 | `.primary-button, .secondary-button` |
| Secondary button | `#fff`, border `#e4dece` | `.secondary-button` |
| Icon button | 38×38, radius 10px, hover `#c7bca426`, active scale .95 | `document.css .icon-button` |
| Input (form) | `#fffdf6bf`, border `#e1d7c5`, radius 11px, padding 12px 13px, text `#3a382f` | `.c-field input` |
| Input (dialog) | `#fff`, border `#d9d0bb`, radius 9px, padding 11px 12px | `.field input` |
| Search | `#f3efe55c`, border `#e7decca6`, radius 12px, height 42px, max-width 410px, icon `#7b7466` | `.c-search` |
| Select | `#fffdf5b3`, border `#e7decc`, radius 10px, padding 9px 12px, text `#5c574c` | `.c-toolbar select` |
| Checkbox / radio | `accent-color: #b58215`, 16×16 | `input[type=checkbox]` |
| kbd | `#dedad438`, border `#e0dcd666`, radius 6px | `kbd` |

## Table

| Token | Value | Source |
|---|---|---|
| Header cell | `--text-secondary`, 14px, weight 600, padding `0 12px 2px`, nowrap | `foundation.css th` |
| Body cell | padding 14px 12px, 14px, line-height 1.5 | `td`, `.c-table td` |
| Rows | separated (`border-spacing: 0 10px`), each row a rounded band (12px ends), tinted in a 5-step cycle: mint `#e2f4e9a6`, blue `#e6eff8a6`, lilac `#f1e9f5a6`, peach `#fbede0b3`, sand `#f6f1dcb8` | `foundation.css table, tr:nth-child(5n+…)` |
| Resource page | table inside one glass card, toolbar padded 14px with bottom border `#eadfcf`, table inset 14px | `resource-page.css .c-resource` |
| Pagination | `#82796b`, 14px, gap 20px, padding-top 16px; secondary buttons 34px high | `.c-pagination` |
| Empty | centred, padding 65px 20px, icon `#c7a654` 36px, title 19/750 `#474235`, body `#857b6a` max 420px | `.c-empty` |

## Layout

| Token | Value | Source |
|---|---|---|
| Sidebar width | 248px | `--sidebar-width` |
| Shell inset | 16px | `--shell-inset` |
| Grid gap | 16px | `--grid-gap` |
| Top bar height | 64px; inner control height 46px | `--topbar-height`, `--header-control-height` |
| Sidebar | fixed, inset 16px, radius 30px, padding 18px 0 10px | `.sidebar` |
| Nav link | radius 13px, min-height 40px, padding 7px, gap 9px, text `#524e44`, hover `#fff7` / `#28271f` | `.nav-link` |
| Nav group label | `#514c42`, 14px / 750 | `.nav-group-label` |
| Sidebar footer | `#6d6251`, 14px | `.sidebar-footer` |
| Top bar pills | `.header-primary` / `.header-tools`: chrome fill, radius 27px, padding 8px; scrolled backdrop `#eee5d6f5` | `shell-sidebar.css`, `topbar.css` |
| Page heading | margin `12px 4px 22px`, breadcrumb gap 7px, mb 10px | `.commerce-heading` |

## Dark mode (derived — the template has no dark mode)

Same accent, warm espresso surfaces, cream text. Alpha and gradient structure mirror the light tokens.

| Token | Value |
|---|---|
| Page background | `#1b1712` + `radial-gradient(at 2% 12%, #5a462c66, #0000 42%), radial-gradient(at 58% 58%, #6b501c33, #0000 48%), linear-gradient(115deg, #17140f, #221c15 40%, #1a1611 75%, #211b14)` |
| Paper / card | `linear-gradient(135deg, #2a241ced, #231e17c2)`, border `#ffffff14`, shadow `0 5px 18px -9px #00000080, inset 0 1px 0 #ffffff0f` |
| Chrome | `linear-gradient(135deg, #2c251cb8, #3a2f216b 48%, #241e17b8)`, border `#ffffff1a` |
| Dialog / popover | `#221d16f7` / `linear-gradient(135deg, #2a241cfa, #201b14fa)` |
| Text primary / secondary | `#f3ecdf` / `#b9b09f` |
| Table row tints | mint `#1f3a2b80`, blue `#1f2e3d80`, lilac `#33263a80`, peach `#3d2b1c80`, sand `#37301c80` |
| Status (text on fill) | success `#7fdaa6`/`#1d3b2a`, info `#8cc4f0`/`#1b2f42`, warning `#f3cd6a`/`#3b3016`, error `#f3a088`/`#432419`, neutral `#c9c6bb`/`#33312b` |
| Nav active | `linear-gradient(115deg, #5a4515ef, #463711db)`, text `#ffe7a3` |

## Accent-derived tokens (operator primary)

The app rule is that every accent follows the operator's primary colour (Settings → Theme). So the gold
values above that are accents — nav active pill/text/bar/glow, accent text, selection wash, title dot, row
hover, avatar — are written in `veylixTheme.ts` as functions of `--mui-palette-primary-*`. With the
`primary-veylix` preset (main `#F5BC34`, light `#FFDA75`) they land within a shade of the template values:

| Token | Template | Derived (gold preset) |
|---|---|---|
| Nav active fill | `#ffe387ef → #fff2bfdb` | `rgb(light / .94) → rgb(light / .42)` |
| Nav active text | `#554014` | `color-mix(primary 30%, #25251f)` ≈ `#63521F` |
| Accent text | `#805b12` | `color-mix(primary 50%, #25251f)` ≈ `#8D7029` |
| Nav bar / title dot | `#e8b025` / `#dba923` | primary main `#F5BC34` |
| Selection | `#ffe9b3a8` / `#fff2c9` | `rgb(light / .6)` / `rgb(light / .3)` |
| Avatar | `#ffe08a → #fabc27`, text `#302817` | primary light → main, text = primary contrastText |
