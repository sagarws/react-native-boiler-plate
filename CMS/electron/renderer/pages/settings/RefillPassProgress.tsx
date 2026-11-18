import { useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, SkipForward } from "lucide-react";
import type {
  RefillPassProgress as PassProgress,
  RefillPhase,
  RefillPlatformState,
  RefillProgress,
} from "@shared/types/refill";
import { platformLabel } from "@shared/utils/platformKey";
import { SkipPlatformButton } from "@renderer/components/layout/SkipPlatformButton";
import {
  onRefillPass,
  onRefillProgress,
} from "@renderer/services/refill.service";

/**
 * Refill Data while it runs: which pass, every marketplace, and where it is.
 *
 * WHAT IT REPLACES. The card showed one chip per marketplace with a count from
 * BEFORE the run — "Ajio 3 to refill · 136 past the limit" — and nothing at
 * all once the run started. So the only thing on screen during the part that
 * takes an hour was the word "Running", and an operator watching it could not
 * tell a sweep working through seven marketplaces from one stuck on the first.
 *
 * TWO EVENTS, because neither is enough alone. The pass event says which
 * marketplaces this pass will reach and which one it is on; the claim-by-claim
 * event carries the live numbers for the one that is working. Without the
 * first there is no list; without the second the running chip sits still for
 * minutes at a time and reads as stalled.
 */

const ICONS: Record<RefillPlatformState, typeof CircleDashed> = {
  waiting: CircleDashed,
  running: Loader2,
  done: CheckCircle2,
  skipped: SkipForward,
};

const TONES: Record<RefillPlatformState, string> = {
  waiting: "text-faint",
  running: "text-accent",
  done: "text-success-fg",
  skipped: "text-muted",
};

const PASS_LABEL = {
  blanks: "Blanks",
  status: "Claim status",
} as const;

/**
 * Which scheduled task owns each pass. They are separate tasks now — Refill
 * Data and Status change — so a Skip pressed on one must name that one.
 */
const PASS_TASK = {
  blanks: "refill-data",
  status: "status-change",
} as const;

export const RefillPassProgress = ({
  running,
  phase,
}: {
  running: boolean;
  /** The pass this row of the card owns. The other task's events are ignored. */
  phase: RefillPhase;
}) => {
  const [pass, setPass] = useState<PassProgress | null>(null);
  const [live, setLive] = useState<RefillProgress | null>(null);

  useEffect(() => {
    const stopPass = onRefillPass((next) => {
      // Both tasks broadcast on one channel; this row shows only its own.
      if (next.phase !== phase) return;

      setPass(next);

      // The run has moved on, so the previous platform's live numbers no
      // longer describe anything on screen.
      if (!next.running) setLive(null);
    });
    const stopLive = onRefillProgress(setLive);

    return () => {
      stopPass();
      stopLive();
    };
  }, [phase]);

  /*
   * THE GAP THIS CLOSES: "Running", and nothing underneath it.
   *
   * A pass ends with a `running: false` tick, and the task has TWO of them.
   * Hiding the block on that tick meant the whole panel went blank between
   * the blanks pass and the status pass — the task badge still said Running,
   * no platform was ringed, and nothing on screen said what it was doing. The
   * same blank appeared whenever a pass had no rows to ask about.
   *
   * So the block now follows the TASK, not the pass. It disappears when the
   * task is over; while the task is going it always says where it has got to,
   * even if that is "between passes". The chips below are drawn from the last
   * pass either way, and `settled` stops any of them still spinning once the
   * pass that owned them has finished.
   */
  if (!running) return null;

  const settled = pass !== null && !pass.running;
  const empty = pass === null || pass.platforms.length === 0;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-xs text-faint">
        {/* WHICH PASS, said plainly. The two ask different questions of
            different rows, and "Refill Data is running" does not say which —
            which is the first thing somebody watching wants to know. */}
        {pass === null ? (
          "Starting…"
        ) : settled ? (
          <>
            Finished the{" "}
            <span className="font-medium text-body">
              {pass.phase ? PASS_LABEL[pass.phase] : "refill"}
            </span>{" "}
            pass
          </>
        ) : (
          <>
            Running the{" "}
            <span className="font-medium text-body">
              {pass.phase ? PASS_LABEL[pass.phase] : "refill"}
            </span>{" "}
            pass
          </>
        )}
        {/* A pass with nothing to ask is a real outcome, and silence read as a
            stall. */}
        {settled && empty && " · it had nothing to ask"}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {(pass?.platforms ?? []).map((entry) => {
          const Icon = ICONS[entry.state];
          // A finished pass leaves no platform working, whatever its last tick
          // said — otherwise a chip spins on through the gap between passes.
          const isRunning = entry.state === "running" && !settled;
          /*
           * The running platform's numbers come from the live event, which
           * updates per claim; a finished one keeps the totals the pass event
           * left on it. Same three numbers either way, so the chip does not
           * change shape as the run passes over it.
           */
          const checked = isRunning && live ? live.done : entry.checked;
          const changed = isRunning && live ? live.filled : entry.changed;
          const skipped =
            isRunning && live ? live.untouched + live.notFound : entry.skipped;
          const total = isRunning && live ? live.total : null;

          return (
            <span
              key={entry.platform}
              title={entry.note ?? undefined}
              className={
                isRunning
                  ? "flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs ring-1 ring-accent"
                  : "flex items-center gap-1.5 rounded-full bg-surface-active px-2.5 py-1 text-xs"
              }
            >
              <Icon
                size={12}
                className={`${TONES[entry.state]} ${isRunning ? "animate-spin" : ""}`}
              />
              <span
                className={isRunning ? "font-medium text-body" : "text-muted"}
              >
                {platformLabel(entry.platform)}
              </span>

              {entry.state === "waiting" && (
                <span className="text-faint">waiting</span>
              )}

              {entry.state === "skipped" && (entry.upToDate ?? 0) === 0 && (
                <span className="text-faint">skipped</span>
              )}

              {/*
                ITS OWN BADGE, not the word "skipped".
                These claims were not asked about because the marketplace
                already answered within the last few days — and the run records
                each answer as it lands, so an app closed at 32/580 keeps those
                32 and the next run starts at 33. Shown in the success tone
                because it is work ALREADY DONE; "skipped" is grey because
                nothing happened, and reading the two as the same thing makes a
                sweep that dropped from 580 to 32 look like a fault.
              */}
              {(entry.upToDate ?? 0) > 0 && (
                <span
                  title={`${entry.upToDate} claim(s) answered within the last few days — not asked again this run`}
                  className="rounded-full bg-success-surface px-1.5 py-px text-success-fg ring-1 ring-success-border"
                >
                  {entry.upToDate} up to date
                </span>
              )}

              {(entry.state === "running" || entry.state === "done") && (
                <span className="tabular-nums text-muted">
                  {checked}
                  {total !== null ? `/${total}` : ""} checked · {changed}{" "}
                  changed
                  {skipped > 0 ? ` · ${skipped} skipped` : ""}
                </span>
              )}

              {/* Both passes get it, because either can be the slow one: the
                  blanks pass asks about every unfilled row, the status pass
                  re-checks every ticket still moving. */}
              {isRunning && (
                <SkipPlatformButton
                  taskId={PASS_TASK[phase]}
                  platform={entry.platform}
                  label={platformLabel(entry.platform)}
                />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
};
