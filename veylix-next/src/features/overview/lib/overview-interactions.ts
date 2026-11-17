// @ts-nocheck
import { Chart } from "@/components/charts/chart-setup";
import {
  positionChartTooltip,
  renderExternalChartTooltip,
} from "@/components/charts/chart-tooltip";
import {
  inventorySummary,
  orderPipelineStages,
  paymentMethodShare,
  salesByRegion,
  salesChannels,
} from "@/data/dashboard";
import {
  inventoryHealthTrend,
  inventoryStockSegments,
} from "@/features/overview/data/inventory-charts";
import { buildProductTrendLabels } from "@/features/overview/lib/product-trend-labels";
import {
  assetUrl,
  escapeHtml,
  formatCurrency,
  formatNumber,
} from "@/lib/format";

export function mountOverviewInteractions(e, t) {
  const n = new AbortController();
  const { signal } = n;
  const i = new Map();
  const a = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const o = (e, t, n) =>
    e.addEventListener(t, n, {
      signal: signal,
    });
  const s = (e, t) => {
    const n = e.data.datasets.flatMap((n, r) =>
      e.isDatasetVisible(r)
        ? [
            {
              datasetIndex: r,
              index: t,
            },
          ]
        : [],
    );
    if (!n.length) return;
    const r = e.getDatasetMeta(n[0].datasetIndex).data[t];
    e.setActiveElements(n);
    e.tooltip.setActiveElements(n, r.getCenterPoint());
    e.update("none");
  };
  const c = (e) => {
    e.setActiveElements([]);
    e.tooltip.setActiveElements([], {
      x: 0,
      y: 0,
    });
    e.update("none");
  };
  const l = (t, n, r, l = {}) => {
    const u = e.querySelector(`[data-chart="${t}"]`);
    if (!u) return;
    const d = new Chart(u, {
      type: n,
      data: r,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: a
          ? {
              duration: 450,
            }
          : false,
        interaction: {
          mode: n === "doughnut" ? "nearest" : "index",
          intersect: false,
        },
        ...l,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: false,
            external: renderExternalChartTooltip,
            displayColors: true,
            ...l.tooltip,
          },
        },
      },
    });
    i.set(t, d);
    let f = 0;
    o(u, "focus", () => s(d, f));
    o(u, "blur", () => c(d));
    o(u, "keydown", (e) => {
      if (
        ["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(e.key)
      ) {
        if ((e.preventDefault(), e.key === "Escape")) {
          c(d);
          return;
        }
        const t = d.data.labels.length;
        f =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? t - 1
              : (f + (e.key === "ArrowRight" ? 1 : -1) + t) % t;
        s(d, f);
      }
    });
    return d;
  };
  const u = buildProductTrendLabels(t);
  const d = (e) => `${e.dataset.label}: ${formatCurrency(e.parsed.y * 1e3)}`;
  const f = {
    x: {
      display: false,
    },
    y: {
      display: false,
    },
  };
  const p = l(
    "revenue",
    "line",
    {
      labels: u,
      datasets: [
        {
          label: "This period",
          data: t.trend,
          borderColor: "#eeaa13",
          backgroundColor: (e) => {
            const { ctx, chartArea } = e.chart;
            if (!chartArea) return "#ffcc6333";
            const r = ctx.createLinearGradient(
              0,
              chartArea.top,
              0,
              chartArea.bottom,
            );
            r.addColorStop(0, "#ffbe4059");
            r.addColorStop(1, "#ffbe4000");
            return r;
          },
          fill: true,
          borderWidth: 2.5,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#fff",
          pointHoverBorderWidth: 2,
        },
        {
          label: "Last period",
          data: t.previous,
          borderColor: "#c7c2ad",
          backgroundColor: "#c7c2ad",
          borderWidth: 1.8,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: "#fff",
        },
      ],
    },
    {
      scales: {
        x: {
          border: {
            display: false,
          },
          grid: {
            display: false,
          },
          ticks: {
            maxTicksLimit: 5,
            maxRotation: 0,
            font: {
              size: 14,
            },
            padding: 8,
          },
        },
        y: {
          beginAtZero: true,
          border: {
            display: false,
          },
          grid: {
            color: "#cfc9b540",
            drawTicks: false,
          },
          ticks: {
            count: 4,
            padding: 9,
            callback: (e) => `$${e}K`,
            font: {
              size: 14,
            },
          },
        },
      },
      tooltip: {
        callbacks: {
          label: d,
        },
      },
    },
  );
  e.querySelectorAll("[data-chart-toggle]").forEach((e) =>
    o(e, "click", () => {
      const t = Number(e.dataset.chartToggle);
      const n = !p.isDatasetVisible(t);
      if (n || p.getVisibleDatasetCount() !== 1) {
        p.setDatasetVisibility(t, n);
        e.setAttribute("aria-pressed", String(n));
        c(p);
      }
    }),
  );
  l(
    "sales",
    "bar",
    {
      labels: u,
      datasets: [
        {
          label: "Sales sample",
          data: t.trend,
          backgroundColor: "#ffc342",
          hoverBackgroundColor: "#dd960a",
          borderRadius: 4,
          maxBarThickness: 7,
        },
      ],
    },
    {
      scales: f,
      tooltip: {
        callbacks: {
          label: d,
        },
      },
    },
  );
  l(
    "health",
    "line",
    {
      labels: inventoryHealthTrend.labels,
      datasets: [
        {
          label: "Store health",
          data: inventoryHealthTrend.values,
          borderColor: "#2fbf73",
          backgroundColor: "#2fbf73",
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 3,
        },
      ],
    },
    {
      scales: {
        ...f,
        y: {
          display: false,
          min: 83,
          max: 97,
        },
      },
      tooltip: {
        callbacks: {
          label: (e) => `Store health: ${e.parsed.y}%`,
        },
      },
    },
  );
  l(
    "inventory",
    "doughnut",
    {
      labels: inventoryStockSegments.map((e) => e.name),
      datasets: [
        {
          data: inventoryStockSegments.map((e) => e.value),
          backgroundColor: inventoryStockSegments.map((e) => e.color),
          borderWidth: 0,
          hoverOffset: 5,
        },
      ],
    },
    {
      cutout: "76%",
      layout: {
        padding: 6,
      },
      tooltip: {
        callbacks: {
          label: (e) =>
            `${formatNumber(e.parsed)} products · ${((e.parsed / inventorySummary.total) * 100).toFixed(1)}%`,
        },
      },
    },
  );
  l(
    "payments",
    "doughnut",
    {
      labels: paymentMethodShare.map((e) => e.name),
      datasets: [
        {
          data: paymentMethodShare.map((e) => e.percent),
          backgroundColor: paymentMethodShare.map((e) => e.color),
          borderWidth: 0,
          hoverOffset: 5,
        },
      ],
    },
    {
      cutout: "76%",
      layout: {
        padding: 6,
      },
      tooltip: {
        callbacks: {
          label: (e) =>
            `${e.parsed}% · ${formatCurrency((t.sales * e.parsed) / 100, 2)}`,
        },
      },
    },
  );
  e.querySelectorAll("[data-chart-segment]").forEach((e) => {
    const t = i.get(e.dataset.chartSegment);
    for (const n of ["pointerenter", "focus", "click"])
      o(e, n, () => s(t, Number(e.dataset.index)));
    for (const n of ["pointerleave", "blur"]) o(e, n, () => c(t));
    o(e, "keydown", (e) => {
      if (e.key === "Escape") {
        c(t);
      }
    });
  });
  mountOverviewWorldMap(e, t, signal, o);
  const m = document.createElement("div");
  m.className = "data-tip";
  m.id = "progress-tooltip";
  m.role = "tooltip";
  m.hidden = true;
  e.append(m);
  const h = (e, t) => {
    e.tabIndex = 0;
    e.setAttribute("aria-label", t);
    e.setAttribute("aria-describedby", m.id);
    const n = () => {
      m.textContent = t;
      m.hidden = false;
      const n = e.getBoundingClientRect();
      m.style.left = `${Math.max(8, Math.min(n.left, innerWidth - m.offsetWidth - 8))}px`;
      m.style.top = `${Math.max(8, n.top - m.offsetHeight - 8)}px`;
    };
    const r = () => {
      m.hidden = true;
    };
    for (const t of ["pointerenter", "focus", "click"]) o(e, t, n);
    for (const t of ["pointerleave", "blur"]) o(e, t, r);
    o(e, "keydown", (e) => {
      if (e.key === "Escape") {
        r();
      }
    });
  };
  e.querySelectorAll(".fulfillment-row").forEach((e, n) =>
    h(
      e,
      `${orderPipelineStages[n].label}: ${formatNumber(Math.round(t.orders * orderPipelineStages[n].ratio))} orders · ${(orderPipelineStages[n].ratio * 100).toFixed(1)}% of received orders`,
    ),
  );
  e.querySelectorAll(".channel-row").forEach((e, n) =>
    h(
      e,
      `${salesChannels[n].name}: ${salesChannels[n].percent}% · ${formatCurrency((t.sales * salesChannels[n].percent) / 100, 2)}`,
    ),
  );
  o(window, "scroll", () => {
    m.hidden = true;
  });
  return () => {
    n.abort();
    i.forEach((e) => e.destroy());
    m.remove();
  };
}

