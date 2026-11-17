"use client";

import { useState, type ReactNode } from "react";
import { getIn } from "formik";
import type { ExistingCmsPreview, StoredFile } from "@/types/cms-create";
import { ImageSlot, MultiImageSlots, RearrangeButton, SectionTitle, req, type PlatformFormProps, type SlotItem } from "@/features/cms-create/form-bits";
import { errorAt, keyOfUrl, rawErrorAt, stringAt } from "@/features/cms-create/hooks";
import type { MediaSrc } from "@/features/cms-create/media/media-thumb";
import { RearrangeDialog, type ArrangementField } from "@/features/cms-create/rearrange-dialog";
import { useVmsScreenshots } from "@/features/cms-create/use-vms-screenshots";

export type BundleGroup =
  | { kind: "single"; id: string; path: string; label: string; short: string; required?: boolean; hint?: string; maxMb?: number; fromClaim?: (c: ExistingCmsPreview) => StoredFile | string | null | undefined }
  | { kind: "multi"; id: string; path: string; label: string; short: string; required?: boolean; hint?: string; max: number; defaultSlots: number; maxMb: number; fromClaim?: (c: ExistingCmsPreview) => (StoredFile | null)[] | undefined };

const srcOf = (v: StoredFile | string | null | undefined): string | null => (!v ? null : typeof v === "string" ? v : (v.url ?? v.fileKey ?? null));
const keyOf = (v: StoredFile | string | null | undefined): string => (!v ? "" : typeof v === "string" ? keyOfUrl(v) : (v.fileKey ?? ""));

/**
 * Right column for the bundle platforms (Myntra, Flipkart, Delhivery, Amazon, Tata CliQ, Xbees): single named slots
 * and multi-image grids that write into `myntraClaimDetails` / `otherClaimDetails`. VMS frames fill the slots in
 * order and open the Rearrange dialog; a loaded claim (/cms/update) shows its stored images.
 */
