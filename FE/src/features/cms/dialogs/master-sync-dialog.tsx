"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { errorMessage } from "@/lib/events";
import { CmsService } from "@/services/cms-service";
import type { MasterSyncCandidateRow, MasterSyncField, MasterSyncApplyPayload } from "@/types/cms";

const SYNC_FIELDS: readonly { key: MasterSyncField; label: string }[] = [
  { key: "forwardAWB", label: "Forward AWB" },
  { key: "skuName", label: "Seller SKU" },
  { key: "pobId", label: "POB ID" },
];

type RowOutcome = "synced" | "nothing" | "skipped" | "failed" | "ineligible";

interface RowResult {
  cmsId: string;
  awb: string;
  outcome: RowOutcome;
  detail: string;
}

const OUTCOME_META: Record<RowOutcome, { label: string; tone: "green" | "amber" | "red" | "blue"; icon: IconName }> = {
  synced: { label: "Synced", tone: "green", icon: "check-circle" },
  nothing: { label: "No master data", tone: "amber", icon: "question" },
  skipped: { label: "Skipped", tone: "blue", icon: "minus" },
  failed: { label: "Failed", tone: "red", icon: "x-circle" },
  ineligible: { label: "Not eligible", tone: "blue", icon: "minus" },
};

const EMPTY_PICKS: Record<MasterSyncField, string> = { forwardAWB: "", skuName: "", pobId: "" };

const isAmbiguous = (row: MasterSyncCandidateRow): boolean => SYNC_FIELDS.some(({ key }) => (row.candidates?.[key]?.length ?? 0) > 1);
const defaultPicks = (row: MasterSyncCandidateRow): Record<MasterSyncField, string> => ({
  forwardAWB: row.candidates?.forwardAWB?.[0] ?? "",
  skuName: row.candidates?.skuName?.[0] ?? "",
  pobId: row.candidates?.pobId?.[0] ?? "",
});

async function applyRow(row: MasterSyncCandidateRow, chosen: Record<MasterSyncField, string>): Promise<{ result: RowResult; wrote: boolean }> {
  const awb = row.AWBNumber || row.cmsId;
  const payload: MasterSyncApplyPayload = { cmsId: row.cmsId };
  for (const { key } of SYNC_FIELDS) if (chosen[key]) payload[key] = chosen[key];
  if (Object.keys(payload).length === 1) return { result: { cmsId: row.cmsId, awb, outcome: "nothing", detail: "Master data has no value for the missing fields" }, wrote: false };
  try {
    const res = await CmsService.masterSyncApply(payload);
    if (!res.isSuccess) return { result: { cmsId: row.cmsId, awb, outcome: "failed", detail: res.displayMessage || "Sync rejected by the server" }, wrote: false };
    const keys = Object.keys(res.data.applied) as MasterSyncField[];
    if (!keys.length) {
      const why = res.data.skipped.map((s) => `${s.field}: ${s.reason}`).join("; ");
      return { result: { cmsId: row.cmsId, awb, outcome: "nothing", detail: why || "Nothing left to fill" }, wrote: false };
    }
    return {
      result: { cmsId: row.cmsId, awb, outcome: "synced", detail: keys.map((k) => `${SYNC_FIELDS.find((f) => f.key === k)?.label ?? k} → ${res.data.applied[k]}`).join(", ") },
      wrote: true,
    };
  } catch (err) {
    return { result: { cmsId: row.cmsId, awb, outcome: "failed", detail: errorMessage(err, "Request failed") }, wrote: false };
  }
}

/**
 * TrackVid `MasterSyncModal`: walks the selected claims one at a time, fills blank Forward AWB / Seller SKU /
 * POB ID from master data, and pauses only on rows where master data offers a choice.
 */
