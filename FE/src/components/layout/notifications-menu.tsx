"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { IconTile, type TileTone } from "@/components/ui/card-primitives";
import { Spinner } from "@/components/ui/states";
import { formatRelative } from "@/lib/format";
import { useDispatch, useSelector } from "@/store";
import {
  archiveNotification,
  fetchBackgroundJobs,
  markAllNotificationsRead,
  markNotificationRead,
  type Notifications,
} from "@/store/notification-slice";
import type { IconName } from "@/components/icons/icon";

const TYPE_META: Record<string, { label: string; icon: IconName; tone: TileTone }> = {
  EXPORT: { label: "Export", icon: "download", tone: "info" },
  R_D_SCAN: { label: "Scan", icon: "barcode", tone: "coral" },
  DEFAULT: { label: "Update", icon: "bell", tone: "neutral" },
};
const typeMeta = (t?: string) => (t && TYPE_META[t]) || TYPE_META.DEFAULT;

/** TrackVid notifications in the template popover: background jobs, read / read-all, archive, export download, scan link. */
export function NotificationsMenu({ open, onToggle, onClose }: { open: boolean; onToggle: (el: HTMLElement) => void; onClose: () => void }) {
  const dispatch = useDispatch();
  const router = useRouter();
  const { notifications, backgroundJobs, loadingNotification } = useSelector((s) => s.notification);
  const [jobProgress, setJobProgress] = useState<Record<string, number>>({});
  const unread = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    void dispatch(fetchBackgroundJobs());
  }, [dispatch]);

  // Simulates the per-job import progress stream TrackVid opens for running background jobs.
  const runningJobs = backgroundJobs.importNotifications.filter((j) => j.status !== "completed");
  useEffect(() => {
    if (!runningJobs.length) return;
    const id = window.setInterval(() => {
      setJobProgress((p) => {
        const next = { ...p };
        for (const j of runningJobs) next[j.mainJobId] = Math.min(100, (next[j.mainJobId] ?? 12) + 7);
        return next;
      });
    }, 1500);
    return () => window.clearInterval(id);
  }, [runningJobs]);

  const onItem = (n: Notifications) => {
    if (!n.is_read) void dispatch(markNotificationRead(n._id));
    if (n.type === "R_D_SCAN") {
      onClose();
      router.push(`/imports?id=${n._id}`);
    }
  };

  return (
    <div className="header-menu-wrap">
      <button
        type="button"
        className="notification-trigger icon-button"
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="header-popover-notifications"
        title={unread ? `${unread} unread notifications` : "No new notifications"}
        onClick={(e) => onToggle(e.currentTarget)}
      >
        <Icon name="bell" />
        <span className="notification-dot" hidden={!unread} />
      </button>
      {open ? (
        <div id="header-popover-notifications" className="header-popover popover-notifications" role="dialog" aria-label="Notifications">
          <div className="popover-title notification-heading">
            <strong>Notifications</strong>
            <span className="c-status amber">{unread}</span>
          </div>
          <button type="button" className="notification-read-all" disabled={!unread} onClick={() => void dispatch(markAllNotificationsRead())}>
            Mark all as read
          </button>
          {runningJobs.length ? (
            <div className="tv-stack" style={{ padding: "6px 4px 10px", gap: 8 }}>
              {runningJobs.map((j) => (
                <div key={j.mainJobId} className="tv-stack" style={{ gap: 4 }}>
                  <span className="tv-small tv-strong">{j.title}</span>
                  <div className="tv-progress" role="progressbar" aria-valuenow={jobProgress[j.mainJobId] ?? 12} aria-valuemin={0} aria-valuemax={100} aria-label={j.title}>
                    <span style={{ width: `${jobProgress[j.mainJobId] ?? 12}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="header-notification-list">
            {loadingNotification ? (
              <div className="tv-row" style={{ justifyContent: "center", padding: 18 }}>
                <Spinner label="Loading notifications" />
              </div>
            ) : notifications.length ? (
              notifications.map((n) => {
                const meta = typeMeta(n.type);
                return (
                  <div key={n._id} className={`header-notification ${n.is_read ? "" : "is-unread"}`} style={{ alignItems: "flex-start" }}>
                    <IconTile name={meta.icon} tone={meta.tone} />
                    <button type="button" onClick={() => onItem(n)} style={{ textAlign: "left", flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <strong>{n.message}</strong>
                      <small>{n.description}</small>
                      <time dateTime={n.createdAt}>
                        {meta.label} · {formatRelative(n.createdAt)}
                      </time>
                    </button>
                    <span className="tv-row" style={{ gap: 2, flexWrap: "nowrap" }}>
                      {n.type === "EXPORT" && n.fileUrl ? (
                        <a className="icon-button" href={n.fileUrl} download aria-label="Download export" style={{ width: 30, height: 30 }}>
                          <Icon name="download" />
                        </a>
                      ) : null}
                      <button type="button" className="icon-button" aria-label="Archive notification" style={{ width: 30, height: 30 }} onClick={() => void dispatch(archiveNotification(n._id))}>
                        <Icon name="trash" />
                      </button>
                    </span>
                    {!n.is_read ? <i className="unread-marker" /> : null}
                  </div>
                );
              })
            ) : (
              <p className="popover-empty">No new notifications</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
