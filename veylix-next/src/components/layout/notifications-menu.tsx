// @ts-nocheck
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { IconTile } from "@/components/ui/card-primitives";
import { showToast } from "@/lib/events";
import { buildHref } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

function readRecentNotifications() {
  return listRecords("notifications").slice(0, 6);
}

export function NotificationsMenu({ open: e, onToggle, onClose }) {
  const [r, i] = useState(readRecentNotifications);
  const a = r.filter((e) => e.status === "Unread").length;
  const o = useCallback(() => i(readRecentNotifications()), []);
  useEffect(() => {
    const e = () => o();
    window.addEventListener("popstate", e);
    window.addEventListener("veylix:navigate", e);
    return () => {
      window.removeEventListener("popstate", e);
      window.removeEventListener("veylix:navigate", e);
    };
  }, [o]);
  function s(e) {
    try {
      const t = listRecords("notifications");
      for (const n of t.filter(
        (t) => t.status === "Unread" && (!e || t.id === e),
      ))
        saveRecord(
          "notifications",
          {
            ...n,
            status: "Read",
          },
          n.id,
        );
      o();
      requestAnimationFrame(() => {
        const t = e
          ? `[data-read-notification="${CSS.escape(e)}"]`
          : ".popover-footer";
        document.querySelector(t)?.focus();
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="header-menu-wrap">
      <button
        type="button"
        className="notification-trigger icon-button"
        data-header-menu="notifications"
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={e}
        aria-controls="header-popover-notifications"
        title={a ? `${a} unread notifications` : "No new notifications"}
        onClick={(e) => onToggle(e.currentTarget)}
      >
        <Icon name="bell" />
        <span className="notification-dot" hidden={!a} />
      </button>
      {e ? (
        <div
          id="header-popover-notifications"
          className="header-popover popover-notifications"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="popover-title notification-heading">
            <strong>Notifications</strong>
            <span className="c-status amber">{a}</span>
          </div>
          <button
            type="button"
            className="notification-read-all"
            data-read-all=""
            disabled={!a}
            onClick={() => s()}
          >
            Mark all as read
          </button>
          <div className="header-notification-list">
            {r.length ? (
              r.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={`header-notification ${e.status === "Unread" ? "is-unread" : ""}`}
                  data-read-notification={e.id}
                  aria-label={`${e.name} — ${e.status}`}
                  onClick={() => s(e.id)}
                >
                  <IconTile
                    name={
                      e.category === "Inventory"
                        ? "package"
                        : e.category === "Orders"
                          ? "cart"
                          : "bell"
                    }
                    tone={e.category === "Inventory" ? "amber" : "success"}
                  />
                  <span>
                    <strong>{e.name}</strong>
                    <small>{e.message}</small>
                    <time>{e.date}</time>
                  </span>
                  {e.status === "Unread" ? (
                    <i className="unread-marker" />
                  ) : null}
                </button>
              ))
            ) : (
              <p className="popover-empty">No new notifications</p>
            )}
          </div>
          <Link
            className="popover-footer"
            href={buildHref("/commerce/notifications")}
            onClick={() => onClose()}
          >
            View all notifications
            <Icon name="arrow-right" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
