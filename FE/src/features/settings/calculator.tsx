"use client";

import { useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/lib/use-async";
import { AppSettingsService } from "@/services/app-settings";
import { UserService } from "@/services/user-service";
import { useSelector } from "@/store";
import type { IPlan } from "@/types/common";
import type { IAppSetting, videoSizeRates } from "@/types/settings";
import { SettingsSection } from "./settings-shared";

interface Mark {
  value: number;
  label: string;
}

/** TrackVid `utils/credit-finder.ts`: credits of the smallest size slab that fits the video. */
function creditFinder(videoSize: number, rates: readonly videoSizeRates[]): number | null {
  const match = rates.filter((r) => r.videoSize >= videoSize).sort((a, b) => a.videoSize - b.videoSize)[0];
  return match ? match.credits : null;
}

/** A slider that only stops on the given marks (MUI `Slider step={null}`), built on a native range input. */
function MarkSlider({ label, marks, value, onChange }: { label: string; marks: readonly Mark[]; value: number; onChange: (value: number) => void }) {
  const found = marks.findIndex((m) => m.value === value);
  const index = found < 0 ? 0 : found;
  const percent = marks.length > 1 ? (index / (marks.length - 1)) * 100 : 0;
  return (
    <div className="tv-settings-slider">
      <span className="tv-settings-eyebrow">{label}</span>
      <input
        type="range"
        min={0}
        max={Math.max(0, marks.length - 1)}
        step={1}
        value={index}
        aria-label={label}
        aria-valuetext={marks[index]?.label}
        style={{ backgroundSize: `${percent}% 100%` }}
        onChange={(e) => {
          const next = marks[Number(e.currentTarget.value)];
          if (next) onChange(next.value);
        }}
      />
      <div className="tv-settings-slider-marks" aria-hidden="true">
        {marks.map((m, i) => (
          <span key={m.value} className={i === index ? "is-active" : undefined}>
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function MetricBlock({ label, credits, unitNoun, cost, end = false }: { label: string; credits: number | string | undefined; unitNoun: string; cost: string; end?: boolean }) {
  return (
    <div className={`tv-settings-metric ${end ? "is-end" : ""}`.trim()}>
      <span className="tv-settings-eyebrow">{label}</span>
      <div>
        <strong className="tv-settings-metric-credits">{credits ?? "—"}</strong> <small>Credits / {unitNoun}</small>
      </div>
      <div>
        <strong className="tv-settings-metric-cost">₹{cost}</strong> <small>/ {unitNoun}</small>
      </div>
    </div>
  );
}

/** TrackVid `components/settings/Calculator.tsx`: storage pricing calculator on the Video Settings tab. */
export function Calculator() {
  const user = useSelector((s) => s.profile.userProfile);
  const [backupDuration, setBackupDuration] = useState(60);
  const [avgVideoSize, setAvgVideoSize] = useState(100);
  const load = useAsync(
    () => Promise.all([UserService.getPlansWithUnprotectedAPI(), AppSettingsService.getAppSettings()]),
    [],
  );

  if (load.loading && !load.data) {
    return (
      <section className="glass-card tv-settings-card">
        <LoadingState label="Loading calculator…" />
      </section>
    );
  }
  if (load.error || !load.data) {
    return (
      <section className="glass-card tv-settings-card">
        <ErrorState message={load.error} onRetry={load.reload} title="Could not load the pricing calculator" />
      </section>
    );
  }

  const [plans, appSettings]: [IPlan[], IAppSetting] = load.data;
  const sizeMarks: Mark[] = appSettings.videoSizeRates.map((r) => ({ value: r.videoSize, label: `${r.videoSize} MB` }));
  const durationMarks: Mark[] = appSettings.backupDurationRates.map((r) => ({ value: r.days, label: `${r.days} Days` }));

  const creditPlan = user?.company.creditPlan;
  // TrackVid matches the plan by id; the mock profile's plan id differs from the plan list, so fall back to the name.
  const chosenPlan = plans.find((p) => p._id === creditPlan?._id) ?? plans.find((p) => p.type === "CREDIT" && p.name === creditPlan?.name);
  const totalCredits = (chosenPlan?.credit || 1000) + (chosenPlan?.bonus || 0);
  const pricePerCredit = (chosenPlan?.price || 1000) / totalCredits;

  const backupRate = appSettings.backupDurationRates.find((r) => r.days === backupDuration);
  let requiredCredits: number | undefined;
  let vmsCost = "";
  if (backupRate) {
    requiredCredits = backupRate.credits + (creditFinder(avgVideoSize, appSettings.videoSizeRates) ?? 0) + (appSettings.vmsCredits || 1);
    vmsCost = (requiredCredits * pricePerCredit).toFixed(2);
  }
  const cmsCost = ((appSettings.cmsCredits || 1) * pricePerCredit).toFixed(2);
  const planName = creditPlan?.name === "Free" ? "Plan1000" : (creditPlan?.name ?? "—");

  return (
    <SettingsSection
      icon="calculator"
      title="Storage Pricing Calculator"
      className="tv-settings-calculator"
      description={
        <>
          Pick a desired video size and storage duration. A charge of <strong className="tv-settings-accent">{requiredCredits ?? "—"}</strong> credits will
          apply.
        </>
      }
    >
      <div className="tv-stack">
        <MarkSlider label="Video Size" marks={sizeMarks} value={avgVideoSize} onChange={setAvgVideoSize} />
        <MarkSlider label="Video Backup Duration" marks={durationMarks} value={backupDuration} onChange={setBackupDuration} />
      </div>
      <hr className="tv-divider" />
      <p className="tv-muted tv-small">
        According to your current plan — <strong className="tv-strong">{planName}</strong>
      </p>
      <div className="tv-settings-metrics">
        <MetricBlock label="For VMS" credits={requiredCredits} unitNoun="Video" cost={vmsCost} />
        <MetricBlock label="For CMS" credits={appSettings.cmsCredits ?? "—"} unitNoun="Claim" cost={cmsCost} end />
      </div>
    </SettingsSection>
  );
}
