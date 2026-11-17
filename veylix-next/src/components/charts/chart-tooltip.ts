// @ts-nocheck
import { escapeHtml } from "@/lib/format";

export function positionChartTooltip(e, t, n, r) {
  const i = t.getBoundingClientRect();
  const a = e.offsetWidth / 2;
  const o = Math.max(a + 8 - i.left, Math.min(n, innerWidth - i.left - a - 8));
  e.style.left = `${o}px`;
  e.style.top = `${Math.max(e.offsetHeight + 8 - i.top, r - 12)}px`;
  e.classList.add("is-visible");
}

export function renderExternalChartTooltip({ chart, tooltip }) {
  const n = chart.canvas.parentElement;
  const r = n.querySelector(".chart-tooltip");
  if (tooltip.opacity) {
    r.innerHTML = `<strong>${escapeHtml((tooltip.title || []).join(" · "))}</strong>${(
      tooltip.body || []
    )
      .map((e, n) => {
        const r = tooltip.labelColors[n];
        return `<span class="tooltip-row"><i class="tooltip-swatch" style="background:${typeof r?.backgroundColor == "string" ? r.backgroundColor : r?.borderColor || "#edb744"}"></i>${escapeHtml(e.lines.join(" "))}</span>`;
      })
      .join("")}`;
    positionChartTooltip(r, n, tooltip.caretX, tooltip.caretY);
  } else {
    r.classList.remove("is-visible");
    r.textContent = "";
  }
}
