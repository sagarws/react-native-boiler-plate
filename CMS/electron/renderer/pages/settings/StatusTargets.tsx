import { useEffect, useState } from "react";
import { statusTargets } from "@renderer/services/automationSchedule.service";
import { platformLabel } from "@shared/utils/platformKey";
import type { StatusTarget } from "@shared/types/automationSchedule";

/**
 * Status change between runs: every marketplace it asks, and how much is due.
 *
 * The run's own chips (RefillPassProgress) only exist while it is going, so
 * the section used to be empty the rest of the day — no way to see which
 * marketplaces it covers or how much is waiting. This is the same sweep the
 * run makes: every claim with a ticket, split into AWBs DUE (their
 * CLAIM_STATUS_SYNC_DAYS have passed in `status-record`, or they were never
 * processed) and AWBs still up to date.
 *
 * Re-read when a run ends, which is when the counts move.
 */
export const StatusTargets = ({ running }: { running: boolean }) => {
  const [targets, setTargets] = useState<StatusTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (running) return;

    let cancelled = false;

    void (async () => {
      const response = await statusTargets();

      if (cancelled) return;

      if (response.success) {
        setTargets(response.data);
        setError(null);
      } else {
        setError(response.error.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [running]);

  // The run's own chips take over while it goes.
  if (running) return null;

  if (error) return <p className="mt-2 text-xs text-danger-fg">{error}</p>;

  if (targets === null) {
    return <p className="mt-2 text-xs text-faint">Counting filed tickets…</p>;
  }

  if (targets.length === 0) {
    return <p className="mt-2 text-xs text-faint">No filed ticket to check yet.</p>;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {targets.map((target) => {
        const done = target.due === 0;

        return (
          <span
            key={target.platform}
            title={`${target.due} AWB(s) due · ${target.upToDate} checked within the window`}
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ${
              done
                ? "bg-success-surface text-success-fg ring-success-border"
                : "bg-danger-surface text-danger-fg ring-danger-border"
            }`}
          >
            <i className={done ? "tabler-circle-check" : "tabler-alert-circle"} />
            {platformLabel(target.platform)}
            <span className="font-normal">
              {done ? "nothing due" : `${target.due} due`}
              {target.upToDate > 0 && ` · ${target.upToDate} up to date`}
            </span>
          </span>
        );
      })}
    </div>
  );
};
