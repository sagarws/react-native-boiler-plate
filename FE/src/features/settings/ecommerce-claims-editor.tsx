"use client";

import { Fragment, useState, type DragEvent } from "react";
import { Icon } from "@/components/icons/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DefaultClaims, DefaultECommercePlatforms } from "@/config/constant";
import type { IEcommerce, IEcommerceClaimType } from "@/types/common";
import type { Claim } from "@/types/platform";
import { PlatformPills } from "./settings-shared";

/** Per-platform validation errors (TrackVid `validations/ecommerce-validation.ts`). */
export interface PlatformErrors {
  name?: string;
  claims: Record<number, string>;
}

export function validateEcommerce(list: readonly IEcommerce[]): Record<number, PlatformErrors> {
  const errors: Record<number, PlatformErrors> = {};
  list.forEach((platform, i) => {
    const entry: PlatformErrors = { claims: {} };
    if (!platform.name?.trim()) entry.name = "E-commerce name is required";
    platform.typeOfClaims.forEach((claim, ci) => {
      if (!claim.name?.trim()) entry.claims[ci] = "Claim type is required";
    });
    if (entry.name || Object.keys(entry.claims).length > 0) errors[i] = entry;
  });
  return errors;
}

/** Deep copy of default claims with `isDisable` filled in (the editor's claim type needs it). */
export function copyClaims(claims: readonly Claim[]): IEcommerceClaimType[] {
  return claims.map((c) => ({ ...c, isDisable: Boolean(c.isDisable) }));
}

/**
 * Default marketplaces shipped with the app: name, claim titles, delete and reset are read-only so
 * accounts can't diverge from the shared definitions. Custom platforms stay fully editable.
 */
const LOCKED_PLATFORM_NAMES = new Set(["flipkart", "amazon", "myntra", "ajio", "meesho", "snapdeal", "limeroad", "nykaa", "tata cliq", "xbees", "delhivery"]);

/** TrackVid `DropArea`: a gap between claims that lights up while a claim is dragged over it. */
function DropArea({ enabled, onDrop }: { enabled: boolean; onDrop: (e: DragEvent<HTMLElement>) => void }) {
  const [show, setShow] = useState(false);
  return (
    <section
      className={`tv-settings-drop ${show ? "is-visible" : ""}`.trim()}
      onDragEnter={() => {
        if (enabled) setShow(true);
      }}
      onDragLeave={() => setShow(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        onDrop(e);
        setShow(false);
      }}
    >
      Drop here
    </section>
  );
}

interface Props {
  values: IEcommerce[];
  onChange: (next: IEcommerce[]) => void;
  errors: Record<number, PlatformErrors> | null;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  canEdit: boolean;
  saving: boolean;
}

