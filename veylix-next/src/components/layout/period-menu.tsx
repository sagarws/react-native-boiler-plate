// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { IconTile } from "@/components/ui/card-primitives";
import { dashboardPeriods } from "@/data/dashboard";
import { readStoredValue } from "@/lib/storage";

export function PeriodMenu({ period, open: t, onToggle, onClose }) {
  const i =
    dashboardPeriods.find((t) => t.id === period.id)?.label || period.label;
  const a = String(readStoredValue("period", "30"));
  function o(e) {
    window.dispatchEvent(
      new CustomEvent("veylix:period", {
        detail: e,
      }),
    );
    onClose(true);
  }
  return (
    <div className="header-menu-wrap">
      <button
        type="button"
        className="period-select"
        data-header-menu="period"
        aria-label="Dashboard period"
        aria-haspopup="menu"
        aria-expanded={t}
        aria-controls="header-popover-period"
        onClick={(e) => onToggle(e.currentTarget)}
      >
        <IconTile
          name="calendar"
          tone="neutral"
          className="header-control-icon"
        />
        <span data-period-label="">{i}</span>
        <Icon name="caret-down" />
      </button>
      {t ? (
        <div
          id="header-popover-period"
          className="header-popover popover-period"
          role="menu"
          aria-label="Dashboard period"
        >
          <div className="popover-title">Dashboard period</div>
          {dashboardPeriods.map((e) => {
            const t = e.id === a;
            return (
              <button
                key={e.id}
                type="button"
                role="menuitemradio"
                aria-checked={t}
                data-period={e.id}
                onClick={() => o(e.id)}
              >
                <Icon name="calendar" />
                <span>
                  <strong>{e.label}</strong>
                  <small>{e.range}</small>
                </span>
                {t ? <Icon name="check-circle" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
