"use client";

import { useEffect, useRef } from "react";
import { cmsScriptMock } from "@/services/cms-service";
import { useDispatch, useSelector } from "@/store";
import { enqueueOtpRequest, resolveOtpRequest } from "@/store/otp-prompt-slice";
import { completeScriptProgress, updateScriptProgress } from "@/store/script-progress-slice";

export interface AutoClaimRow {
  id: string;
  awb: string;
  platform: string;
  username: string;
}

export interface AutoClaimSummary {
  total: number;
  success: number;
  failed: number;
  dispatchedIds: string[];
  failedToProceedIds: string[];
}

interface JobState {
  jobId: string;
  rows: AutoClaimRow[];
  remaining: AutoClaimRow[];
  success: number;
  failed: number;
  errors: { awbNumber: string; error: string }[];
  failedAwbNumbers: string[];
  failedToProceedIds: string[];
  updates: number;
  otpRequestedAt: number | null;
  otpDone: boolean;
  otpTimedOut: boolean;
}

const STEP_MS = 1600;
const QUEUE_MS = 2500;
const OTP_WINDOW_MS = 60_000;
const ERRORS = ["Login failed: seller portal asked for captcha", "Order not found on the seller portal for this AWB", "Upload rejected: image larger than 5 MB"];

/** Wall clock for the timer callbacks (they never run during render). */
const nowMs = (): number => Date.now();
const isSnapdeal = (r: AutoClaimRow) => r.platform.trim().toLowerCase() === "snapdeal";

/** Same claim always gets the same simulated result (≈70% success, 20% failed, 10% Help Center failed). */
function outcomeFor(row: AutoClaimRow): { kind: "success" | "failed" | "help-center"; error?: string } {
  let h = 0;
  for (const ch of row.awb) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bucket = h % 10;
  if (bucket < 7) return { kind: "success" };
  if (bucket < 9) return { kind: "failed", error: ERRORS[h % ERRORS.length] };
  return { kind: "help-center", error: "Help Center form did not load in 30s" };
}

/**
 * Simulates the auto-claim worker + `cms:script:progress` / `cms:script:completed` socket events with timers.
 * Snapdeal rows wait for an OTP (enqueued like the socket's `cms:otp:request`). All timers stop on unmount; a job
 * still running then is settled at once so the shell's progress widget does not hang.
 */
export function useAutoClaimSimulation(callbacks: { onProgress: () => void; onCompleted: (summary: AutoClaimSummary) => void }) {
  const dispatch = useDispatch();
  const otp = useSelector((s) => s.otpPrompt);
  const otpRef = useRef(otp);
  const callbacksRef = useRef(callbacks);
  const holder = useRef<{ job: JobState | null; timers: Set<number> }>({ job: null, timers: new Set() });

  useEffect(() => {
    otpRef.current = otp;
    callbacksRef.current = callbacks;
  });

  const progressOf = (job: JobState) => ({
    jobId: job.jobId,
    total: job.rows.length,
    running: job.remaining.length,
    success: job.success,
    failed: job.failed,
    processed: job.success + job.failed,
    errors: [...job.errors],
    failedAwbNumbers: [...job.failedAwbNumbers],
    queued: 0,
    status: "RUNNING" as const,
  });

  const settleOne = (job: JobState, row: AutoClaimRow) => {
    const outcome = isSnapdeal(row) && job.otpTimedOut ? { kind: "failed" as const, error: "OTP not received in time" } : outcomeFor(row);
    const res = cmsScriptMock.settle(row.id, outcome.kind, outcome.error);
    if (outcome.kind === "success") job.success += 1;
    else {
      job.failed += 1;
      job.failedAwbNumbers.push(row.awb);
      job.errors.push({ awbNumber: row.awb, error: outcome.error ?? "Processing failed" });
      if (res.capped) job.failedToProceedIds.push(row.id);
    }
  };

  const finish = (job: JobState) => {
    holder.current.job = null;
    dispatch(completeScriptProgress({ ...progressOf(job), running: 0, processed: job.rows.length }));
    callbacksRef.current.onCompleted({
      total: job.rows.length,
      success: job.success,
      failed: job.failed,
      dispatchedIds: job.rows.map((r) => r.id),
      failedToProceedIds: job.failedToProceedIds,
    });
  };

  const schedule = (fn: () => void, ms: number) => {
    const timers = holder.current.timers;
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const step = () => {
    const job = holder.current.job;
    if (!job) return;
    const next = job.remaining[0];
    if (!next) {
      finish(job);
      return;
    }
    if (isSnapdeal(next) && !job.otpDone) {
      if (job.otpRequestedAt === null) {
        job.otpRequestedAt = nowMs();
        dispatch(
          enqueueOtpRequest({
            jobId: job.jobId,
            username: next.username || "Snapdeal seller",
            cmsIds: job.remaining.filter(isSnapdeal).map((r) => r.id),
            requestedAt: new Date(job.otpRequestedAt).toISOString(),
          }),
        );
        schedule(step, 1000);
        return;
      }
      const o = otpRef.current;
      const waiting = o.current?.jobId === job.jobId || o.queue.some((q) => q.jobId === job.jobId);
      if (waiting && nowMs() - job.otpRequestedAt < OTP_WINDOW_MS) {
        schedule(step, 1000);
        return;
      }
      job.otpDone = true;
      job.otpTimedOut = waiting;
      if (waiting) dispatch(resolveOtpRequest({ jobId: job.jobId, resolution: "TIMEOUT" }));
    }
    job.remaining.shift();
    settleOne(job, next);
    job.updates += 1;
    dispatch(updateScriptProgress(progressOf(job)));
    if (job.updates % 5 === 0) callbacksRef.current.onProgress();
    schedule(step, STEP_MS);
  };

  useEffect(() => {
    const h = holder.current;
    return () => {
      for (const id of h.timers) window.clearTimeout(id);
      h.timers.clear();
      const job = h.job;
      if (!job) return;
      // Leaving the page mid-run: settle what is left so the global widget reaches "processed".
      if (!job.otpDone && job.otpRequestedAt !== null) dispatch(resolveOtpRequest({ jobId: job.jobId, resolution: "TIMEOUT" }));
      job.otpTimedOut = !job.otpDone && job.remaining.some(isSnapdeal);
      for (const row of job.remaining.splice(0)) settleOne(job, row);
      h.job = null;
      dispatch(completeScriptProgress({ ...progressOf(job), running: 0, processed: job.rows.length }));
    };
  }, [dispatch]);

  const start = (args: { jobId: string; rows: AutoClaimRow[]; queued: boolean }) => {
    const job: JobState = {
      jobId: args.jobId,
      rows: args.rows,
      remaining: [...args.rows],
      success: 0,
      failed: 0,
      errors: [],
      failedAwbNumbers: [],
      failedToProceedIds: [],
      updates: 0,
      otpRequestedAt: null,
      otpDone: false,
      otpTimedOut: false,
    };
    holder.current.job = job;
    if (args.queued) {
      schedule(() => {
        cmsScriptMock.markRunning(args.rows.map((r) => r.id));
        dispatch(updateScriptProgress({ jobId: job.jobId, status: "RUNNING", queued: 0, running: args.rows.length, queuePosition: undefined, totalInQueue: undefined }));
        callbacksRef.current.onProgress();
        schedule(step, STEP_MS);
      }, QUEUE_MS);
    } else {
      schedule(step, STEP_MS);
    }
  };

  return { start };
}