/** TrackVid `components/common/DynamicEcommerceClaims.tsx`: platform tabs + claim rows editor. */
export function EcommerceClaimsEditor({ values, onChange, errors, activeIndex, onActiveIndexChange, canEdit, saving }: Props) {
  const [drag, setDrag] = useState<{ platform: number; claim: number } | null>(null);
  const [claimToDelete, setClaimToDelete] = useState<{ platform: number; claim: number; name: string } | null>(null);
  const [platformToDelete, setPlatformToDelete] = useState<{ index: number; name: string } | null>(null);

  const setClaims = (platformIndex: number, claims: IEcommerceClaimType[]) =>
    onChange(values.map((p, i) => (i === platformIndex ? { ...p, typeOfClaims: claims } : p)));

  const updateClaim = (platformIndex: number, claimIndex: number, patch: Partial<IEcommerceClaimType>) =>
    setClaims(
      platformIndex,
      values[platformIndex].typeOfClaims.map((c, ci) => (ci === claimIndex ? { ...c, ...patch } : c)),
    );

  const handleAddEcommerce = () => {
    const next: IEcommerce[] = [...values, { name: "", tatPeriod: 0, typeOfClaims: copyClaims(DefaultClaims) }];
    onChange(next);
    onActiveIndexChange(next.length - 1);
  };

  const handleRemoveEcommerce = (index: number) => {
    const next = values.filter((_, i) => i !== index);
    onChange(next);
    setPlatformToDelete(null);
    if (activeIndex >= next.length) onActiveIndexChange(Math.max(0, next.length - 1));
  };

  const handleRemoveClaim = (platformIndex: number, claimIndex: number) => {
    setClaims(
      platformIndex,
      values[platformIndex].typeOfClaims.filter((_, ci) => ci !== claimIndex),
    );
    setClaimToDelete(null);
  };

  /** Unknown / custom platforms reset to `DefaultClaims`. Name, _id and TAT stay. */
  const handleResetPlatformClaims = (platformIndex: number) => {
    const name = values[platformIndex]?.name?.trim().toLowerCase();
    const defaults = DefaultECommercePlatforms.find((dp) => dp.name.trim().toLowerCase() === name);
    setClaims(platformIndex, copyClaims(defaults ? defaults.typeOfClaims : DefaultClaims));
  };

  const canDropAt = (platformIndex: number, target: number) =>
    drag !== null && drag.platform === platformIndex && target !== drag.claim && target - drag.claim !== 1;

  const onDrop = (e: DragEvent<HTMLElement>, platformIndex: number, target: number) => {
    e.preventDefault();
    if (drag && canDropAt(platformIndex, target)) {
      const claims = [...values[platformIndex].typeOfClaims];
      const [moved] = claims.splice(drag.claim, 1);
      claims.splice(target > drag.claim ? target - 1 : target, 0, { ...moved });
      setClaims(platformIndex, claims);
    }
    setDrag(null);
  };

  const active = values[activeIndex];
  const platformErrors = errors?.[activeIndex];
  const lockedName = active ? LOCKED_PLATFORM_NAMES.has(active.name?.trim().toLowerCase() ?? "") : false;

  return (
    <>
      <div className="tv-row tv-settings-pill-row">
        {values.length > 0 ? (
          <PlatformPills names={values.map((p) => p.name)} value={activeIndex} onChange={onActiveIndexChange} label="E-commerce platforms" />
        ) : null}
        {canEdit ? (
          <button type="button" className="secondary-button compact-button" onClick={handleAddEcommerce} disabled={saving}>
            <Icon name="plus" />
            Add Platform
          </button>
        ) : null}
      </div>

      {!active ? (
        <div className="tv-settings-empty">No platforms configured yet.</div>
      ) : (
        <div className="tv-settings-platform-card">
          <div className="tv-settings-platform-head">
            <span className="tv-settings-label">Platform</span>
            <div className={`c-field tv-settings-name-field ${platformErrors?.name ? "has-error" : ""}`.trim()}>
              <input
                type="text"
                placeholder="E-commerce Name"
                aria-label="E-commerce Name"
                required
                aria-invalid={Boolean(platformErrors?.name)}
                value={active.name}
                disabled={saving || !canEdit || lockedName}
                onChange={(e) => {
                  const name = e.currentTarget.value;
                  onChange(values.map((p, i) => (i === activeIndex ? { ...p, name } : p)));
                }}
              />
              {platformErrors?.name ? <span className="tv-field-error">{platformErrors.name}</span> : null}
            </div>
            {canEdit ? (
              <button
                type="button"
                className="icon-button tv-settings-danger-icon"
                aria-label="Remove platform"
                title={lockedName ? "Default platforms cannot be removed" : values.length < 2 ? "At least one platform is required" : "Remove platform"}
                disabled={values.length < 2 || lockedName}
                onClick={() => setPlatformToDelete({ index: activeIndex, name: active.name })}
              >
                <Icon name="x" />
              </button>
            ) : null}
            {canEdit && !lockedName ? (
              <button
                type="button"
                className="secondary-button compact-button tv-settings-danger-outline tv-settings-push"
                title="Reset this platform's claims to defaults"
                disabled={saving}
                onClick={() => handleResetPlatformClaims(activeIndex)}
              >
                <Icon name="rotate-cw" />
                Reset
              </button>
            ) : null}
          </div>

          <div>
            <span className="tv-settings-label">Claims</span>
            <div className="tv-settings-claims">
              <DropArea enabled={canDropAt(activeIndex, 0)} onDrop={(e) => onDrop(e, activeIndex, 0)} />
              {active.typeOfClaims.map((claim, claimIndex) => {
                const claimError = platformErrors?.claims[claimIndex];
                const isPartial = claim.key === "partial_articles_received";
                return (
                  <Fragment key={claimIndex}>
                    <div
                      className={`tv-settings-claim ${claim.isDisable ? "is-disabled" : ""} ${drag?.claim === claimIndex && drag.platform === activeIndex ? "is-dragging" : ""}`
                        .replace(/\s+/g, " ")
                        .trim()}
                      draggable={canEdit}
                      onDragStart={() => setDrag({ platform: activeIndex, claim: claimIndex })}
                      onDragEnd={() => setDrag(null)}
                    >
                      <span className={`tv-settings-drag ${canEdit ? "" : "is-static"}`.trim()} title="Drag to reorder" aria-hidden="true">
                        <Icon name="drag-handle" />
                      </span>
                      <div className={`c-field tv-settings-claim-title ${claimError ? "has-error" : ""}`.trim()}>
                        <label htmlFor={`claim-${activeIndex}-${claimIndex}-name`}>
                          Claim Title <small>*</small>
                        </label>
                        <input
                          id={`claim-${activeIndex}-${claimIndex}-name`}
                          type="text"
                          placeholder="Claim Title"
                          required
                          aria-invalid={Boolean(claimError)}
                          value={claim.name}
                          disabled={saving || !canEdit || claim.isDisable || lockedName}
                          onChange={(e) => updateClaim(activeIndex, claimIndex, { name: e.currentTarget.value })}
                        />
                        {claimError ? <span className="tv-field-error">{claimError}</span> : null}
                      </div>
                      <div className="c-field tv-settings-claim-desc">
                        <label htmlFor={`claim-${activeIndex}-${claimIndex}-desc`}>Description</label>
                        <textarea
                          id={`claim-${activeIndex}-${claimIndex}-desc`}
                          rows={1}
                          placeholder="Description"
                          value={claim.description}
                          disabled={saving || !canEdit}
                          onChange={(e) => updateClaim(activeIndex, claimIndex, { description: e.currentTarget.value })}
                        />
                      </div>
                      {canEdit ? (
                        !isPartial ? (
                          <button
                            type="button"
                            className="icon-button tv-settings-danger-icon"
                            aria-label="Delete claim"
                            title="Delete claim"
                            disabled={active.typeOfClaims.length < 2 || saving || claim.isDisable || lockedName}
                            onClick={() => setClaimToDelete({ platform: activeIndex, claim: claimIndex, name: claim.name })}
                          >
                            <Icon name="trash" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={claim.isDisable ? "Enable claim" : "Disable claim"}
                            title={claim.isDisable ? "Enable claim" : "Disable claim"}
                            aria-pressed={claim.isDisable}
                            disabled={active.typeOfClaims.length < 2 || saving || lockedName}
                            onClick={() => updateClaim(activeIndex, claimIndex, { isDisable: !claim.isDisable })}
                          >
                            <Icon name={claim.isDisable ? "lock" : "key"} />
                          </button>
                        )
                      ) : null}
                    </div>
                    <DropArea enabled={canDropAt(activeIndex, claimIndex + 1)} onDrop={(e) => onDrop(e, activeIndex, claimIndex + 1)} />
                  </Fragment>
                );
              })}
              {canEdit ? (
                <div className="tv-settings-add-claim">
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    disabled={saving || lockedName}
                    onClick={() =>
                      setClaims(activeIndex, [...active.typeOfClaims, { name: "", description: "", key: "other", isDisable: false }])
                    }
                  >
                    <Icon name="plus" />
                    Add Claim
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {claimToDelete ? (
        <ConfirmDialog
          title="Delete E-commerce Claim"
          message={`Are you sure you want to delete Claim - ${claimToDelete.name}?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          onConfirm={() => handleRemoveClaim(claimToDelete.platform, claimToDelete.claim)}
          onClose={() => setClaimToDelete(null)}
        />
      ) : null}
      {platformToDelete ? (
        <ConfirmDialog
          title="Delete E-commerce Platform"
          message={`Are you sure you want to delete ${platformToDelete.name} e-commerce platform?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          onConfirm={() => handleRemoveEcommerce(platformToDelete.index)}
          onClose={() => setPlatformToDelete(null)}
        />
      ) : null}
    </>
  );
}
