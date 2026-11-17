"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { errorMessage } from "@/lib/events";
import { CmsService } from "@/services/cms-service";
import type { AjioSyncData, AjioSyncOutcome, AjioSyncRow, CompanyCredential } from "@/types/cms";

const BUCKETS: readonly { key: AjioSyncOutcome; label: string; help: string; tone: "green" | "amber" | "red" | "blue"; icon: IconName }[] = [
  { key: "filled", label: "Ready to apply", help: "AJIO returned a single, unambiguous answer for these.", tone: "green", icon: "check-circle" },
  { key: "choose_sku", label: "Choose SKU", help: "The return holds more than one article. Pick the one this claim is for.", tone: "amber", icon: "warning" },
  { key: "differs", label: "Differs from CMS", help: "A value is already stored and AJIO disagrees. Nothing is ticked — review each one.", tone: "amber", icon: "warning" },
  { key: "not_found", label: "Not found in AJIO", help: "No return matching this AWB under any POB of any connected account.", tone: "blue", icon: "minus" },
  { key: "not_claimable", label: "Not claimable", help: "AJIO can find the return but holds no detail for it — usually an old or incomplete return.", tone: "blue", icon: "question" },
  { key: "error", label: "Errored", help: "AJIO answered with an error for these rows.", tone: "red", icon: "x-circle" },
];

const RETRY_ON_NEXT_ACCOUNT = new Set<AjioSyncOutcome>(["not_found"]);
type Phase = "sweeping" | "review" | "applying" | "done" | "error";

/**
 * TrackVid `AjioSkuPobSyncModal`: sweeps each connected AJIO account for the selected claims' POB ID and Seller SKU,
 * groups the answers, and writes only what the operator ticks.
 */
