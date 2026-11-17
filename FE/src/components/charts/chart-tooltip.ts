import type { Chart, TooltipModel } from "chart.js";

/** Template HTML tooltip (`.chart-tooltip`), built with DOM nodes (no innerHTML). */
export function renderExternalChartTooltip({ chart, tooltip }: { chart: Chart; tooltip: TooltipModel<"bar" | "line" | "doughnut" | "pie"> }): void {
  const host = chart.canvas.parentElement;
  const el = host?.querySelector<HTMLElement>(".chart-tooltip");
  if (!host || !el) return;
  if (!tooltip.opacity) {
    el.classList.remove("is-visible");
    el.replaceChildren();
    return;
  }
  const title = document.createElement("strong");
  title.textContent = (tooltip.title || []).join(" · ");
  const rows = (tooltip.body || []).map((b, i) => {
    const row = document.createElement("span");
    row.className = "tooltip-row";
    const sw = document.createElement("i");
    sw.className = "tooltip-swatch";
    const c = tooltip.labelColors[i];
    const bg = typeof c?.backgroundColor === "string" ? c.backgroundColor : typeof c?.borderColor === "string" ? c.borderColor : "#edb744";
    sw.style.background = bg;
    row.append(sw, document.createTextNode(b.lines.join(" ")));
    return row;
  });
  el.replaceChildren(title, ...rows);
  const rect = host.getBoundingClientRect();
  const half = el.offsetWidth / 2;
  const x = Math.max(half + 8 - rect.left, Math.min(tooltip.caretX, window.innerWidth - rect.left - half - 8));
  el.style.left = `${x}px`;
  el.style.top = `${Math.max(el.offsetHeight + 8 - rect.top, tooltip.caretY - 12)}px`;
  el.classList.add("is-visible");
}