export function MasterSyncDialog({ selectedIds, onClose, onSynced }: { selectedIds: readonly string[]; onClose: () => void; onSynced: () => void }) {
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [rows, setRows] = useState<MasterSyncCandidateRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [results, setResults] = useState<RowResult[]>([]);
  const [applying, setApplying] = useState(false);
  const [picks, setPicks] = useState<Record<MasterSyncField, string>>(EMPTY_PICKS);
  const wroteAnythingRef = useRef(false);
  const cancelledRef = useRef(false);

  const runFrom = async (startAt: number, list: MasterSyncCandidateRow[]) => {
    setApplying(true);
    let i = startAt;
    while (i < list.length) {
      if (cancelledRef.current) return;
      const row = list[i];
      if (!row.eligible) {
        const r: RowResult = { cmsId: row.cmsId, awb: row.AWBNumber || row.cmsId, outcome: "ineligible", detail: row.reason || "Not eligible for sync" };
        setResults((prev) => [...prev, r]);
        i += 1;
        continue;
      }
      if (isAmbiguous(row)) {
        setPicks(defaultPicks(row));
        setCursor(i);
        setApplying(false);
        return;
      }
      const { result, wrote } = await applyRow(row, defaultPicks(row));
      if (cancelledRef.current) return;
      if (wrote) wroteAnythingRef.current = true;
      setResults((prev) => [...prev, result]);
      i += 1;
    }
    setCursor(list.length);
    setApplying(false);
  };
  const runFromRef = useRef(runFrom);
  useEffect(() => {
    runFromRef.current = runFrom;
  });

  useEffect(() => {
    cancelledRef.current = false;
    const ids = [...selectedIds];
    CmsService.masterSyncCandidates({ ids })
      .then(async (res) => {
        if (cancelledRef.current) return;
        if (!res.isSuccess) {
          setLoadError(res.displayMessage || "Could not read master data for this selection.");
          setLoadingCandidates(false);
          return;
        }
        setRows(res.data);
        setLoadingCandidates(false);
        await runFromRef.current(0, res.data);
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return;
        setLoadError(errorMessage(err, "Could not read master data for this selection."));
        setLoadingCandidates(false);
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [selectedIds]);

  const currentRow = cursor < rows.length ? rows[cursor] : null;
  const needsDecision = Boolean(currentRow && currentRow.eligible && isAmbiguous(currentRow) && !applying);
  const isFinished = !loadingCandidates && !loadError && rows.length > 0 && cursor >= rows.length;
  const counts: Record<RowOutcome, number> = { synced: 0, nothing: 0, skipped: 0, failed: 0, ineligible: 0 };
  for (const r of results) counts[r.outcome] += 1;
  const pct = rows.length ? Math.round((results.length / rows.length) * 100) : 0;

  const close = () => {
    cancelledRef.current = true;
    if (wroteAnythingRef.current) onSynced();
    onClose();
  };
  const applyAndNext = async () => {
    if (!currentRow) return;
    setApplying(true);
    const { result, wrote } = await applyRow(currentRow, picks);
    if (cancelledRef.current) return;
    if (wrote) wroteAnythingRef.current = true;
    setResults((prev) => [...prev, result]);
    await runFrom(cursor + 1, rows);
  };
  const skip = async () => {
    if (!currentRow) return;
    setResults((prev) => [...prev, { cmsId: currentRow.cmsId, awb: currentRow.AWBNumber || currentRow.cmsId, outcome: "skipped", detail: "Skipped by operator" }]);
    await runFrom(cursor + 1, rows);
  };
  const stop = () => {
    cancelledRef.current = true;
    const remaining = rows.slice(results.length);
    setResults((prev) => [...prev, ...remaining.map((r) => ({ cmsId: r.cmsId, awb: r.AWBNumber || r.cmsId, outcome: "skipped" as const, detail: "Run stopped before this row" }))]);
    setCursor(rows.length);
    setApplying(false);
  };

  return (
    <AppDialog
      title="Master Sync"
      onClose={close}
      size="wide"
      locked={applying}
      footer={
        needsDecision ? (
          <>
            <button type="button" className="secondary-button" onClick={() => void skip()} disabled={applying}>
              Skip
            </button>
            <button type="button" className="primary-button" onClick={() => void applyAndNext()} disabled={applying}>
              Apply &amp; Next
            </button>
          </>
        ) : (
          <>
            {applying ? (
              <button type="button" className="secondary-button" onClick={stop}>
                Stop
              </button>
            ) : null}
            <button type="button" className="primary-button" onClick={close} disabled={applying}>
              {isFinished ? "Close" : "Cancel"}
            </button>
          </>
        )
      }
    >
      <div className="tv-stack">
        <p className="tv-muted tv-small">
          Fills blank Forward AWB, Seller SKU and POB ID from master data. Only Pending and Failed to Proceed claims are touched, and a field that already has a
          value is never overwritten.
        </p>
        {loadingCandidates ? (
          <div className="tv-row">
            <span className="tv-spinner small" aria-hidden="true" /> Reading master data for {selectedIds.length} claim(s)…
          </div>
        ) : null}
        {loadError ? <Banner tone="error" title={loadError} /> : null}
        {!loadingCandidates && !loadError && rows.length === 0 ? <Banner tone="info" title="No claims to sync in this selection." /> : null}
        {!loadingCandidates && !loadError && rows.length > 0 ? (
          <>
            <div className="tv-stack" style={{ gap: 8 }}>
              <div className="tv-row-between">
                <strong className="tv-small">
                  {results.length} of {rows.length} processed
                </strong>
                <span className="tv-row" style={{ gap: 6 }}>
                  {(Object.keys(counts) as RowOutcome[])
                    .filter((k) => counts[k] > 0)
                    .map((k) => (
                      <span key={k} className={`c-status ${OUTCOME_META[k].tone}`}>
                        {OUTCOME_META[k].label} {counts[k]}
                      </span>
                    ))}
                </span>
              </div>
              <div className="tv-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${pct}%` }} />
              </div>
            </div>
            {needsDecision && currentRow ? (
              <div className="tv-cms-decision">
                <strong>Choose the master record for AWB {currentRow.AWBNumber}</strong>
                <p className="tv-muted tv-small">
                  This AWB matches more than one master row. Defaults are pre-selected — press Apply &amp; Next to accept them, change a value first, or skip this
                  claim.
                </p>
                {SYNC_FIELDS.map(({ key, label }) => {
                  const options = currentRow.candidates?.[key] ?? [];
                  if (!options.length) return null;
                  return (
                    <label key={key} className="c-field">
                      <span>
                        {label}
                        {options.length > 1 ? <span className="tv-muted"> — {options.length} options</span> : null}
                      </span>
                      <select value={picks[key]} onChange={(e) => setPicks((p) => ({ ...p, [key]: e.currentTarget.value }))}>
                        <option value="">Leave blank</option>
                        {options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            ) : null}
            {applying && !needsDecision ? (
              <div className="tv-row tv-small">
                <span className="tv-spinner small" aria-hidden="true" /> Syncing…
              </div>
            ) : null}
            {results.length ? (
              <ul className="tv-cms-result-list">
                {results.map((r, idx) => (
                  <li key={`${r.cmsId}-${idx}`} className={`tone-${OUTCOME_META[r.outcome].tone}`}>
                    <Icon name={OUTCOME_META[r.outcome].icon} />
                    <div>
                      <strong>
                        {r.awb} — {OUTCOME_META[r.outcome].label}
                      </strong>
                      <small>{r.detail}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {isFinished ? (
              <Banner
                tone={counts.failed > 0 ? "warning" : "success"}
                title={`Done. ${counts.synced} synced${counts.nothing ? `, ${counts.nothing} with no master data` : ""}${counts.skipped ? `, ${counts.skipped} skipped` : ""}${counts.ineligible ? `, ${counts.ineligible} not eligible` : ""}${counts.failed ? `, ${counts.failed} failed` : ""}.`}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </AppDialog>
  );
}
