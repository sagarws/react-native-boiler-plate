// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { IconTile } from "@/components/ui/card-primitives";
import { inventorySummary } from "@/data/dashboard";
import { StorePulseGreeting } from "@/features/overview/components/store-pulse-greeting";
import { buildStorePulseSnapshot } from "@/features/overview/lib/store-pulse";
import {
  STORE_PULSE_ROTATE_MS,
  storePulseSignalRoutes,
  toStorePulseActivity,
} from "@/features/overview/lib/store-pulse-events";
import { assetUrl, formatNumber } from "@/lib/format";
import { readProfile } from "@/lib/profile";

export function StorePulseSection({ period }) {
  const t = buildStorePulseSnapshot(period);
  const [n, r] = useState(false);
  const [i, a] = useState(0);
  const [o, s] = useState(() => Date.now());
  const [c, u] = useState(null);
  const [d, f] = useState("live");
  const p = useRef(false);
  useEffect(() => {
    p.current = n;
  }, [n]);
  useEffect(() => {
    a(0);
  }, [t.signature]);
  useEffect(() => {
    const e = () => s(Date.now());
    const t = window.setInterval(e, 15e3);
    document.addEventListener("visibilitychange", e);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", e);
    };
  }, []);
  useEffect(() => {
    const e = t.events.length + +!!c;
    if (n || e <= 1) return;
    const r = window.setInterval(() => {
      if (!document.hidden) {
        a((t) => (t + 1) % e);
      }
    }, STORE_PULSE_ROTATE_MS);
    return () => window.clearInterval(r);
  }, [n, t.signature, t.events.length, c]);
  useEffect(() => {
    f("live");
    u(null);
  }, [""]);
  const m = useMemo(() => toStorePulseActivity(c), [c]);
  const h = m ? [...t.events, m] : t.events;
  const g = h[i % Math.max(1, h.length)] || t.events[0];
  const _ = storePulseSignalRoutes[g?.kind || "health"];
  const v = (readProfile().name || "Alex").split(" ")[0];
  const y = new Date(o).getHours();
  const b = `Good ${y < 12 ? "morning" : y < 17 ? "afternoon" : "evening"}, ${v}`;
  const x = n ? "Paused" : "Live commerce data";
  const S = g
    ? (() => {
        const e = Math.max(0, Math.floor((o - Date.parse(g.occurredAt)) / 1e3));
        return e < 15
          ? "Just updated"
          : e < 60
            ? `${e}s ago`
            : e < 3600
              ? `${Math.floor(e / 60)}m ago`
              : `${Math.floor(e / 3600)}h ago`;
      })()
    : "";
  const C = h.length
    ? `${String((i % h.length) + 1).padStart(2, "0")} / ${String(h.length).padStart(2, "0")}`
    : "";
  const w = () => r((e) => !e);
  const T = (e) => {
    if (e.target === e.currentTarget) {
      if (e.code === "Space") {
        e.preventDefault();
        w();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        a((e) => (e + 1) % Math.max(1, h.length));
      }
    }
  };
  const E = [
    {
      icon: "package",
      label: "Products",
      description: "Active products",
      value: formatNumber(inventorySummary.total),
      change: "6%",
      tone: "amber",
    },
    {
      icon: "users",
      label: "Customers",
      description: "Total customers",
      value: formatNumber(period.customers),
      change: "15%",
      tone: "neutral",
    },
    {
      icon: "users",
      label: "Returning",
      value: `${period.returning}%`,
      change: "4%",
      tone: "neutral",
      description: "Returning customers",
    },
    {
      icon: "truck",
      label: "Delivery",
      value: `${period.delivery} d`,
      change: "18%",
      tone: "amber",
      down: true,
      description: "Average delivery time",
    },
  ];
  return (
    <section className="warehouse-section" aria-label="Store at a glance">
      <StorePulseGreeting
        greeting={b}
        activityIcon={_.icon}
        activityTitle={g?.title || `Store health · ${t.health.score}%`}
        activityDetail={g?.detail || t.health.detail}
        activityKind={g?.kind || "health"}
        tone={g?.tone || t.health.tone}
        connection={d}
        paused={n}
        feedStatus={x}
        occurredAt={g?.occurredAt}
        timeLabel={S}
        positionLabel={C}
        liveEndpoint
        onKeyDown={T}
      />
      <div className="warehouse-scene">
        <div className="warehouse-artwork">
          <img
            src={assetUrl("images/warehouse.webp")}
            alt="Isometric Veylix warehouse with shelves, parcels and a packing station"
            width="1200"
            height="900"
            fetchPriority="high"
          />
          <svg
            className={`warehouse-signal${n ? " is-paused" : ""}`}
            data-tone={g?.tone || t.health.tone}
            viewBox="0 0 1200 900"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="activity-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="4"
                orient="auto"
              >
                <path
                  d="M1 1 L6 4 L1 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              </marker>
            </defs>
            <path
              className="signal-route"
              d={_.path}
              markerEnd="url(#activity-arrow)"
            />
            <path className="signal-flow" d={_.path} />
            <g transform={`translate(${_.x} ${_.y})`}>
              <circle className="signal-halo" r="23" />
              <circle className="signal-dot" r="6" />
            </g>
          </svg>
        </div>
      </div>
      <div className="overview-metrics">
        {E.map((e) => (
          <div
            key={e.label}
            className="metric-card"
            role="group"
            aria-label={`${e.description || e.label}: ${e.value}`}
          >
            <IconTile name={e.icon} tone={e.tone} />
            <div className="metric-copy">
              <span>{e.label}</span>
              <div>
                <strong>{e.value}</strong>
                <small>
                  <Icon name={e.down ? "arrow-down" : "arrow-up"} />
                  {e.change}
                </small>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
