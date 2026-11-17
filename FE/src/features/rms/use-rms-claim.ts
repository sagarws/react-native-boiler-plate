"use client";

import { useEffect, useRef } from "react";
import { RmsService } from "@/services/rms-service";
import { useDispatch } from "@/store";
import { completeScriptProgress, updateScriptProgress } from "@/store/script-progress-slice";

export interface RmsClaimRow {
  id: string;
  awb: string;
}

interface Job {
  jobId: string;
  rows: RmsClaimRow[];
  remaining: RmsClaimRow[];
  success: number;
  failed: number;
  failedAwbNumbers: string[];
  errors: { awbNumber: string; error: string }[];
  updates: number;
}

const QUEUE_MS = 1500;
const STEP_MS = 1700;

/**
 * Simulates the claim worker and the `cms:script:progress` / `cms:script:completed` socket events RMS.tsx listens to,
 * with timers that are always cleared. Progress goes to the global script-progress widget; the page refreshes every
 * 5 updates and on completion (same cadence as TrackVid). Leaving the page settles the rest at once.
 */
export function useRmsClaimSimulation(callbacks: { onRefresh: () => void; onCompleted: (summary: { total: number; success: number; failed: number }) => void }) {
  const dispatch = useDispatch();
  const callbacksRef = useRef(callbacks);
  const holder = useRef<{ job: Job | null; timers: Set<number> }>({ job: null, timers: new Set() });

  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  const progressOf = (job: Job) => ({
    jobId: job.jobId,
    total: job.rows.length,
    running: job.remaining.length,
    success: job.success,
    failed: job.failed,
    processed: job.success + job.failed,
    failedAwbNumbers: [...job.failedAwbNumbers],
    errors: [...job.errors],
    queued: 0,
    status: "RUNNING" as const,
  });

  const settle = (job: Job, row: RmsClaimRow) => {
    const outcome = RmsService.claimOutcome(row.awb);
    if (outcome.ok) {
      job.success += 1;
      RmsService.recordClaimSuccess(row.id, outcome.ticket).catch(() => {
        // The ticket link is cosmetic in the mock; a missing row just keeps its old ticket.
      });
    } else {
      job.failed += 1;
      job.failedAwbNumbers.push(row.awb);
      job.errors.push({ awbNumber: row.awb, error: outcome.error });
    }
  };

  const schedule = (fn: () => void, ms: number) => {
    const timers = holder.current.timers;
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const finish = (job: Job) => {
    holder.current.job = null;
    dispatch(completeScriptProgress({ ...progressOf(job), running: 0, processed: job.rows.length, status: undefined }));
    callbacksRef.current.onRefresh();
    callbacksRef.current.onCompleted({ total: job.rows.length, success: job.success, failed: job.failed });
  };

  const step = () => {
    const job = holder.current.job;
    if (!job) return;
    const next = job.remaining.shift();
    if (!next) {
      finish(job);
      return;
    }
    settle(job, next);
    job.updates += 1;
    dispatch(updateScriptProgress(progressOf(job)));
    if (job.updates % 5 === 0) callbacksRef.current.onRefresh();
    if (!job.remaining.length) finish(job);
    else schedule(step, STEP_MS);
  };

  useEffect(() => {
    const h = holder.current;
    return () => {
      for (const id of h.timers) window.clearTimeout(id);
      h.timers.clear();
      const job = h.job;
      if (!job) return;
      // Leaving the page mid-run: settle what is left so the global widget reaches "processed".
      for (const row of job.remaining.splice(0)) settle(job, row);
      h.job = null;
      dispatch(completeScriptProgress({ ...progressOf(job), running: 0, processed: job.rows.length, status: undefined }));
    };
  }, [dispatch]);

  const start = (jobId: string, rows: RmsClaimRow[]) => {
    holder.current.job = { jobId, rows, remaining: [...rows], success: 0, failed: 0, failedAwbNumbers: [], errors: [], updates: 0 };
    dispatch(updateScriptProgress({ jobId, status: "QUEUED", queued: rows.length, queuePosition: 1, totalInQueue: 1 }));
    schedule(() => {
      dispatch(updateScriptProgress({ jobId, status: "RUNNING", queued: 0, running: rows.length, queuePosition: undefined, totalInQueue: undefined }));
      schedule(step, STEP_MS);
    }, QUEUE_MS);
  };

  return { start };
}
