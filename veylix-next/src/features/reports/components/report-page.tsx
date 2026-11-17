// @ts-nocheck
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Chart } from "@/components/charts/chart-setup";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { SummaryList } from "@/components/ui/summary-list";
import { modulesById } from "@/config/modules/registry";
import {
  reportChartColors,
  reportPeriodDays,
} from "@/features/reports/constants";
import { buildReportData } from "@/features/reports/lib/report-data";
import { buildCsv, downloadFile } from "@/lib/csv";
import { formatCurrency } from "@/lib/format";

export function ReportPage({ moduleId }) {
  const t = modulesById[moduleId];
  const [n, r] = useState(30);
  const i = useRef(null);
  const a = useMemo(() => buildReportData(t.report, n), [t.report, n]);
  const o = (e) =>
    a.unit === "money" ? formatCurrency(e, 2) : e.toLocaleString();
  useLayoutEffect(() => {
    const e = i.current;
    if (!e) return;
    const t = new Chart(e, {
      type: "bar",
      data: {
        labels: a.rows.map((e) => e.name),
        datasets: [
          {
            label: a.metric,
            data: a.rows.map((e) => e.value),
            backgroundColor: a.rows.map(
              (e, t) => reportChartColors[t % reportChartColors.length],
            ),
            borderRadius: 7,
            maxBarThickness: 62,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        animation: !window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches && {
          duration: 1e3,
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (e) =>
                `${a.metric}: ${a.unit === "money" ? formatCurrency(Number(e.parsed.y), 2) : e.parsed.y}`,
            },
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
            },
            ticks: {
              maxRotation: 25,
            },
          },
          y: {
            beginAtZero: true,
            grid: {
              color: "#d6ccba45",
            },
          },
        },
      },
    });
    return () => t.destroy();
  }, [a]);
  const s = () => {
    downloadFile(
      `veylix-${t.report}-report.csv`,
      "﻿" +
        buildCsv(
          a.rows,
          ["name", "value"],
          ["Group", `${a.metric}${a.unit === "money" ? " (USD)" : ""}`],
        ),
    );
  };
  const c = [
    [
      a.metric,
      o(a.total),
      a.unit === "money" ? "USD" : "Across the selected records",
    ],
    ["Groups", a.rows.length, "Shown below"],
    ["Period", `Last ${n} days`, `${a.start} – ${a.end}`],
  ];
  return (
    <Fragment>
      <CommercePageHeading
        title={t.title}
        actions={
          <button
            type="button"
            className="secondary-button"
            data-c-action="report-export"
            onClick={s}
          >
            Export report
          </button>
        }
      />
      <div className="c-report-period">
        <span>{a.note}</span>
        <label>
          Report period{" "}
          <select
            data-report-period
            value={n}
            onChange={(e) => r(Number(e.target.value))}
          >
            {reportPeriodDays.map((e) => (
              <option key={e} value={e}>
                {"Last "}
                {e}
                {" days"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SummaryList items={c} />
      <section className="glass-card">
        <div className="card-heading">
          <h2>{a.metric}</h2>
          <span className="muted">Hover a bar to explore</span>
        </div>
        <div className="c-report-chart">
          <canvas
            ref={i}
            id="commerce-report-chart"
            role="img"
            aria-label={`${t.title} chart. Complete values follow in the table.`}
          />
        </div>
      </section>
      <section className="glass-card c-report-table">
        <h2>Behind the numbers</h2>
        {a.rows.length ? (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Report data"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.report === "sales" ? "Date" : "Group"}</th>
                  <th scope="col">{a.metric}</th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                {a.rows.map((e) => {
                  const t = a.total ? (e.value / a.total) * 100 : 0;
                  return (
                    <tr key={`${e.name}-${e.value}`}>
                      <td>
                        <strong>{e.name}</strong>
                        {e.detail ? (
                          <small className="c-cell-note">{e.detail}</small>
                        ) : null}
                      </td>
                      <td>{o(e.value)}</td>
                      <td>
                        <span className="c-share-bar">
                          <i
                            style={{
                              width: `${t}%`,
                            }}
                          />
                        </span>
                        {a.total ? t.toFixed(1) : 0}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="c-empty">
            <Icon name="basket" />
            <h3>No records in this period</h3>
            <p>Choose a wider period or add records to your workspace.</p>
          </div>
        )}
      </section>
    </Fragment>
  );
}
