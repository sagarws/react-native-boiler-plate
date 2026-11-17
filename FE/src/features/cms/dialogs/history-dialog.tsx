"use client";

import { Icon, type IconName } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { CLAIM_HISTORY_ACTION_TYPE } from "@/config/app-constant";
import { formatDate } from "@/lib/format";
import type { IHistoryData } from "@/types/cms";

type Tone = "green" | "blue" | "amber" | "red" | "neutral";

const A = CLAIM_HISTORY_ACTION_TYPE;

/** TrackVid `iconSelector`: icon, tone and an optional small badge per history action. */
function iconFor(action: number): { icon: IconName; tone: Tone; badge?: IconName; flip?: boolean } {
  switch (action) {
    case A.CMS_CREATED:
      return { icon: "check", tone: "green" };
    case A.TICKET_ADDED:
      return { icon: "receipt", tone: "blue", badge: "plus" };
    case A.TICKET_UPDATED:
      return { icon: "receipt", tone: "blue", badge: "pencil" };
    case A.STATUS_CHANGED_FROM_PENDING_TO_IN_REVIEW:
      return { icon: "eye", tone: "amber" };
    case A.STATUS_CHANGED_FROM_IN_REVIEW_TO_REJECTED:
      return { icon: "x-circle", tone: "red" };
    case A.STATUS_CHANGED_FROM_IN_REVIEW_TO_APPROVED:
      return { icon: "check-circle", tone: "green" };
    case A.EMAIL_TEMPLATE_UPDATED:
      return { icon: "envelope", tone: "blue" };
    case A.STATUS_CHANGED_FROM_APPROVED_TO_IN_REVIEW:
    case A.STATUS_CHANGED_FROM_REJECTED_TO_IN_REVIEW:
      return { icon: "eye", tone: "amber", badge: "arrow-left" };
    case A.STATUS_CHANGED_FROM_APPROVED_TO_REJECTED:
      return { icon: "x-circle", tone: "red", badge: "arrow-left" };
    case A.STATUS_CHANGED_FROM_REJECTED_TO_APPROVED:
      return { icon: "check-circle", tone: "green", badge: "arrow-left" };
    case A.STATUS_CHANGED_FROM_APPROVED_TO_PENDING:
    case A.STATUS_CHANGED_FROM_REJECTED_TO_PENDING:
    case A.STATUS_CHANGED_FROM_IN_REVIEW_TO_PENDING:
      return { icon: "timer", tone: "blue", badge: "arrow-left" };
    case A.SHIPPED:
      return { icon: "truck", tone: "green" };
    case A.CANCELLED:
      return { icon: "x", tone: "red" };
    case A.RETURN_CREATED_NOT_NEAR:
      return { icon: "truck", tone: "amber", flip: true };
    case A.STATUS_CHANGED_RETURN_CREATED_TO_RETURN_CANCELLED:
      return { icon: "truck", tone: "red", badge: "x", flip: true };
    default:
      return { icon: "pencil", tone: "neutral" };
  }
}

/** TrackVid `HistoryModal` for claims: AWB strip + vertical timeline, newest first. */
export function HistoryDialog({ loading, data, onClose }: { loading: boolean; data: IHistoryData | null; onClose: () => void }) {
  const events = data?.history ? [...data.history].reverse() : [];
  return (
    <AppDialog
      title={
        <span className="tv-row">
          <span className="tv-cms-title-icon">
            <Icon name="history" />
          </span>
          Claim History
        </span>
      }
      onClose={onClose}
    >
      {!loading && data && events.length > 0 ? (
        <div className="tv-cms-awb-strip">
          {data.returnAWB ? (
            <span>
              <small>Return AWB</small>
              <strong className="tv-mono">{data.returnAWB}</strong>
            </span>
          ) : null}
          {data.forwardAWB ? (
            <span>
              <small>Forward AWB</small>
              <strong className="tv-mono">{data.forwardAWB}</strong>
            </span>
          ) : null}
        </div>
      ) : null}
      {loading ? (
        <LoadingState label="Loading history…" />
      ) : events.length === 0 ? (
        <EmptyState title="No history found" message="Nothing has been recorded for this claim yet." icon="history" />
      ) : (
        <ol className="tv-cms-timeline">
          {events.map((h) => {
            const meta = iconFor(h.action_type);
            return (
              <li key={h._id}>
                <div className="tv-cms-timeline-date">
                  <strong>{formatDate(h.date, "dd MMM yyyy")}</strong>
                  <small>{formatDate(h.date, "hh:mm a")}</small>
                </div>
                <span className={`tv-cms-dot tone-${meta.tone} ${meta.flip ? "is-flipped" : ""}`.trim()} aria-hidden="true">
                  <Icon name={meta.icon} />
                  {meta.badge ? (
                    <span className="tv-cms-dot-badge">
                      <Icon name={meta.badge} />
                    </span>
                  ) : null}
                </span>
                <div className="tv-cms-timeline-body">
                  <p>{h.description}</p>
                  <small>{h.user ? `By ${h.user.name.fullName}` : h.feed ? `By ${h.feed.feedName}` : "By Admin"}</small>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </AppDialog>
  );
}
