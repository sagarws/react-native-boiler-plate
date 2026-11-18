import { useCallback, useEffect, useState } from "react";
import { Eye, LoaderCircle, ShieldAlert } from "lucide-react";
import type { AutomationScheduleState } from "@shared/types/automationSchedule";
import { Switch } from "@renderer/components/ui/Switch";
import { Tooltip } from "@renderer/components/ui/Tooltip";
import { useToast } from "@renderer/hooks/useToast";
import {
  automationScheduleState,
  onScheduleChanged,
  setSchedulePaused,
} from "@renderer/services/automationSchedule.service";
import { CronJobsModal } from "./CronJobsModal";

/**
 * The master switch for the nightly schedule, at the foot of the rail.
 *
 * WHY IT IS HERE AND NOT ONLY IN SETTINGS. The schedule runs with nobody
 * watching, and the two things an operator wants from it are both urgent: "is
 * it on?", answerable at a glance from any screen, and "stop it", reachable
 * without first finding the right settings tab while a marketplace is throwing
 * errors. The per-task switches stay in Settings, where choosing what this
 * machine does at all belongs.
 *
 * OFF IS NOT THE SAME AS EVERY TASK BEING OFF. This leaves the four task
 * switches exactly as they were and simply stops the whole thing running, so
 * turning it back on does not mean remembering which ones were enabled.
 */
interface CronSwitchProps {
  /**
   * The way out of an automatic pause: the Login page. Not a Run now of the
   * Login update — with Automations off nothing runs, that included — but a
   * capture made there lifts the pause by itself.
   */
  onOpenLogin: () => void;
}

export const CronSwitch = ({ onOpenLogin }: CronSwitchProps) => {
  const toast = useToast();
  const [state, setState] = useState<AutomationScheduleState | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void automationScheduleState().then((response) => {
      if (!cancelled && response.success) setState(response.data);
    });

    // Pushed, not polled: a scheduled run starts with nobody watching, and the
    // switch has to show "running" for something the operator did not press.
    const unsubscribe = onScheduleChanged((next) => {
      if (!cancelled) setState(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const toggle = useCallback(
    async (next: boolean) => {
      setSaving(true);

      const response = await setSchedulePaused(!next);

      setSaving(false);

      if (!response.success) {
        toast.error(response.error.message);

        return;
      }

      setState(response.data);
      toast.info(
        next
          ? "Automations on — catching up on anything that was missed."
          : response.data.stopping
            ? "Automations off — what is running stops after the step it is on."
            : "Automations off — nothing runs in the background until you switch it back on.",
      );
    },
    [toast],
  );

  // Nothing at all until the first answer arrives, rather than a switch that
  // starts in the wrong position and corrects itself a moment later.
  if (!state) return null;

  const running = state.tasks.filter((task) => task.running).length;
  const queued = state.tasks.filter((task) => task.queued).length;
  const on = !state.paused;

  const status = state.stopping
    ? "Stopping…"
    : running > 0
      ? `Running ${running}${queued > 0 ? ` · ${queued} queued` : ""}`
      : on
        ? "Idle"
        : "Off";

  /*
   * THE APP STOPPED ITSELF, AND THIS IS THE ONLY PLACE THAT SAYS SO.
   *
   * An operator who finds the switch off assumes somebody turned it off. When
   * the app turned it off — because the Login update could not re-capture
   * every login, and nothing below it can sign in — saying nothing turns a
   * five-minute errand into a morning of wondering why last night did nothing.
   *
   * So it states the cause, names the logins, and carries the fix, in the rail
   * where the switch itself lives rather than on a page they would have to
   * think to visit.
   */
  const heldOnSessions = state.paused && state.pausedBy === "sessions";

  return (
    <div className="legacy-tokens flex w-full min-w-0 flex-col gap-2">
      {heldOnSessions && (
        /*
         * SIZED FOR THE RAIL IT LIVES IN, which is the whole of this markup.
         *
         * The first version was laid out as if it had a page to sit on: a
         * sentence on one line, the platform list on another, a solid red
         * button across the bottom. In a 200px rail the sentence was cut
         * mid-word, the platforms were cut mid-word, and the button was the
         * loudest object on the screen — an alert nobody could read, shouting.
         *
         * Two rules fix it and both have to hold. Every level gets `min-w-0`,
         * because a flex child defaults to `min-width:auto` and refuses to
         * shrink below its text, which is what clipped the words rather than
         * wrapping them. And the volume comes down: a tint and a ring instead
         * of a slab, an outlined button instead of a filled one. It is already
         * the only coloured thing down here — it does not need to be the
         * brightest too.
         */
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md bg-danger-surface p-2 ring-1 ring-danger-border">
          <div className="flex min-w-0 items-start gap-1.5">
            <ShieldAlert
              size={13}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-danger-fg"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-snug font-medium break-words text-danger-fg">
                Automations paused
              </p>
              <p className="text-xs leading-snug break-words text-danger-fg opacity-80">
                {/*
                 * The reason itself, which already reads as a sentence: "2
                 * logins still need re-capturing (xbees, tatacliq)". Prefixing
                 * it with a second sentence of our own said the same thing
                 * twice in a space that has room for neither.
                 */}
                {state.pausedDetail === ""
                  ? "Logins need re-capturing."
                  : state.pausedDetail}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenLogin}
            className="flex w-full min-w-0 items-center justify-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs font-medium break-words text-danger-fg ring-1 ring-danger-border transition-colors hover:bg-danger-surface disabled:opacity-60"
          >
            Re-capture on the Login page
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Tooltip
          label={
            on
              ? "Automations are on. Switch off to stop every background process."
              : "Automations are off — nothing runs in the background. Switch on to resume and catch up."
          }
        >
          <div className="min-w-0">
            <Switch
              compact
              checked={on}
              disabled={saving}
              onChange={(next) => void toggle(next)}
              label={<span className="text-xs font-medium">Automations</span>}
            />
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              {(running > 0 || state.stopping) && (
                <LoaderCircle
                  size={10}
                  aria-hidden="true"
                  className="animate-spin"
                />
              )}
              {status}
            </p>
          </div>
        </Tooltip>

        <Tooltip label="What is running, queued and scheduled">
          <button
            type="button"
            aria-label="View scheduled automations"
            onClick={() => setOpen(true)}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted ring-1 ring-subtle transition-colors hover:bg-surface-active hover:text-accent"
          >
            <Eye size={14} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      <CronJobsModal open={open} onClose={() => setOpen(false)} state={state} />
    </div>
  );
};