export function BundlePanel({ props, groups, title, hint, extra, groupError }: { props: PlatformFormProps; groups: BundleGroup[]; title: string; hint?: string; extra?: ReactNode; groupError?: string }) {
  const { formik, feedId, existingClaim, carryOverImages, isUpdateMode } = props;
  const [singles, setSingles] = useState<Record<string, MediaSrc | null>>({});
  const [multis, setMultis] = useState<Record<string, SlotItem[]>>({});
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  if (existingClaim && existingClaim._id !== hydratedId) {
    setHydratedId(existingClaim._id);
    const s: Record<string, MediaSrc | null> = {};
    const m: Record<string, SlotItem[]> = {};
    for (const g of groups) {
      if (g.kind === "single") s[g.id] = srcOf(g.fromClaim?.(existingClaim));
      else m[g.id] = (g.fromClaim?.(existingClaim) ?? []).filter((f): f is StoredFile => Boolean(f)).map((f) => ({ key: keyOf(f), src: srcOf(f) }));
    }
    setSingles((p) => ({ ...p, ...s }));
    setMultis((p) => ({ ...p, ...m }));
  }

  const setMulti = (g: Extract<BundleGroup, { kind: "multi" }>, items: SlotItem[]) => {
    setMultis((p) => ({ ...p, [g.id]: items }));
    void formik.setFieldValue(g.path, items.map((i) => i.key));
    void formik.setFieldTouched(g.path, true, false);
  };

  // Flattened slot list for VMS fill and the Rearrange dialog.
  const flat: { field: string; label: string; group: BundleGroup; index: number }[] = [];
  for (const g of groups) {
    if (g.kind === "single") flat.push({ field: g.id, label: g.short, group: g, index: 0 });
    else for (let i = 0; i < g.max; i += 1) flat.push({ field: `${g.id}_${i}`, label: `${g.short} ${i + 1}`, group: g, index: i });
  }
  const schema: ArrangementField[] = flat.map((f, i) => ({ fieldName: f.field, label: f.label, position: i === 0 ? "first" : i === flat.length - 1 ? "last" : "middle" }));
  const previews: Record<string, MediaSrc | null> = {};
  for (const f of flat) previews[f.field] = f.group.kind === "single" ? (singles[f.group.id] ?? null) : (multis[f.group.id]?.[f.index]?.src ?? null);

  /** Key a preview was uploaded / fetched under, wherever it sits now. */
  const keyForSrc = (v: MediaSrc): string => {
    if (typeof v === "string") return keyOfUrl(v);
    for (const g of groups) {
      if (g.kind === "single" && singles[g.id] === v) return stringAt(formik, g.path);
      if (g.kind === "multi") {
        const hit = (multis[g.id] ?? []).find((it) => it.src === v);
        if (hit) return hit.key;
      }
    }
    return "";
  };

  const applyFlat = (values: (MediaSrc | null)[]) => {
    const nextSingles: Record<string, MediaSrc | null> = {};
    const nextMultis: Record<string, SlotItem[]> = {};
    flat.forEach((f, i) => {
      const v = values[i] ?? null;
      if (f.group.kind === "single") {
        nextSingles[f.group.id] = v;
        void formik.setFieldValue(f.group.path, v === null ? "" : keyForSrc(v));
      } else if (v) {
        (nextMultis[f.group.id] ??= []).push({ key: keyForSrc(v), src: v });
      }
    });
    for (const g of groups) if (g.kind === "multi") nextMultis[g.id] ??= [];
    setSingles((p) => ({ ...p, ...nextSingles }));
    setMultis((p) => ({ ...p, ...nextMultis }));
    for (const g of groups) if (g.kind === "multi") void formik.setFieldValue(g.path, (nextMultis[g.id] ?? []).map((i) => i.key).filter(Boolean));
  };

  const vms = useVmsScreenshots({
    awb: formik.values.AWBNumber,
    forwardAwb: formik.values.forwardAWB,
    previews,
    imageFields: flat.map((f) => f.field),
    carryOverImages,
    isUpdateMode,
    populate: (shots) => applyFlat(flat.map((_, i) => shots[i] ?? null)),
    reset: () => applyFlat(flat.map(() => null)),
  });

  return (
    <>
      <SectionTitle icon="image" title={title} hint={hint} />
      <RearrangeButton show={vms.fetchedScreenshots.length > 0 || vms.forwardOnlyScreenshots.length > 0} onClick={() => vms.setRearrangeModalOpen(true)} />
      {groupError ? <span className="tv-field-error">{groupError}</span> : null}
      {groups.map((g) =>
        g.kind === "single" ? (
          <ImageSlot
            key={g.id}
            formik={formik}
            feedId={feedId}
            name={g.path}
            label={g.label}
            required={g.required}
            hint={g.hint}
            maxMb={g.maxMb}
            preview={singles[g.id]}
            onFileChange={(_, file) => setSingles((p) => ({ ...p, [g.id]: file }))}
            size="lg"
          />
        ) : (
          <div key={g.id} className="tv-cmsc-field">
            <span className="tv-cmsc-label">
              {g.required ? req(g.label) : g.label}
              {g.hint ? <em>{g.hint}</em> : null}
            </span>
            <MultiImageSlots items={multis[g.id] ?? []} onChange={(items) => setMulti(g, items)} max={g.max} defaultSlots={g.defaultSlots} maxMb={g.maxMb} feedId={feedId} label={g.short} />
            {(() => {
              const err = errorAt(formik, g.path) ?? (getIn(formik.touched, g.path) || formik.submitCount > 0 ? rawErrorAt(formik, g.path) : undefined);
              return err ? <span className="tv-field-error">{err}</span> : null;
            })()}
          </div>
        ),
      )}
      {extra}
      {vms.rearrangeModalOpen ? <RearrangeDialog title="Rearrange Product Screenshots" schema={schema} images={vms.rearrangeImagePool} initialSlotImages={vms.rearrangeInitialSlots} onSave={applyFlat} onClose={() => vms.setRearrangeModalOpen(false)} /> : null}
    </>
  );
}
