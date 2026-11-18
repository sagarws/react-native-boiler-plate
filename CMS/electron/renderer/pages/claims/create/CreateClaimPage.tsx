import {
  Autocomplete,
  Box,
  CircularProgress,
  Grid,
  IconButton,
  Stack,
  TextField,
  Typography,
  Button as ButtonElement,
} from "@mui/material";
import { ArrowBackRounded as ArrowBackRoundedIcon } from "./icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { debounceAsync } from "./debounce";
import { needsSubReason, qcSelectionFromClaimType } from "./tatacliqQc";
import FeedPicker from "./FeedPicker";
import ReturnLookupSource from "./platforms/ajio/ReturnLookupSource";
import { noteLookupSource } from "@renderer/services/masterDataReport.service";
import type { ReturnLookupSourceValue } from "./types";
import MediaCaptureProvider from "./media/MediaCaptureProvider";
import BulkClaimModal from "./BulkClaimModal";
import BulkClaimChooser from "./bulk/BulkClaimChooser";
import NormalBulkClaimModal from "./bulk/NormalBulkClaimModal";
import BulkRunIndicator from "./bulk/BulkRunIndicator";
import PlatformIcon from "./PlatformIcon";
import HeaderFieldControl from "./HeaderFieldControl";
import { useCreateCmsForm } from "./useCreateClaimForm";
import { findCmsByAwb, getAutomationPlatforms } from "./api";
import {
  UPDATE_EXISTED_CLAIM_FROM_CMS,
  CLAIM_SAVE_AND_TICKET_CREATE,
} from "./constants";
import {
  PLATFORMS,
  platformDescriptor,
  resolvePlatformKey,
} from "./platforms/registry";
import { useClaimCatalogue } from "./ClaimCatalogue";
import { ClaimFormModeProvider } from "./ClaimFormMode";
import { useToastBridge } from "./toast";
import type { ECommercePlatformRecord } from "@shared/types/cmsCreate";
import { tint } from "./tint";
import { matchClaimTypeOption, selectableClaimTypes } from "./claimTypes";

interface PlatformOption {
  key: string;
  label: string;
  dot: string;
  isCustom?: boolean;
}

export interface CreateClaimPageProps {
  /**
   * The claim to open straight into, if any.
   *
   * Absent for a new claim. Present when the operator chose "Full edit" on a
   * row in the queue, which is this page's second job: the same form, opened on
   * a claim that already exists, with Save writing back to it.
   *
   * The web app is two URLs; this is one screen and a prop, because a desktop
   * window has no address bar to put the difference in.
   */
  target?: { awb: string; platform: string; } | undefined;
  /** Back to wherever the operator came from. Shown in update mode only. */
  onBack?: (() => void) | undefined;
}

/**
 * Colours for a company's own platforms, which have no registry entry and so no
 * colour of their own. Cycled in list order, so the same company always sees
 * the same platform in the same colour.
 *
 * VERCEL'S OWN ACCENTS, not Tailwind's. These were #8B5CF6/#F97316/#0EA5E9/…,
 * which are Tailwind's violet-500, orange-500 and so on — fine in isolation and
 * visibly from another palette once everything around them is Geist. The five
 * below are Vercel's published accent hexes, and there happen to be exactly
 * five of them, so the rotation keeps its length and every company keeps the
 * platform-to-colour pairing it already had.
 *
 * Literal hex rather than theme variables on purpose: these are identity
 * colours that must stay stable across light and dark so an operator learns
 * "the purple one is our returns portal", not semantic colours that should
 * shift with the scheme.
 */
const CUSTOM_DOTS = ["#7928CA", "#F5A623", "#0070F3", "#50E3C2", "#FF0080"];

