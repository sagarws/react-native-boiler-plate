import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import {
  refillTargets,
  resetRefillAttempts,
} from "@renderer/services/automationSchedule.service";
import { classNames } from "@renderer/utils/format";
import { useToast } from "@renderer/hooks/useToast";
import { WORKING_NOW_RING } from "@renderer/components/layout/workingNow";
import {
  onRefillPass,
  onRefillProgress,
} from "@renderer/services/refill.service";
import type { RefillTarget } from "@shared/types/automationSchedule";

/**
 * Which marketplaces Refill Data is about to ask, and how it is getting on.
 *
 * THE ROW USED TO SAY NOTHING. Auto claim lists its marketplaces and turns them
 * green as they finish; the refill beside it reported one line after the fact —
 * "delhivery 0 · xbees 0 · ajio 0" — which is the same sentence whether every
 * row was already complete, every row failed, or nothing was asked at all. An
 * operator looking at a claim with no account, under a run that reported 0,
 * has no way to tell which of those happened.
 *
 * So the same shape as Auto claim: a chip per marketplace, red while there is
 * work outstanding, green when there is not, and the one in hand named while it
 * runs.
 *
 * EXHAUSTED IS SHOWN SEPARATELY, because it is the answer to that operator's
 * question. A row asked MAX_REFILL_ATTEMPTS times is skipped by every later
 * run — so "0 filled" on a platform with rows left is not the marketplace
 * having nothing to give, it is this app having stopped asking.
 */

interface Row {
  platform: string;
  pending: number;
  exhausted: number;
  /** Filled this run, once one has happened in this sitting. */
  filled: number | null;
  running: boolean;
}

const key = (platform: string): string => platform.toLowerCase();

export const RefillTargets = ({ running }: { running: boolean }) => {
  /** The platform whose Reset is asking for a second click. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const toast = useToast();
  const [targets, setTargets] = useState<RefillTarget[]>([]);
  /** Per platform, from the live run — null until it reports. */
  const [filled, setFilled] = useState<Map<string, number>>(new Map());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const response = await refillTargets();

    if (response.success) setTargets(response.data);
  }, []);

  /*
   * One effect, and the work inside an async wrapper.
   *
   * `running` is a dependency rather than a second effect: a run ending is the
   * moment the counts it changed are worth re-reading, and it is the same read.
   * Wrapped rather than called straight because every setState in this app
   * happens after an await, and the lint rule reads the effect body literally —
   * see AutoClaimTargets for the same shape.
   */
  useEffect(() => {
    void (async () => {
      await load();

      if (!running) setBusyKey(null);
    })();
  }, [load, running]);

  /*
   * THE SECOND SOURCE, and the reason a run could look like it was working on
   * nothing.
   *
   * `onRefillProgress` only ticks when a CLAIM comes back, so the minutes
   * between opening a marketplace and its first answer — sign-in, a slow
   * first page — had no platform marked at all. The pass event says which one
   * the run is ON, which is true from the moment it starts on it.
   *
   * Both write the same key, and they agree: the claim tick is the same
   * platform the pass is on. Whichever arrives first marks it.
   */
  /*
   * ONLY REFILL DATA'S OWN WORK.
   *
   * Status change broadcasts on the same two channels, and these chips used to
   * take its ticks as their own — so while Status change asked Ajio, the Refill
   * Data chip for Ajio said "asking now", and two tasks that run one after the
   * other looked like they were running together. The pass event names its
   * phase; the claim-by-claim one does not, so it is gated on this task
   * actually running.
   */
  const runningRef = useRef(running);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(
    () =>
      onRefillPass((progress) => {
        if (progress.phase !== "blanks") return;

        const working = progress.platforms.find(
          (entry) => entry.state === "running",
        );

        setBusyKey(progress.running && working ? key(working.platform) : null);
      }),
    [],
  );

  useEffect(
    () =>
      onRefillProgress((progress) => {
        if (!runningRef.current) return;

        const platform = key(progress.platform);

        setBusyKey(progress.running ? platform : null);
        setFilled((previous) => {
          const next = new Map(previous);

          next.set(platform, progress.filled);

          return next;
        });
      }),
    [],
  );

  const rows: Row[] = targets.map((target) => ({
    platform: target.platform,
    pending: target.pending,
    exhausted: target.exhausted,
    filled: filled.get(key(target.platform)) ?? null,
    running: busyKey === key(target.platform),
  }));

  /**
   * Two clicks: the first states the count, the second does it.
   *
   * The count is what makes it a decision — "Reset" says nothing about whether
   * this is 3 rows or 144, and 144 is a night of browser time.
   */
  const reset = useCallback(
    async (platform: string) => {
      if (confirming !== platform) {
        setConfirming(platform);

        return;
      }

      setConfirming(null);
      setResetting(platform);

      const response = await resetRefillAttempts(platform);

      setResetting(null);

      if (!response.success) {
        toast.error(response.error.message);

        return;
      }

      // The server's number, not ours: rows can have been reset elsewhere, or
      // the platform's spelling may match more than this card counted.
      toast.info(
        `${platform}: ${response.data} row(s) back in the refill — they are asked again on the next run.`,
      );
      await load();
    },
    [confirming, load, toast],
  );

  if (rows.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {rows.map((row) => {
        const done = row.pending === 0;
        // Keeps its own red or green and gains the ring, rather than going
        // grey: the chip being asked about was the faintest in the row.
        const tone = classNames(
          done
            ? "bg-success-surface text-success-fg ring-success-border"
            : "bg-danger-surface text-danger-fg ring-danger-border",
          row.running && WORKING_NOW_RING,
        );

        return (
          <span
            key={row.platform}
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ${tone}`}
          >
            {row.running ? (
              <Loader2 size={12} className="animate-spin" />
            ) : done ? (
              <CheckCircle2 size={12} />
            ) : (
              <AlertCircle size={12} />
            )}

            {row.platform}

            <span className="font-normal">
              {row.running
                ? "asking now"
                : row.pending > 0
                  ? `${row.pending} to refill`
                  : row.filled !== null
                    ? `${row.filled} filled`
                    : "nothing to refill"}
              {/* The part that explains a run reporting zero. */}
              {row.exhausted > 0 && ` · ${row.exhausted} past the limit`}
            </span>

            {/*
              THE WAY BACK IN, where the number that needs explaining is.

              A row is retired after three fruitless asks, which is right when
              the marketplace keeps saying it has never heard of the AWB. It was
              also charged when the marketplace REFUSED TO LOOK — a rate limit, a
              502 — so a single burst could retire a whole sweep over the state
              of a gateway. The runner no longer charges those; these are the
              rows it already retired, and without this there was no way to let
              them back in short of editing the database.

              TWO CLICKS, because it is a real decision: letting 144 rows back in
              is a night of browser time, and the second click is where the count
              is stated. Not a modal — this is a chip in a card, and a dialog for
              a reversible action nobody is in the middle of is heavier than the
              thing it guards.
            */}
            {row.exhausted > 0 && !row.running && (
              <button
                type="button"
                disabled={resetting === row.platform}
                onClick={() => void reset(row.platform)}
                title={`Let ${row.exhausted} retired row(s) back into the nightly refill`}
                className="ms-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-px text-2xs font-medium ring-1 ring-current/30 transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                <RotateCcw size={10} aria-hidden="true" />
                {resetting === row.platform
                  ? "Resetting"
                  : confirming === row.platform
                    ? `Reset ${row.exhausted}?`
                    : "Reset"}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
};