async function mountOverviewWorldMap(e, t, n, r) {
  const i = e.querySelector(".world-map");
  const a = e.querySelector(".map-frame");
  const o = a.querySelector(".chart-tooltip");
  const s = e.querySelector(".region-insight");
  const c = new Map(salesByRegion.map((e) => [e.code.toLowerCase(), e]));
  let l = "us";
  const u = (n) => {
    const r = c.get(n);
    if (r) {
      l = n;
      s.textContent = `${r.name} · ${r.percent}% · ${formatCurrency((t.sales * r.percent) / 100)}`;
      e.querySelectorAll("[data-region]").forEach((e) =>
        e.setAttribute("aria-pressed", String(e.dataset.region === n)),
      );
      i.querySelectorAll("[data-country]").forEach((e) => {
        e.classList.toggle("is-selected", e.dataset.country === n);
        if (e.hasAttribute("data-ranked")) {
          e.setAttribute("aria-pressed", String(e.dataset.country === n));
        }
      });
    }
  };
  e.querySelectorAll("[data-region]").forEach((e) => {
    r(e, "click", () => u(e.dataset.region));
    r(e, "focus", () => u(e.dataset.region));
  });
  try {
    const e = await fetch(assetUrl("images/world-map.svg"), {
      signal: n,
    });
    if (!e.ok) throw Error("Map asset unavailable");
    const s = await e.text();
    if (n.aborted) return;
    i.innerHTML = s;
    i.setAttribute("aria-busy", "false");
    const d = (e, n) => {
      const r = c.get(e.dataset.country);
      o.innerHTML = `<strong>${escapeHtml(e.dataset.name)}</strong><span>${r ? `${r.percent}% of sales · ${formatCurrency((t.sales * r.percent) / 100)}` : "No individual breakdown in this demo"}</span>`;
      const i = a.getBoundingClientRect();
      const s = e.getBoundingClientRect();
      positionChartTooltip(
        o,
        a,
        n?.clientX ? n.clientX - i.left : s.left + s.width / 2 - i.left,
        n?.clientY ? n.clientY - i.top : s.top - i.top,
      );
    };
    i.querySelectorAll("[data-country]").forEach((e) => {
      for (const t of ["pointerenter", "pointermove", "focus"])
        r(e, t, (t) => d(e, t));
      for (const t of ["pointerleave", "blur"])
        r(e, t, () => o.classList.remove("is-visible"));
      r(e, "click", (t) => {
        u(e.dataset.country);
        d(e, t);
      });
      r(e, "keydown", (t) => {
        if (t.key === "Enter" || t.key === " ") {
          t.preventDefault();
          u(e.dataset.country);
        }
        if (t.key === "Escape") {
          o.classList.remove("is-visible");
        }
      });
    });
    if (l) {
      u(l);
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    i.textContent = "Map unavailable. Explore sales using the region list.";
    i.setAttribute("aria-busy", "false");
  }
}