export function AjioSyncDialog({ selectedIds, onClose, onSynced }: { selectedIds: readonly string[]; onClose: () => void; onSynced: () => void }) {
  const [phase, setPhase] = useState<Phase>("sweeping");
  const [accounts, setAccounts] = useState<CompanyCredential[]>([]);
  const [accountIdx, setAccountIdx] = useState(0);
  const [rows, setRows] = useState<AjioSyncRow[]>([]);
  const [skipped, setSkipped] = useState<{ cmsId: string; reason: string }[]>([]);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ choose_sku: true, differs: true });
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [skuByRow, setSkuByRow] = useState<Record<string, string>>({});
  const [applyResult, setApplyResult] = useState<{ wrote: number; failed: number } | null>(null);
  const cancelledRef = useRef(false);
  const wroteAnythingRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const ids = [...selectedIds];
    const sweep = async () => {
      let ajio: CompanyCredential[] = [];
      try {
        ajio = (await CmsService.getMyCompanyCredentials()).data.ajio ?? [];
      } catch (e) {
        if (cancelledRef.current) return;
        setError(errorMessage(e, "Could not load this company's AJIO accounts."));
        setPhase("error");
        return;
      }
      if (cancelledRef.current) return;
      if (!ajio.length) {
        setError("No AJIO account is connected to this company, so there is nothing to sync from.");
        setPhase("error");
        return;
      }
      // Accounts with a live session first: they answer without a fresh login.
      const ordered = [...ajio].sort((a, b) => Number(Boolean(b.ajioSession)) - Number(Boolean(a.ajioSession)));
      setAccounts(ordered);
      const collected: AjioSyncRow[] = [];
      const localNotes: string[] = [];
      let pending = ids;
      for (let i = 0; i < ordered.length && pending.length; i += 1) {
        if (cancelledRef.current) return;
        setAccountIdx(i);
        const account = ordered[i];
        let data: AjioSyncData;
        try {
          data = (await CmsService.ajioSkuPobSync({ credentialId: account.credentialId, ids: pending })).data;
        } catch (e) {
          if (cancelledRef.current) return;
          localNotes.push(`${account.username}: ${errorMessage(e, "sync failed")}`);
          setNotes([...localNotes]);
          continue;
        }
        if (cancelledRef.current) return;
        if (!collected.length && data.skipped.length) setSkipped(data.skipped);
        if (data.partial) localNotes.push(`${account.username}: ran out of time with ${data.unresolved.length} row(s) unchecked — run again to continue.`);
        const carry: string[] = [];
        for (const r of data.results) {
          const row = { ...r, account: data.username || account.username, credentialId: account.credentialId };
          if (RETRY_ON_NEXT_ACCOUNT.has(row.outcome) && i < ordered.length - 1) carry.push(row.cmsId);
          else collected.push(row);
        }
        for (const u of data.unresolved) carry.push(u.cmsId);
        setRows([...collected]);
        setNotes([...localNotes]);
        pending = carry;
      }
      if (cancelledRef.current) return;
      for (const id of pending) collected.push({ cmsId: id, awb: "", outcome: "not_found", pobId: "", storeName: "", currentPobId: "", currentSku: "", articles: [] });
      const nextTicked: Record<string, boolean> = {};
      const nextSku: Record<string, string> = {};
      for (const r of collected) {
        if (r.outcome !== "filled") continue;
        if ((r.pobId && !r.currentPobId) || (r.resolvedSku && !r.skuUnchanged)) nextTicked[r.cmsId] = true;
        if (r.resolvedSku) nextSku[r.cmsId] = r.resolvedSku;
      }
      setRows([...collected]);
      setTicked(nextTicked);
      setSkuByRow(nextSku);
      setPhase("review");
    };
    void sweep();
    return () => {
      cancelledRef.current = true;
    };
  }, [selectedIds]);

  const changesFor = (r: AjioSyncRow) => {
    const out: { pobId?: string; skuName?: string; overwrite?: boolean } = {};
    if (r.pobId && r.pobId !== r.currentPobId) out.pobId = r.pobId;
    const sku = skuByRow[r.cmsId] || r.resolvedSku || "";
    if (sku && sku !== r.currentSku) out.skuName = sku;
    if ((r.currentPobId && out.pobId) || (r.currentSku && out.skuName)) out.overwrite = true;
    return out;
  };
  const applicable = rows.filter((r) => ticked[r.cmsId] && Object.keys(changesFor(r)).length > 0);

  const apply = async () => {
    if (!applicable.length) return;
    setPhase("applying");
    const byAccount = new Map<string, AjioSyncRow[]>();
    for (const r of applicable) byAccount.set(r.credentialId ?? "", [...(byAccount.get(r.credentialId ?? "") ?? []), r]);
    let wrote = 0;
    let failed = 0;
    for (const [credentialId, group] of byAccount) {
      if (!credentialId) {
        failed += group.length;
        continue;
      }
      try {
        const res = await CmsService.ajioSkuPobApply({ credentialId, updates: group.map((r) => ({ cmsId: r.cmsId, ...changesFor(r) })) });
        wrote += res.data.wrote;
        failed += res.data.failed.length;
        if (res.data.wrote > 0) wroteAnythingRef.current = true;
      } catch (e) {
        failed += group.length;
        setNotes((prev) => [...prev, errorMessage(e, "Apply failed")]);
      }
    }
    if (cancelledRef.current) return;
    setApplyResult({ wrote, failed });
    setPhase("done");
  };

  const close = () => {
    cancelledRef.current = true;
    if (wroteAnythingRef.current) onSynced();
    onClose();
  };

  const sweepingLabel = accounts.length ? `Asking ${accounts[accountIdx]?.username ?? "AJIO"} (${accountIdx + 1} of ${accounts.length})…` : "Reading connected AJIO accounts…";

  const renderRow = (r: AjioSyncRow) => {
    const hasChange = Object.keys(changesFor(r)).length > 0;
    const isMulti = r.outcome === "choose_sku" || (r.outcome === "differs" && r.articles.length > 1);
    return (
      <li key={r.cmsId} className="tv-cms-sync-row">
        {hasChange || isMulti ? (
          <input
            type="checkbox"
            aria-label={`Apply ${r.awb || r.cmsId}`}
            checked={Boolean(ticked[r.cmsId])}
            disabled={!hasChange}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              setTicked((p) => ({ ...p, [r.cmsId]: checked }));
            }}
          />
        ) : (
          <span className="tv-cms-sync-spacer" />
        )}
        <div className="tv-cms-sync-body">
          <strong>
            {r.awb || r.cmsId}
            {r.storeName ? <span className="tv-muted tv-small"> · {r.storeName}</span> : null}
          </strong>
          {r.reason ? <small className="tv-muted">{r.reason}</small> : null}
          <div className="tv-row tv-small" style={{ gap: 16 }}>
            {r.pobId ? (
              <span>
                POB:{" "}
                {r.currentPobId && r.currentPobId !== r.pobId ? (
                  <>
                    <s>{r.currentPobId}</s> → <strong>{r.pobId}</strong>
                  </>
                ) : (
                  <strong>{r.pobId}</strong>
                )}
              </span>
            ) : null}
            {!isMulti ? (
              <span>
                SKU:{" "}
                {r.currentSku && r.resolvedSku && r.currentSku !== r.resolvedSku ? (
                  <>
                    <s>{r.currentSku}</s> → <strong>{r.resolvedSku}</strong>
                  </>
                ) : (
                  <strong>{r.resolvedSku || r.currentSku || "—"}</strong>
                )}
                {r.skuUnchanged ? <span className="tv-cms-ok"> (already matches)</span> : null}
              </span>
            ) : null}
          </div>
          {isMulti ? (
            <div className="tv-stack" style={{ gap: 6 }}>
              {r.currentSku ? (
                <small className="tv-cms-warn">
                  Stored SKU <strong>{r.currentSku}</strong> matches none of these articles.
                </small>
              ) : null}
              {r.articles.map((a) => (
                <label key={a.returnItemId} className="tv-cms-article">
                  <input
                    type="radio"
                    name={`sku-${r.cmsId}`}
                    checked={(skuByRow[r.cmsId] ?? "") === a.sku}
                    onChange={() => {
                      setSkuByRow((p) => ({ ...p, [r.cmsId]: a.sku }));
                      setTicked((p) => ({ ...p, [r.cmsId]: true }));
                    }}
                  />
                  {a.imageUrl ? <img src={a.imageUrl} alt="" /> : null}
                  <span>
                    <strong>{a.sku}</strong>
                    <small className="tv-muted">{[a.productName, a.color, a.quantity ? `qty ${a.quantity}` : ""].filter(Boolean).join(" · ")}</small>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <AppDialog
      title="AJIO Sync — SKU & POB"
      onClose={close}
      size="wide"
      locked={phase === "applying"}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={close} disabled={phase === "applying"}>
            {phase === "done" ? "Close" : "Cancel"}
          </button>
          {phase === "review" ? (
            <button type="button" className="primary-button" onClick={() => void apply()} disabled={!applicable.length}>
              Apply {applicable.length ? `(${applicable.length})` : ""}
            </button>
          ) : null}
          {phase === "applying" ? (
            <button type="button" className="primary-button" disabled>
              <span className="tv-spinner small" aria-hidden="true" /> Applying…
            </button>
          ) : null}
        </>
      }
    >
      <div className="tv-stack">
        <p className="tv-muted tv-small">
          Reads POB ID and Seller SKU from AJIO&apos;s own APIs, using each connected account&apos;s saved login. Use this when Master Sync found nothing. Only
          Pending and Failed to Proceed claims are touched, and nothing is written until you press Apply.
        </p>
        {error ? <Banner tone="error" title={error} /> : null}
        {phase === "sweeping" ? (
          <div className="tv-stack" style={{ gap: 8 }}>
            <div className="tv-row">
              <span className="tv-spinner small" aria-hidden="true" /> {sweepingLabel}
            </div>
            <div className="tv-progress">
              <span style={{ width: `${accounts.length ? (accountIdx / accounts.length) * 100 : 8}%` }} />
            </div>
            <small className="tv-muted">
              {rows.length} of {selectedIds.length} claim(s) answered so far. Each account is swept POB by POB and stops as soon as every claim is placed, so
              this usually finishes well before the last POB.
            </small>
          </div>
        ) : null}
        {phase === "review" || phase === "applying" || phase === "done" ? (
          <>
            {notes.map((n) => (
              <Banner key={n} tone="warning" title={n} />
            ))}
            {skipped.length ? (
              <Banner tone="info" title={`${skipped.length} selected claim(s) were not eligible: ${skipped.slice(0, 3).map((s) => s.reason).join("; ")}${skipped.length > 3 ? " …" : ""}`} />
            ) : null}
            {applyResult ? (
              <Banner tone={applyResult.failed ? "warning" : "success"} title={`Applied ${applyResult.wrote} claim(s)${applyResult.failed ? `, ${applyResult.failed} failed` : ""}.`} />
            ) : null}
            {BUCKETS.map(({ key, label, help, tone, icon }) => {
              const list = rows.filter((r) => r.outcome === key);
              if (!list.length) return null;
              const open = expanded[key] ?? false;
              return (
                <section key={key} className="tv-cms-bucket">
                  <button type="button" className="tv-cms-bucket-head" aria-expanded={open} onClick={() => setExpanded((p) => ({ ...p, [key]: !open }))}>
                    <span className={`c-status ${tone}`}>
                      <Icon name={icon} /> {label} {list.length}
                    </span>
                    <small className="tv-muted">{help}</small>
                    <Icon name={open ? "caret-up" : "caret-down"} />
                  </button>
                  {open ? <ul className="tv-cms-sync-list">{list.map(renderRow)}</ul> : null}
                </section>
              );
            })}
            {!rows.length ? <p className="tv-muted">AJIO returned nothing for this selection.</p> : null}
            <hr className="tv-divider" />
            <strong className="tv-small">{applicable.length} claim(s) will be written.</strong>
          </>
        ) : null}
      </div>
    </AppDialog>
  );
}