const CreateCms = ({ target, onBack }: CreateClaimPageProps) => {
  // Lets the ported form call `toast.error(…)` from outside a component.
  useToastBridge();

  const isUpdateMode = Boolean(target);
  const urlAwb = target?.awb ?? "";
  const urlPlatform = target?.platform ?? "";
  const updateFlowEnabled = UPDATE_EXISTED_CLAIM_FROM_CMS || isUpdateMode;

  const [platformKey, setPlatformKey] = useState<string>(() =>
    urlPlatform ? resolvePlatformKey(urlPlatform) : "ajio",
  );
  const [feedId, setFeedId] = useState<string>("");
  /*
   * Report by default: the local backup answers instantly with no login, so
   * it is the everyday path. API is the deliberate choice for an order newer
   * than the last sync.
   * REPORT by default, by request: the nightly backup answers instantly and
   * without a sign-in, which is what most lookups want. API remains one click
   * away for a return order newer than the last sync.
   *
   * The trade is stated rather than hidden — the toggle's own tooltip says the
   * backup is "only as new as the last sync", and a Report lookup that finds
   * nothing says so instead of quietly asking AJIO. That refusal is the whole
   * reason this default is safe: the operator is told the backup had no answer,
   * rather than being given a slower one they did not ask for.
   */
  const [lookupSource, setLookupSource] = useState<ReturnLookupSourceValue>("report");
  // Bulk Claim opens a chooser first: Normal (the company's own template) or
  // Increff (the QC report). Each kind has its own modal.
  const [bulkChooserOpen, setBulkChooserOpen] = useState<boolean>(false);
  const [bulkClaimOpen, setBulkClaimOpen] = useState<boolean>(false);
  const [normalBulkOpen, setNormalBulkOpen] = useState<boolean>(false);
  const [sideImages, setSideImages] = useState<File[]>([]);
  const [isPartialArticleClaim, setIsPartialArticleClaim] = useState<boolean>(false);
  // `skus` is populated only when the /order/{awb} lookup returns >1
  // masterImport records for AJIO — the multi-record SKU picker writes the
  // chosen SKU here so the AJIO validation branch enforces skuName as
  // required (see cmsValidation in cms-create.validation.ts).
  const [skus, setSkus] = useState<string[]>([]);
  // Shared with CommonRightPart so the Rearrange modal defers opening while
  // the AJIO SKU picker is on-screen (both modals must not stack).
  const [skuPickerOpen, setSkuPickerOpen] = useState<boolean>(false);
  // Set when the active platform's claims carry a `parentSelection` field
  // (e.g. Flipkart). Used to filter Type Of Claim options by issue area.
  const [parentSelection, setParentSelection] = useState<string>("");
  // Bumping this remounts ActiveForm (both left & right instances), which is
  // the simplest way to clear each platform form's internally-owned image /
  // video preview state on Reset and on successful submit — those previews
  // are useState inside the child forms and not otherwise reachable here.
  const [resetSignal, setResetSignal] = useState<number>(0);

  const catalogue = useClaimCatalogue();
  /**
   * The platforms this company files under, and their claim catalogues.
   *
   * The COMPANY's list, not the registry's: a company that has not configured
   * Flipkart should not be offered it, and a company that added its own D2C
   * marketplace should be. The registry decides how each one is rendered and
   * filed; this decides which of them exist here at all.
   */
  const platforms: ECommercePlatformRecord[] = catalogue.platforms;
  const platformsLoading = catalogue.loading;

  // Increff Bulk Claim availability gates (Normal Bulk Claim is always offered):
  //   1. Company-level feature flag `settings.increffBulkClaim` must be on.
  //      Same flag gates the "Auto claim creation through Increff Report"
  //      settings tab, so the two entry points stay in lockstep.
  //   2. At least one platform toggled `allowed: true` in
  //      settings.increffAllocation — otherwise every CSV row is dropped
  //      by `skippedByPlatform` on the BE and the modal would be a dead
  //      end.
  const increffBulkAvailable = catalogue.increffBulkClaim && catalogue.hasIncreffAllocation;

  /**
   * One dropdown entry per platform the company has.
   *
   * A platform the registry knows keeps the registry's key, label and colour —
   * so "Nykaa" in the database reaches the operator as "Nykaa Fashion", the
   * name its seller portal uses. Anything else is a company's own platform: it
   * keys off its own name, takes a colour from the rotation below, and files
   * through the default form.
   */
  const platformOptions = useMemo<PlatformOption[]>(() => {
    const known = new Map(PLATFORMS.map((entry) => [entry.label.toLowerCase(), entry]));
    let customIdx = 0;

    return platforms
      .filter((p) => p?.name)
      .map((p): PlatformOption => {
        const hit = known.get(p.name.toLowerCase());

        if (hit) return { key: hit.key, label: hit.label, dot: hit.dot };

        const dot = CUSTOM_DOTS[customIdx++ % CUSTOM_DOTS.length] ?? "#7928CA";

        return { key: p.name.toLowerCase(), label: p.name, dot, isCustom: true };
      });
  }, [platforms]);

  /**
   * The option the picker is showing, or `null` while the catalogue loads.
   *
   * NULL, NEVER UNDEFINED. The company's platforms arrive over IPC a moment
   * after the first paint, so this is empty on that first render — and an
   * Autocomplete handed `undefined` decides it is UNCONTROLLED and keeps that
   * decision. The list then arrived, the form knew it was on AJIO, the AJIO
   * fields rendered, and the platform box stayed on "Select Platform" for the
   * rest of the session.
   */
  const selectedPlatformOption = useMemo(
    () => platformOptions.find((p) => p.key === platformKey) ?? platformOptions[0] ?? null,
    [platformOptions, platformKey],
  );

  const platformLabel = selectedPlatformOption?.label || "AJIO";
  /**
   * Everything this page renders differently per platform, in one lookup.
   *
   * The extra header selects, the cascade's vocabulary, which form to mount.
   * Nothing below branches on a platform name — adding a marketplace is one
   * folder under `platforms/` and one entry in its registry.
   */
  const platform = useMemo(() => platformDescriptor(platformKey), [platformKey]);
  const platformLower = platformLabel.trim().toLowerCase();

  // ---------------------------------------------------------------------------
  // Which platforms can be auto-claimed
  // ---------------------------------------------------------------------------
  // Two conditions, and BOTH must hold for the Create Ticket button to render:
  //
  //   1. CLAIM_SAVE_AND_TICKET_CREATE (helper/constant.ts) — the kill switch for
  //      the whole save-and-dispatch feature. Flip it to false and the toolbar
  //      returns to exactly today's behaviour: one "Save" button, no dispatch.
  //      Nothing on the BE needs redeploying for that; the createCMS auto-claim
  //      branch only ever fires on the flag the button sends.
  //   2. The platform has an Automated-Scripts runner — fetched from the BE,
  //      which reads it off validations/claimAutomation.validation.ts, the same
  //      file that decides whether a dispatch is allowed. Keeping the list
  //      server-side means the button and the gate can never disagree.
  //
  // The list starts empty, so until the fetch lands only "Save" renders. That is
  // the safe default: a missing button is a minor inconvenience, whereas a
  // button that promises a ticket the BE then refuses is a lie to the operator.
  const [automationPlatforms, setAutomationPlatforms] = useState<string[]>([]);

  useEffect(() => {
    // Skip the request entirely when the feature is off — the answer could not
    // change what renders.
    if (!CLAIM_SAVE_AND_TICKET_CREATE) return;

    let cancelled = false;
    getAutomationPlatforms()
      .then((res) => {
        if (cancelled) return;
        const list = res?.data?.data?.platforms;
        if (Array.isArray(list)) setAutomationPlatforms(list);
      })
      .catch(() => {
        // Non-fatal: the operator keeps plain Save plus the existing Auto Claim
        // button on /cms. Nothing here is worth a toast on a page they just
        // opened.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Matched on the platform KEY, never the display label. The two differ:
  // Nykaa's key is "nykaa" but its label is "Nykaa Fashion", and Tata CliQ's
  // key is "tataCliq" against the label "Tata CliQ". Matching on the label
  // would silently hide the button for Nykaa.
  //
  // Normalized the same way the BE's normalizePlatform does, so "tataCliq"
  // and "tatacliq" resolve identically on both sides. A custom (company-added)
  // platform keys off its own name and simply won't match — which is correct,
  // there is no runner for it.
  const canAutoClaim = useMemo(
    () =>
      CLAIM_SAVE_AND_TICKET_CREATE &&
      automationPlatforms.includes(
        String(selectedPlatformOption?.key || "")
          .toLowerCase()
          .trim()
          .replace(/[\s_-]+/g, ""),
      ),
    [automationPlatforms, selectedPlatformOption],
  );

  // If the platform list arrives and the current key isn't in it, snap to the
  // first option (which happens when a company doesn't have AJIO configured).
  useEffect(() => {
    if (
      platformOptions.length > 0 &&
      !platformOptions.some((p) => p.key === platformKey)
    ) {
      setPlatformKey(platformOptions[0]?.key ?? "ajio");
    }
  }, [platformOptions, platformKey]);

  const platformDbRecord = useMemo(
    () =>
      platforms.find(
        (p) => p?.name?.toLowerCase() === platformLabel.toLowerCase(),
      ),
    [platforms, platformLabel],
  );

  // Every enabled claim, or all of them when none is — see `selectableClaimTypes`.
  const claimTypeOptions = useMemo(
    () => selectableClaimTypes(platformDbRecord),
    [platformDbRecord],
  );

  // Distinct, order-preserved list of non-empty `parentSelection` values for
  // the current platform. If empty, the Issue Area dropdown is hidden and
  // Type Of Claim shows every option (existing behavior).
  const parentSelectionOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const c of claimTypeOptions) {
      const p = c.parentSelection?.trim();
      if (p && !seen.has(p)) {
        seen.add(p);
        list.push(p);
      }
    }
    return list;
  }, [claimTypeOptions]);

  const hasParentSelection = parentSelectionOptions.length > 0;

  /**
   * How THIS platform words the two cascade dropdowns.
   *
   * Four marketplaces ask the same two questions in their own vocabulary —
   * Amazon calls the parent "Type Of Claim" and the child "Claim Sub-Reason",
   * Tata CliQ asks for a reason of QC failure, Xbees for a dispute reason — and
   * the storage is identical for all of them: parent into
   * `otherClaimDetails.parentSelection`, child into `typeOfClaim`. Only the
   * words differ, so only the words are per-platform, and they live in the
   * registry with everything else that is.
   */
  const cascade = platform.cascade;
  const parentLabel = cascade.parentLabel;
  const parentPlaceholder = cascade.parentPlaceholder;
  const childLabel = cascade.childLabel;
  const childPlaceholder = cascade.childPlaceholder;
  const isTataCliqCascade = platform.key === "tataCliq" && hasParentSelection;

  const filteredClaimTypeOptions = useMemo(
    () =>
      hasParentSelection && parentSelection
        ? claimTypeOptions.filter((c) => c.parentSelection === parentSelection)
        : hasParentSelection
          ? []
          : claimTypeOptions,
    [claimTypeOptions, hasParentSelection, parentSelection],
  );

  /**
   * Is the "Sub Reason Of Failure" select worth showing?
   *
   * ON TATA CLIQ THAT FIELD IS THE PORTAL'S SECOND QUESTION, and the portal
   * asks it for exactly one reason: Wrong Product, where it offers four
   * answers. For the other eleven its own page clears that select — so a form
   * that demands one is asking an operator to answer a question the
   * marketplace never asked, and the only honest answer is the reason itself
   * repeated back.
   *
   * So it is hidden when the reason takes no sub-reason AND the catalogue has
   * a single claim type under it — there is then nothing to choose, and the
   * claim type is set from that one entry below. Where a reason genuinely
   * offers several (Damaged Product, Missing Accessories, Partial Product) the
   * select stays: those are real distinctions TrackVid records, even though
   * the portal does not ask for them.
   */
  /**
   * The claim type, when the operator was not asked for one.
   *
   * A hidden select still has to produce a value: `typeOfClaim` is what the
   * email template, the reports and the server's own validation are built on,
   * and a claim without one cannot be saved. There is exactly one entry under
   * these reasons — that is why the field is hidden — so this is a
   * transcription, not a choice being made on the operator's behalf.
   */
  const hideClaimTypeSelect =
    isTataCliqCascade &&
    Boolean(parentSelection) &&
    !needsSubReason(qcSelectionFromClaimType(parentSelection, "").reason) &&
    filteredClaimTypeOptions.length === 1;


  const {
    formik,
    isSubmitting,
    submitWithAutoClaim,
    editingCmsId,
    existingClaim,
    applyExistingClaim,
  } = useCreateCmsForm({
    platformLabel,
    skus,
    feedId,
    sideImages,
    resetSideImages: () => setSideImages([]),
    // /cms/update: force update-path dispatch (so Save fires updateCMS
    // instead of createCMS regardless of the global feature flag) and keep
    // the form populated after a successful update so the operator can
    // continue editing without re-navigating.
    updateFlowEnabled,
    keepFormAfterUpdate: isUpdateMode,
    onSuccess: () => {
      // On /cms/update, don't wipe the platform-specific UI state after a
      // successful update — the operator likely wants to keep looking at
      // the row they just edited. The form itself is already preserved by
      // `keepFormAfterUpdate` above; these setters only affect ancillary
      // UI (partial-article toggle, cascade selection, SKU picker) which
      // should also stay put in update mode.
      if (!isUpdateMode) {
        setIsPartialArticleClaim(false);
        setParentSelection("");
        setSkus([]);
        setSkuPickerOpen(false);
        setResetSignal((n) => n + 1);
      }
    },
  });

  /**
   * Keeps `typeOfClaim` to something THIS platform actually has.
   *
   * Two jobs, and the second is the bug it was written for.
   *
   * A claim loaded by AWB carries the spelling it was created with, and the
   * select matches that loosely so the operator sees their selection rather
   * than an empty box. What was submitted, though, was the stored spelling —
   * so a row carrying "wrong_product" went to a server that compares against
   * the catalogue and answered "The type of claim could not be found". The
   * catalogue's own spelling is written back instead.
   *
   * And when the stored value is not this platform's claim AT ALL — a row
   * created on another marketplace, an import carrying someone else's
   * vocabulary — it is cleared, so the required-field rule makes the operator
   * choose one that exists. Filing a Tata CliQ claim under a Flipkart claim
   * type is not something to let through with a friendlier error message.
   */
  useEffect(() => {
    const stored = formik.values.typeOfClaim || "";

    // Nothing to check against yet: still loading, or the parent has not been
    // chosen and the list is deliberately empty.
    if (!stored || platformsLoading || filteredClaimTypeOptions.length === 0) return;

    const matched = matchClaimTypeOption(filteredClaimTypeOptions, stored);

    if (!matched) {
      formik.setFieldValue("typeOfClaim", "");
      formik.setFieldValue("typeOfClaimName", "");

      return;
    }

    const canonical = matched.key || matched.name || "";

    if (canonical && canonical !== stored) {
      formik.setFieldValue("typeOfClaim", canonical);
      formik.setFieldValue("typeOfClaimName", matched.name || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formik.values.typeOfClaim, filteredClaimTypeOptions, platformsLoading]);

  useEffect(() => {
    if (!hideClaimTypeSelect) return;

    const only = filteredClaimTypeOptions[0];
    const value = only?.key || only?.name || "";

    if (!value || formik.values.typeOfClaim === value) return;

    formik.setFieldValue("typeOfClaim", value);
    formik.setFieldValue("typeOfClaimName", only?.name || "");
    formik.setFieldValue("remark", only?.description || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideClaimTypeSelect, filteredClaimTypeOptions, formik.values.typeOfClaim]);

  // Existing-claim lookup — watches the Return AWB + active platform and
  // fires /cms/find-by-awb whenever either changes. On a hit the form is
  // prefilled and Save flips to update mode; on a miss (or empty AWB) we
  // clear any prior editing state so the next Save creates a new row. The
  // debounce keeps us off the wire while the operator is still typing.
  const existingClaimSeqRef = useRef(0);
  const existingClaimUnmountedRef = useRef(false);
  useEffect(() => {
    existingClaimUnmountedRef.current = false;
    return () => {
      existingClaimUnmountedRef.current = true;
    };
  }, []);
  const debouncedFindClaim = useMemo(
    () =>
      debounceAsync(async (awb: string, platform: string) => {
        const trimmedAwb = awb.trim();
        const trimmedPlatform = platform.trim();
        if (!trimmedAwb || !trimmedPlatform) {
          applyExistingClaim(null);
          return;
        }
        const seq = ++existingClaimSeqRef.current;
        try {
          const res: any = await findCmsByAwb(trimmedAwb, trimmedPlatform);
          if (
            seq !== existingClaimSeqRef.current ||
            existingClaimUnmountedRef.current
          ) {
            return;
          }
          applyExistingClaim(res?.data?.data || null);
        } catch (err) {
          if (
            seq !== existingClaimSeqRef.current ||
            existingClaimUnmountedRef.current
          ) {
            return;
          }
          // Missing claim is a normal case — log unexpected failures only.
          console.warn("[find-by-awb] lookup failed", err);
          applyExistingClaim(null);
        }
      }, 800),
    [applyExistingClaim],
  );
  useEffect(() => {
    // Feature-flagged. When UPDATE_EXISTED_CLAIM_FROM_CMS is false the
    // whole existing-claim → prefill → update-mode flow is disabled and
    // every Save creates a fresh CMS row, regardless of whether an AWB
    // already has a claim. /cms/update forces it on for the full-edit flow.
    if (!updateFlowEnabled) {
      applyExistingClaim(null);
      return;
    }
    debouncedFindClaim(formik.values.AWBNumber || "", platformLabel);
  }, [formik.values.AWBNumber, platformLabel, debouncedFindClaim, applyExistingClaim, updateFlowEnabled]);
  useEffect(
    () => () => {
      debouncedFindClaim.cancel();
    },
    [debouncedFindClaim],
  );

  // Pool of image URLs carried over from the previously-loaded existing
  // claim when the operator switches platforms on /cms/update. Handed down
  // to each form via `platformSpecificProps.carryOverImages`, consumed by
  // `useVmsScreenshots` which merges them into `fetchedScreenshots` and
  // auto-opens the Rearrange modal. Empty on initial mount; populated only
  // when a real platform change happens with an existingClaim to source URLs.
  const [carryOverImages, setCarryOverImages] = useState<string[]>([]);
  const prevPlatformKeyRef = useRef<string>(platformKey);
  // Latest existingClaim held in a ref so the platform-change effect can
  // read the OLD one (before find-by-awb replaces it for the new platform).
  const latestExistingClaimRef = useRef(existingClaim);
  useEffect(() => {
    latestExistingClaimRef.current = existingClaim;
  }, [existingClaim]);

  // Extract every renderable image URL out of an existingClaim payload.
  // Order isn't meaningful — the Rearrange modal will pool them and let the
  // operator place them into the new platform's slots.
  const extractExistingClaimImages = (
    claim: typeof existingClaim,
  ): string[] => {
    if (!claim) return [];
    const urls: string[] = [];
    // Defense-in-depth against a scheme-injected URL sneaking into an
    // `<img src>`. Everything in the pool today comes from the BE
    // S3Service.getObjectURL() — which builds https://s3.<region>.amazonaws.com
    // strings — so this is belt-and-suspenders. If a future backend change ever
    // stored an operator-supplied URL verbatim, `javascript:` / `data:` / bare
    // paths would still be filtered out here before hitting a preview element.
    const isSafeImageUrl = (v: string): boolean => {
      const trimmed = v.trim();
      if (!trimmed) return false;
      const lower = trimmed.toLowerCase();
      return lower.startsWith("https://") || lower.startsWith("http://");
    };
    const push = (v: any) => {
      if (typeof v === "string" && isSafeImageUrl(v)) urls.push(v);
    };
    push(claim.returnProductImage);
    push(claim.forwardSentProductImage);
    push(claim.podProof);
    // Meesho + Snapdeal top-level image slots. BE returns each as
    // `{ fileKey, url }` (withUrl shape) — pull the `.url` so a
    // Meesho→other or Snapdeal→other platform switch on /cms/update carries
    // the loaded shots into the new platform's Rearrange pool.
    const perPlatformSlots = [
      claim.barcodeImage,
      claim.receivedProductImage_1,
      claim.reverseWayBillImage,
      claim.outerPackageImage_1,
      claim.outerPackageImage_2,
      claim.innerPackageImage_1,
      claim.innerPackageImage_2,
      claim.productImage_1,
      claim.productImage_2,
      claim.podImage_1,
      claim.podImage_2,
    ];
    perPlatformSlots.forEach((slot: any) => push(slot?.url));
    const m = claim.myntraClaimDetails as any;
    if (m) {
      push(m.shippingLabelImage?.url);
      (m.packingImages || []).forEach((p: any) => push(p?.url));
    }
    const o = claim.otherClaimDetails as any;
    if (o) {
      push(o.shippingLabelImage?.url);
      (o.packingImages || []).forEach((p: any) => push(p?.url));
      (o.contentsOfReturnImages || []).forEach((p: any) => push(p?.url));
      push(o.serialNumberImage?.url);
    }
    // Dedup while preserving first-seen order.
    return Array.from(new Set(urls));
  };

  useEffect(() => {
    const prev = prevPlatformKeyRef.current;
    if (prev === platformKey) return;
    prevPlatformKeyRef.current = platformKey;
    if (!isUpdateMode) {
      // Create-mode operators haven't uploaded server-side yet, so carry-
      // over would need a fileKey-to-URL round trip we don't do here.
      setCarryOverImages([]);
      return;
    }
    const urls = extractExistingClaimImages(latestExistingClaimRef.current);
    // Fresh array reference so useVmsScreenshots' effect re-fires even when
    // the URL list matches a previous switch's pool.
    setCarryOverImages(urls.length > 0 ? [...urls] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformKey, isUpdateMode]);

  // Platform-switch reset. In create mode the whole form is cleared (see the
  // effect body). In update mode, common cross-platform fields (AWB, forward AWB,
  // customer order, remark, both videos + their pasted links, the top-level
  // Return / Forward-Sent / POD images, and the additional-field pair) are
  // preserved so the operator can flip platforms without retyping them —
  // /cms/update in particular relies on this so the URL-driven AWB survives
  // a platform change. Everything else (SKU, per-platform bundles like
  // myntra/nykaa/otherClaimDetails, Meesho/Snapdeal image slots) is wiped
  // because those fields don't map 1:1 across platforms.
  //
  // On first mount the current values match `initialValues` (all blanks), so
  // the preserve-branch is a no-op — the behavior only differs after the
  // operator has typed something and then switches the platform selector.
  // Keyed on the platform the reset has ALREADY been run for, not on the effect
  // deps alone.
  //
  // `platformDbRecord?._id` resolves asynchronously — the platform list loads
  // after the form mounts — so this effect fired a SECOND time for the same
  // platform, moments later. By then the child form had mounted and its account
  // dropdown had auto-selected the company's only credential into formik, and
  // the second reset wiped it: `myntraClaimDetails.username` went back to empty
  // while the dropdown carried on displaying the account. Every hand-created
  // Myntra claim then saved with no account, and only AWBs that happened to be
  // in Myntra's master data were rescued by the backend's fallback.
  //
  // React runs child effects before parent effects, so the child can never win
  // this race by ordering alone — the parent has to stop resetting twice.
  const resetForPlatformRef = useRef<string | null>(null);

  useEffect(() => {
    if (resetForPlatformRef.current === platformKey) return;

    const isSwitch = resetForPlatformRef.current !== null;
    resetForPlatformRef.current = platformKey;

    /*
     * CREATE MODE STARTS OVER. A new claim switched to another platform is a
     * different claim: an AWB, video or image carried across belongs to the
     * order the operator was looking at a moment ago, and filing it under the
     * new platform is how the wrong evidence ends up on a ticket. Same as
     * pressing Reset, minus the platform itself.
     *
     * UPDATE MODE STILL CARRIES the common fields — the URL-driven AWB there
     * is the claim being edited, and must survive a platform correction.
     */
    if (!isUpdateMode) {
      formik.resetForm({
        values: {
          ...formik.initialValues,
          eCommercePlatform: platformDbRecord?._id || "",
        },
      });
      setIsPartialArticleClaim(false);
      setParentSelection("");
      setSkus([]);
      setSkuPickerOpen(false);
      if (isSwitch) {
        setSideImages([]);
        // Remounts the platform form, dropping its own local state (pending
        // lookups, previews) exactly as the Reset button does.
        setResetSignal((n) => n + 1);
      }
      return;
    }

    const preserved = formik.values;
    formik.resetForm({
      values: {
        ...formik.initialValues,
        eCommercePlatform: platformDbRecord?._id || "",
        AWBNumber: preserved.AWBNumber || "",
        forwardAWB: preserved.forwardAWB || "",
        customerOrderNumber: preserved.customerOrderNumber || "",
        remark: preserved.remark || "",
        returnVideo: preserved.returnVideo || "",
        returnVideoLink: preserved.returnVideoLink || "",
        forwardVideo: preserved.forwardVideo || "",
        forwardVideoLink: preserved.forwardVideoLink || "",
        returnProductImage: preserved.returnProductImage || "",
        forwardSentProductImage: preserved.forwardSentProductImage || "",
        podProof: preserved.podProof || "",
        additionalFieldTitle: preserved.additionalFieldTitle || "",
        additionalFieldValue: preserved.additionalFieldValue || "",
      },
    });
    // sideImages is the parallel File[] state for Ajio's 9-side grid. Kept
    // on switch so Ajio → other → Ajio round-trips don't lose captures; the
    // other platforms simply don't render it.
    setIsPartialArticleClaim(false);
    setParentSelection("");
    setSkus([]);
    setSkuPickerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformKey, platformDbRecord?._id, isUpdateMode]);

  // The platform id arrives after the list loads, and the reset above now runs
  // only once per platform — so stamp the id on its own when it turns up.
  // Setting one field instead of resetting the form is the whole point: the
  // operator's work (and the account the dropdown just picked) survives.
  useEffect(() => {
    if (!platformDbRecord?._id) return;
    if (formik.values.eCommercePlatform === platformDbRecord._id) return;

    formik.setFieldValue("eCommercePlatform", platformDbRecord._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformDbRecord?._id, formik.values.eCommercePlatform]);

  // /cms/update: seed the AWB from the URL exactly once, after the platform
  // reset above has run (otherwise the reset wipes what we just set). The
  // AWB → find-by-awb effect then fires and applyExistingClaim backfills the
  // rest of the form.
  const urlAwbPrefilledRef = useRef(false);
  useEffect(() => {
    if (urlAwbPrefilledRef.current) return;
    if (!isUpdateMode || !urlAwb) return;
    if (!platformDbRecord?._id) return;
    urlAwbPrefilledRef.current = true;
    formik.setFieldValue("AWBNumber", urlAwb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUpdateMode, urlAwb, platformDbRecord?._id]);

  // Sync cascade UI state from a loaded existing claim. Flipkart /
  // Tata CLiQ / Amazon render their parent dropdown ("Issue Area" /
  // "Reason Of QC Failure" / "Type Of Claim") from the local
  // `parentSelection` state that lives outside formik, so a prefill
  // through applyExistingClaim alone would leave the parent dropdown
  // empty and the sub-reason locked. Pull the stored parentSelection
  // out of the loaded bundle and stamp it into the UI state.
  useEffect(() => {
    if (!existingClaim) return;
    const parent = (existingClaim.otherClaimDetails as any)?.parentSelection;
    if (typeof parent === "string" && parent.trim() && parent !== parentSelection) {
      setParentSelection(parent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingClaim]);


  /**
   * Stamp every fixed header value onto the form.
   *
   * Delhivery's shipment issue is the only one today: the field renders
   * disabled because the value is the same on every claim it takes, and it
   * still has to be IN the payload — downstream automation reads it rather than
   * inferring it from the platform name. Runs on a platform change and after a
   * Reset, both of which clear it.
   */
  useEffect(() => {
    for (const field of platform.headerFields) {
      if (field.fixedValue !== undefined) formik.setFieldValue(field.path, field.fixedValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, resetSignal]);

  const ActiveForm = platform.Form;

  const platformSpecificProps = {
    formik: formik as any,
    feedId,
    sideImages,
    setSideImages,
    isPartialArticleClaim,
    claimTypeOptions,
    skus,
    setSkus,
    skuPickerOpen,
    setSkuPickerOpen,
    // AjioForm is the common layout — Nykaa and Shopify wrap it and every
    // unmatched (custom / D2C) platform falls back to it, and resolvePlatformKey
    // also answers "ajio" for anything it doesn't recognise. So the form cannot
    // infer "am I actually AJIO?" from its own key; POB ID is AJIO-only and
    // needs the real label to decide whether to render.
    isAjio: platform.key === "ajio" && platformLower === "ajio",
    // /cms/update needs to render images/videos already persisted on the
    // CMS row (VMS auto-fetch is disabled — see useVmsScreenshots). Passing
    // the loaded record down lets each form's preview state hydrate from it.
    existingClaim,
    // URLs collected from the pre-switch existingClaim on /cms/update. Each
    // form forwards this to useVmsScreenshots which merges them into its
    // Rearrange pool and pops the modal open so the operator can drag the
    // old shots into the new platform's slot layout.
    carryOverImages,
  };

  return (
    <ClaimFormModeProvider
      value={{ isUpdateMode, awb: urlAwb, platform: urlPlatform, onBack, lookupSource }}
    >
      <MediaCaptureProvider feedId={feedId}>
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "1rem",
            marginBottom: 5,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            {isUpdateMode && (
              <IconButton
                size="small"
                onClick={onBack}
                aria-label="Back to the claim queue"
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: "8px",
                  padding: "4px",
                  "&:hover": { backgroundColor: tint('primary.main', 0.08) },
                }}
              >
                <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            )}
            <Typography variant="h5" fontWeight={700}>
              {isUpdateMode ? "Update SPF Claim" : "Create SPF Claim"}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap" }}>
            {/*
              WHERE THE RETURN ORDER LOOKUP READS FROM.

              Two sources answer the same question and neither is right for
              every claim:

                API     asks AJIO now. Always current, and the only one that
                        can chase a missing forward AWB or find an order under
                        a different account — but it needs a signed-in browser
                        and walks a month of pages per window.
                Report  reads what the nightly AJIO report sync downloaded.
                        Instant, no login, no network — and blind to anything
                        created since the last sync.

              AJIO ONLY, because it is the only platform with both a live
              report API and a local backup of it. Shown beside the claim's
              other per-claim choices rather than buried in Settings: it is a
              decision per lookup, not a preference.
            */}
            {platformKey === "ajio" && (
              <ReturnLookupSource
                value={lookupSource}
                onChange={next => {
                  setLookupSource(next);
                  // Into the terminal, where the main process writes: the
                  // choice decides whether a lookup touches AJIO at all, and
                  // the log could not show which had been picked.
                  noteLookupSource(next);
                }}
              />
            )}
            <FeedPicker feedId={feedId} onChange={setFeedId} compact />
            {/*
              TONAL, NOT OUTLINED — and the same everywhere on this screen.

              TrackVid-FE's secondary buttons are outlined in the default
              colour. This app's primary is near-black, so an outlined button
              in dark mode drew near-black text on a dark surface: measurably
              unreadable, and invisible in a screenshot. Tonal secondary is
              what the app's own `components/ui/Button` calls "secondary", and
              it is the pairing Monitor's theme defines for both schemes.
            */}
            {!isUpdateMode && (
              <ButtonElement
                type="button"
                variant="tonal"
                color="secondary"
                sx={{ minWidth: 110, height: 34, fontSize: 13, fontWeight: 600 }}
                onClick={() => setBulkChooserOpen(true)}
              >
                Bulk Claim
              </ButtonElement>
            )}
            {!isUpdateMode && !normalBulkOpen && (
              <BulkRunIndicator onOpen={() => setNormalBulkOpen(true)} />
            )}
            <ButtonElement
              type="button"
              variant="tonal"
              color="secondary"
              sx={{ minWidth: 110, height: 34, fontSize: 13, fontWeight: 600 }}
              onClick={() => {
                formik.resetForm();
                setSideImages([]);
                setIsPartialArticleClaim(false);
                setParentSelection("");
                setResetSignal((n) => n + 1);
              }}
            >
              Reset
            </ButtonElement>
            <ButtonElement
              type="button"
              /*
               * Save steps back when there is a Create Ticket beside it: two
               * filled buttons side by side give an operator no steer on which
               * one is the ordinary action.
               */
              variant={canAutoClaim && !editingCmsId ? "tonal" : "contained"}
              color={canAutoClaim && !editingCmsId ? "secondary" : "primary"}
              sx={{ minWidth: 110, height: 34, fontSize: 13, fontWeight: 600 }}
              disabled={isSubmitting}
              onClick={() => formik.handleSubmit()}
            >
              {isSubmitting ? (
                <CircularProgress size={18} color="inherit" />
              ) : updateFlowEnabled && editingCmsId ? (
                "Update Claim"
              ) : (
                "Save"
              )}
            </ButtonElement>

            {/*
              Save + dispatch, in one click. Gated on CLAIM_SAVE_AND_TICKET_CREATE
              (see canAutoClaim) so the whole feature can be switched off from
              helper/constant.ts, and rendered only when the BE says this
              platform has an automation runner.

              Never in edit mode — an edit targets a row that may already be
              Queued/Running/ticketed, and re-dispatching it would duplicate the
              claim on the marketplace rather than retry it. Re-running an
              existing row stays the job of the Auto Claim button on /cms, which
              has the in-flight and retry-cap gates.
            */}
            {canAutoClaim && !editingCmsId && (
              <ButtonElement
                type="button"
                variant="contained"
                sx={{ minWidth: 130, height: 34, fontSize: 13, fontWeight: 600 }}
                disabled={isSubmitting}
                onClick={() => submitWithAutoClaim()}
              >
                {isSubmitting ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  "Create Ticket"
                )}
              </ButtonElement>
            )}
          </Stack>
        </Box>

        {/* The form in one glass card (Veylix `.glass-card` + `.c-form`): the
            heading and its actions stay above it, as on the template's pages. */}
        <Box className="veylix-glass veylix-form" sx={{ padding: "20px" }}>
        <Grid container spacing={3}>
          {/* LEFT (~60%) — Platform + Type Of Claim + platform left content */}
          <Grid size={{ xs: 12, md: 7 }}>
            <Box
              sx={{
                display: "flex",
                gap: "1.5rem",
                flexWrap: "wrap",
                marginBottom: 2,
              }}
            >
              <Box sx={{ flex: "1 1 260px" }}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  <Typography>
                    E-commerce Platform <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
                  </Typography>
                  <Autocomplete
                    size="small"
                    loading={platformsLoading}
                    options={platformOptions}
                    /*
                     * `null` is the controlled "nothing selected" value, and
                     * MUI's types do not admit it alongside `disableClearable`
                     * — that pairing assumes a value exists from the first
                     * render, and here the company's platforms arrive a moment
                     * later. `undefined` would make the field uncontrolled for
                     * good; see `selectedPlatformOption`.
                     */
                    value={selectedPlatformOption as PlatformOption}
                    getOptionLabel={(option) => option.label}
                    isOptionEqualToValue={(a, b) => a.key === b.key}
                    onChange={(_, value) => {
                      if (value) setPlatformKey(value.key);
                    }}
                    disableClearable
                    renderOption={(props, option) => (
                      <Box component="li" {...props} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <PlatformIcon
                          name={option.label}
                          size={16}
                          fallbackColor={option.dot}
                        />
                        <span>{option.label}</span>
                      </Box>
                    )}
                    renderInput={(params) => (
                      <TextField {...params} placeholder="Select Platform" name="platform" />
                    )}
                  />
                </Box>
              </Box>
              {platform.headerFields
                .filter((field) => field.position !== "after-cascade")
                .map((field) => (
                  <HeaderFieldControl key={field.path} field={field} formik={formik} accountPath={platform.accountPath} />
                ))}
              {hasParentSelection && (
                <Box sx={{ flex: "1 1 260px" }}>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <Typography>
                      {parentLabel} <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
                    </Typography>
                    <Autocomplete
                      size="small"
                      options={parentSelectionOptions}
                      value={parentSelection || null}
                      onChange={(_, value) => {
                        setParentSelection(value || "");
                        // Nest under the shared otherClaimDetails envelope
                        // that carries Flipkart / Tata CliQ / Delhivery /
                        // Amazon parentSelection to the BE as a JSON field.
                        formik.setFieldValue(
                          "otherClaimDetails.parentSelection",
                          value || "",
                        );
                        // Clear Type Of Claim when the parent area changes so
                        // stale selections from another group can't survive.
                        formik.setFieldValue("typeOfClaim", "");
                        formik.setFieldValue("typeOfClaimName", "");
                        formik.setFieldValue("remark", "");
                        setIsPartialArticleClaim(false);
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          name="parentSelection"
                          placeholder={parentPlaceholder}
                        />
                      )}
                    />
                  </Box>
                </Box>
              )}
              {platform.headerFields
                .filter((field) => field.position === "after-cascade")
                .map((field) => (
                  <HeaderFieldControl key={field.path} field={field} formik={formik} accountPath={platform.accountPath} />
                ))}
              {!hideClaimTypeSelect && (
                <Box sx={{ flex: "1 1 260px" }}>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <Typography>
                      {childLabel} <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
                    </Typography>
                    <Autocomplete
                      size="small"
                      loading={platformsLoading}
                      options={filteredClaimTypeOptions}
                      disabled={hasParentSelection && !parentSelection}
                      getOptionLabel={(option) => option.name}
                      onChange={(_, value) => {
                        if (value) {
                          formik.setFieldValue("typeOfClaim", value?.key || value?.name);
                          formik.setFieldValue("typeOfClaimName", value?.name || "");
                          formik.setFieldValue("remark", value?.description || "");
                          setIsPartialArticleClaim(value?.key === "partial_articles_received");
                        } else {
                          formik.setFieldValue("typeOfClaim", "");
                          formik.setFieldValue("typeOfClaimName", "");
                          formik.setFieldValue("remark", "");
                          setIsPartialArticleClaim(false);
                        }
                      }}
                      value={matchClaimTypeOption(
                        filteredClaimTypeOptions,
                        formik.values.typeOfClaim || "",
                      )}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          name="typeOfClaim"
                          error={!!(formik.touched.typeOfClaim && formik.errors.typeOfClaim)}
                          onBlur={formik.handleBlur}
                          helperText={formik.touched.typeOfClaim && (formik.errors.typeOfClaim as string)}
                          placeholder={
                            // "Select Issue Area first" — in whichever words this
                            // platform used for the question above.
                            hasParentSelection && !parentSelection
                              ? `${parentPlaceholder} first`
                              : childPlaceholder
                          }
                        />
                      )}
                    />
                  </Box>
                </Box>
              )}
            </Box>

            <ActiveForm
              key={`left-${resetSignal}`}
              {...platformSpecificProps}
              side="left"
            />
          </Grid>

          {/* RIGHT (~40%) — platform right content, visually separated */}
          <Grid size={{ xs: 12, md: 5 }}>
            <Box
              sx={(t) => ({
                pl: { xs: 0, md: 3 },
                pt: { xs: 2, md: 0 },
                borderLeft: { xs: "none", md: `1px solid ${t.palette.divider}` },
                borderTop: { xs: `1px solid ${t.palette.divider}`, md: "none" },
              })}
            >
              <ActiveForm
                key={`right-${resetSignal}`}
                {...platformSpecificProps}
                side="right"
              />
            </Box>
          </Grid>
        </Grid>
        </Box>
      </MediaCaptureProvider>
      <BulkClaimChooser
        open={bulkChooserOpen}
        onClose={() => setBulkChooserOpen(false)}
        increffAvailable={increffBulkAvailable}
        onChoose={(kind) => {
          setBulkChooserOpen(false);
          if (kind === "increff") setBulkClaimOpen(true);
          else setNormalBulkOpen(true);
        }}
      />
      <BulkClaimModal
        open={bulkClaimOpen}
        onClose={() => setBulkClaimOpen(false)}
      />
      <NormalBulkClaimModal
        open={normalBulkOpen}
        onClose={() => setNormalBulkOpen(false)}
        feedId={feedId}
      />
    </ClaimFormModeProvider>
  );
};

export { resolvePlatformKey };
/** Named for what the screen is, since the file no longer sits behind a URL. */
export const CreateClaimPage = CreateCms;
export default CreateCms;
