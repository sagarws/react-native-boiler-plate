import { useClaimForm } from "./useClaimForm";
import { accountsFor, useClaimCatalogue } from "./ClaimCatalogue";
import { platformDescriptor } from "./platforms/registry";
import { getIn, setIn } from "./useClaimForm";
import { toast } from "./toast";
import { useCallback, useMemo, useRef, useState } from "react";
import { trimOrUndef, type ClaimValues } from "./platforms/common/payload";
import { bareAwb, buildCreateFields } from "./platforms/common/createFields";
import { blankClaim } from "./blankClaim";
import {
	type ICms,
	MYNTRA_INITIAL_CLAIM_DETAILS,
	NYKAA_INITIAL_CLAIM_DETAILS,
	OTHER_INITIAL_CLAIM_DETAILS,
} from "@shared/types/cmsCreate";
import { createCMS, uploadCmsImage } from "./api";
import { CmsService } from "./api";
import { createPdfFromImages_old } from "./imageToPdf";
import { placeholderSixSidePdf } from "./platforms/common/placeholderSixSidePdf";
import type { ExistingCmsPreview } from "./types";
import { UPDATE_EXISTED_CLAIM_FROM_CMS } from "./constants";

/** The one-line reason behind a failed upload, for the toast. */
const errorText = (err: unknown): string =>
	err instanceof Error && err.message ? err.message : "unknown error";

export interface CreateCmsFormOptions {
	platformLabel: string;
	skus: string[];
	feedId: string;
	sideImages: File[];
	resetSideImages: () => void;
	onSuccess?: () => void;
	/**
	 * When true, a submit that finds a matching editingCmsId hits /cms/updateCMS
	 * instead of creating a new row — regardless of the UPDATE_EXISTED_CLAIM_FROM_CMS
	 * feature flag. Set by the parent to `true` on /cms/update so the full-edit
	 * URL is always update-first even while the flag stays off for the
	 * duplicate-AWB flow on the create page.
	 */
	updateFlowEnabled?: boolean;
	/**
	 * When true, a successful update-mode submit KEEPS the form populated
	 * (banner switches to a "Claim updated" toast but the operator can keep
	 * editing / re-save). When false (the default), the form resets like the
	 * create flow. `true` is what /cms/update wants.
	 */
	keepFormAfterUpdate?: boolean;
}

/**
 * Formik-backed CMS create hook. Mirrors the App CMSPage submit contract:
 * multipart POST /cms/createCMS with flat fields, plus JSON-stringified
 * myntraClaimDetails/nykaaClaimDetails when applicable, and a six-side PDF
 * built from the captured File[] when the platform requires it.
 */
export const useCreateCmsForm = ({
	platformLabel,
	skus,
	feedId,
	sideImages,
	resetSideImages,
	onSuccess,
	updateFlowEnabled = false,
	keepFormAfterUpdate = false,
}: CreateCmsFormOptions) => {
	const catalogue = useClaimCatalogue();
	const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
	// Which of the two toolbar buttons started this submit.
	//
	// A ref, not state: Formik's onSubmit closes over render-time values, so a
	// useState flag set immediately before handleSubmit() would still read as
	// its previous value inside the very submit it was meant to configure. The
	// ref is read at submit time and cleared in `finally`, so an interrupted
	// submit can never leave the next plain Save silently dispatching a ticket.
	const autoClaimRef = useRef<boolean>(false);
	// When set, Save fires updateCMS against this CMS id instead of createCMS.
	// Cleared on Reset, on successful update, and when the AWB is cleared or
	// no longer matches an existing claim.
	const [editingCmsId, setEditingCmsId] = useState<string | null>(null);
	// Kept alongside the id so the parent can render a banner ("Editing claim
	// for AWB xxx · status yyy · [Cancel edit]") without a second lookup.
	const [existingClaim, setExistingClaim] = useState<ExistingCmsPreview | null>(null);

	/**
	 * Everything this submit needs to know about the platform, in one lookup.
	 *
	 * TrackVid-FE keeps ten `isMyntra` / `isSnapdeal` booleans here and branches
	 * on them a dozen times. This repo does not allow that — adding a
	 * marketplace must be one folder and one registry entry, never an edit to a
	 * shared file — so the same facts come from `platforms/registry.ts` and the
	 * per-platform parts live in the platform's own folder.
	 */
	const platform = useMemo(() => platformDescriptor(platformLabel), [platformLabel]);
	const requiresSixSidePdf = platform.requiresSixSidePdf;
	const sixSidePlaceholderPdf = platform.sixSidePlaceholderPdf;

	const validate = useMemo(() => platform.validate(skus), [platform, skus]);

	const initialValues: ICms = blankClaim();

	const formik = useClaimForm<ICms>({
		initialValues,
		validate: (current) => validate(current as ClaimValues),
		onSubmit: async (submitted) => {
			let values = submitted as ClaimValues;
			/**
			 * THE SOLE ACCOUNT, GUARANTEED — for every platform that has one.
			 *
			 * The dropdown already selects it when a company has exactly one login,
			 * and that is what an operator sees. But the selection lives in form
			 * state, where several effects can reach it: a claim loaded by AWB, a
			 * platform list arriving late, a reset. One of them cleared it, and a
			 * claim was created with no account under a field showing an account —
			 * which is the worst kind of wrong, because there is nothing to notice.
			 *
			 * So it is settled here, from the company's own credentials, at the
			 * moment the payload is built. One login means there is no ambiguity to
			 * resolve: every claim on that platform runs under it.
			 *
			 * Nykaa is absent on purpose — it carries no per-row account at all.
			 */
			const soleAccount = (): string => {
				const accounts = accountsFor(catalogue, platformLabel);

				return accounts.length === 1 ? (accounts[0] as string) : "";
			};

			/**
			 * Settle the account here, from the company's own credentials, at the
			 * moment the payload is built — not from whatever form state holds.
			 *
			 * The dropdown already selects it when a company has exactly one login,
			 * and that is what an operator sees. But the selection lives in form
			 * state, where several effects can reach it: a claim loaded by AWB, a
			 * platform list arriving late, a reset. One of them cleared it, and a
			 * claim was created with no account under a field showing an account —
			 * the worst kind of wrong, because there is nothing to notice.
			 *
			 * One login means there is no ambiguity to resolve: every claim on that
			 * platform runs under it. An account the operator NAMED always wins.
			 *
			 * Nykaa has no `accountPath` at all — it carries no per-row account.
			 */
			if (platform.accountPath && platform.autoSelectSoleAccount) {
				const named = trimOrUndef(getIn(values, platform.accountPath));

				if (!named) {
					const only = soleAccount();

					if (only) values = setIn(values, platform.accountPath, only);
				}
			}

			// A new claim needs a feed: createCMS refuses one without it, with a
			// bare "Missing required fields" that names nothing. Said here instead.
			// An update keeps the claim's feed, so it is not asked for one.
			const isUpdate = (UPDATE_EXISTED_CLAIM_FROM_CMS || updateFlowEnabled) && !!editingCmsId;

			if (!isUpdate && !feedId) {
				toast.error("Select a Feed (top right) before saving the claim");
				return;
			}

			// Flip the spinner on immediately so the user sees feedback the moment
			// Save is clicked. The six-side PDF build + upload below can take a few
			// seconds; without this, the button stays showing "Save" until the
			// createCMS request finally fires. Every early-return path below resets
			// it.
			setIsSubmitting(true);
			const formData = new FormData();

			if (requiresSixSidePdf) {
				if (
					formik.values.additionalFieldTitle !== "" &&
					formik.values.additionalFieldValue === ""
				) {
					formik.setFieldError("additionalFieldValue", "*required");
					setIsSubmitting(false);
					return;
				}
				if (
					formik.values.additionalFieldValue !== "" &&
					formik.values.additionalFieldTitle === ""
				) {
					formik.setFieldError("additionalFieldTitle", "*required");
					setIsSubmitting(false);
					return;
				}

				// Six-side images → single PDF (3..9 images). App path (CMSPage.tsx
				// generatePdf): (1) build the PDF locally, (2) POST it to
				// /cms/uploadImage to get an S3 key, (3) attach that key as a *text*
				// field named `sixSideImages` in the createCMS FormData. The multer
				// config on /createCMS only whitelists `sixSideImages` (not
				// `sideImages`) and doesn't want the raw PDF file.
				if (sixSidePlaceholderPdf || (sideImages.length >= 3 && sideImages.length <= 9)) {
					formik.setFieldError("sideImages", undefined);
					try {
						const pdfFile = sixSidePlaceholderPdf
							? placeholderSixSidePdf()
							: await createPdfFromImages_old(sideImages);
						const pdfUploadFd = new FormData();
						pdfUploadFd.append("file", pdfFile);
						pdfUploadFd.append("feedId", feedId || "");
						const uploadRes = await uploadCmsImage(pdfUploadFd);
						const key = uploadRes?.data?.data?.key;
						if (!key) {
							toast.error("Six-side images upload failed");
							setIsSubmitting(false);
							return;
						}
						formData.append("sixSideImages", key);
					} catch (err) {
						// The REASON, not just the step. "Could not upload six-side images
						// PDF" was true of an unreadable image, a refused upload and a
						// dead link alike — three different things to do about it, and the
						// operator could tell them apart only by opening the console.

						console.error("PDF generation/upload failed", err);
						toast.error(`Could not upload six-side images PDF — ${errorText(err)}`);
						setIsSubmitting(false);
						return;
					}
				} else {
					formik.setFieldTouched("sideImages", true, false);
					formik.setFieldError(
						"sideImages",
						sideImages.length > 9 ? "Maximum nine images allowed" : "Minimum three images required",
					);
					setIsSubmitting(false);
					return;
				}
			}

			// See `bareAwb` — the label a lookup suggestion carries is not the AWB.
			values.AWBNumber = bareAwb(values.AWBNumber);
			if (values.forwardAWB) {
				values.forwardAWB = bareAwb(values.forwardAWB);
			}

			if (feedId) {
				formData.append("feedId", feedId);
			}

			// Only the fields this platform's create branch accepts — see
			// `buildCreateFields`, which Normal Bulk Claim files through too.
			for (const [key, value] of buildCreateFields(values, platform)) {
				formData.append(key, value);
			}

			try {
				// Update-mode dispatch. When the AWB lookup matched an existing
				// claim, Save writes back to that row via /cms/updateCMS instead of
				// creating a new one. updateCMS only accepts a metadata subset —
				// fields not in the whitelist below stay at their stored values.
				// For image / video / bundle edits, the operator should use the
				// Manage SPF Claims inline editors.
				//
				// Gate: either the global UPDATE_EXISTED_CLAIM_FROM_CMS flag OR the
				// per-page `updateFlowEnabled` prop (true on /cms/update). The flag
				// stays off for the create page's duplicate-AWB flow, but the full-
				// edit URL always needs update-first regardless. Without this second
				// condition the "Update Claim" button silently fell through to
				// createCMS, minting a duplicate row.
				if ((UPDATE_EXISTED_CLAIM_FROM_CMS || updateFlowEnabled) && editingCmsId) {
					const updatePayload: Record<string, any> = { cmsId: editingCmsId };
					const trimOrUndef = (v: unknown) =>
						typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

					// Six-side images: re-upload only when the operator actually added
					// new files to the grid. `sideImages` is the fresh File[] captured
					// this session — hydration doesn't populate it, so length > 0 means
					// "the operator picked new images". If empty, the stored PDF stays
					// untouched. Same 3..9 gate as the create branch above so we can't
					// silently ship an invalid grid.
					if (requiresSixSidePdf && !sixSidePlaceholderPdf && sideImages.length > 0) {
						if (sideImages.length < 3 || sideImages.length > 9) {
							formik.setFieldTouched("sideImages", true, false);
							// When a stored PDF is on the row, the operator has two valid
							// exits from a 1-2 image state: remove the new picks (keep the
							// stored PDF as-is) OR add enough images to trigger regeneration.
							// The generic "Minimum three images required" copy doesn't hint
							// at the first option, and operators were getting stuck.
							const hasStoredPdf = Boolean(existingClaim?.sixSideImages);
							const tooFewMessage = hasStoredPdf
								? "Remove the new images to keep the existing PDF, or add at least 3 new images to replace it."
								: "Minimum three images required";
							formik.setFieldError(
								"sideImages",
								sideImages.length > 9 ? "Maximum nine images allowed" : tooFewMessage,
							);
							setIsSubmitting(false);
							return;
						}
						try {
							const pdfFile = await createPdfFromImages_old(sideImages);
							const pdfUploadFd = new FormData();
							pdfUploadFd.append("file", pdfFile);
							pdfUploadFd.append("feedId", feedId || "");
							const uploadRes = await uploadCmsImage(pdfUploadFd);
							const key = uploadRes?.data?.data?.key;
							if (!key) {
								toast.error("Six-side images upload failed");
								setIsSubmitting(false);
								return;
							}
							updatePayload.sixSideImages = key;
							// BE routes sixSideImages by looking at eCommercePlatform (same
							// as `username`), so make sure the platform hint is on the
							// payload even when no username change is being sent.
							updatePayload.eCommercePlatform = platformLabel;
						} catch (err) {
							console.error("PDF generation/upload failed", err);
							toast.error(`Could not upload six-side images PDF — ${errorText(err)}`);
							setIsSubmitting(false);
							return;
						}
					}

					/**
					 * The metadata every surface can edit, whatever the platform is.
					 *
					 * `/cms/updateCMS` accepts a SUBSET and preserves whatever is stored
					 * for anything absent — which is what lets an operator open a filed
					 * claim, fix its remark and save without re-uploading ten
					 * photographs. So everything here is sent only when it has a value,
					 * with one deliberate exception noted below.
					 */
					const awbForUpdate = trimOrUndef(values.AWBNumber);
					if (awbForUpdate) updatePayload.AWBNumber = awbForUpdate;
					const forwardAwbForUpdate = trimOrUndef(values.forwardAWB);
					if (forwardAwbForUpdate) updatePayload.forwardAWB = forwardAwbForUpdate;
					const typeOfClaimForUpdate = trimOrUndef(values.typeOfClaim);
					if (typeOfClaimForUpdate) updatePayload.typeOfClaim = typeOfClaimForUpdate;
					const subOrderForUpdate = trimOrUndef(values.subOrderNumber);
					if (subOrderForUpdate) updatePayload.subOrderNumber = subOrderForUpdate;
					// The SKU the multi-record picker settled on.
					const skuNameForUpdate = trimOrUndef(values.skuName);
					if (skuNameForUpdate) updatePayload.skuName = skuNameForUpdate;

					/**
					 * The seller account, from wherever this platform keeps it.
					 *
					 * Each platform stores it under its own key on the claim, but the
					 * endpoint takes a single `username` plus `eCommercePlatform` and
					 * routes it internally — so the registry says which key to read and
					 * the platform name has to travel with it.
					 */
					const usernameForUpdate = platform.accountPath
						? trimOrUndef(getIn(values, platform.accountPath))
						: undefined;

					if (usernameForUpdate) {
						updatePayload.username = usernameForUpdate;
						updatePayload.eCommercePlatform = platformLabel;
					}

					/**
					 * The three top-level image slots the default layout owns.
					 *
					 * Hydration writes the stored key back into the form on load, so
					 * re-sending them from an untouched form is idempotent — the operator
					 * only ever replaces one by picking a new file.
					 */
					const returnProduct = trimOrUndef(values.returnProductImage);
					if (returnProduct) updatePayload.returnProductImage = returnProduct;
					const forwardSent = trimOrUndef(values.forwardSentProductImage);
					if (forwardSent) updatePayload.forwardSentProductImage = forwardSent;
					const podProofKey = trimOrUndef(values.podProof);
					if (podProofKey) updatePayload.podProof = podProofKey;

					// SENT AS-IS, empty included: clearing a remark is a thing an
					// operator does on purpose, and "only when truthy" cannot express it.
					if (typeof values.remark === "string") updatePayload.remark = values.remark;

					const returnVideoLinkForUpdate = trimOrUndef(values.returnVideoLink);
					if (returnVideoLinkForUpdate) {
						updatePayload.returnVideoLink = returnVideoLinkForUpdate;
					}
					const forwardVideoLinkForUpdate = trimOrUndef(values.forwardVideoLink);
					if (forwardVideoLinkForUpdate) {
						updatePayload.forwardVideoLink = forwardVideoLinkForUpdate;
					}

					/**
					 * Everything that belongs to this marketplace alone.
					 *
					 * Built in the platform's own folder — `platforms/<name>/payload.ts`
					 * — so adding a marketplace is a folder and a registry entry rather
					 * than another branch in this function. Its fields go on last and may
					 * stamp `eCommercePlatform`, which several of them must.
					 */
					Object.assign(updatePayload, platform.buildUpdate({ values, platformLabel }));

					const response = await CmsService.updateCMS(updatePayload);
					const body: any = response?.data;
					if (body?.isSuccess) {
						toast.success(body?.displayMessage || "Claim updated successfully");
						if (keepFormAfterUpdate) {
							// /cms/update flow: keep the form populated so the operator
							// can continue editing or hit Update again. Don't clear the
							// editing state either — same claim is still the target row.
							onSuccess?.();
						} else {
							setEditingCmsId(null);
							setExistingClaim(null);
							formik.resetForm({
								values: {
									...initialValues,
									eCommercePlatform: values.eCommercePlatform,
								},
							});
							resetSideImages();
							onSuccess?.();
						}
					} else {
						toast.error(body?.displayMessage || "Update failed");
					}
					return;
				}

				// Set by the "Save with Create Ticket" button, and it IS what decides
				// whether the claim is filed: the BE dispatches only when `autoClaim`
				// is true, then routes it by `settings.desktopExecution`. A plain Save
				// leaves the row on Not Started.
				//
				// Sent as a form field because /createCMS is multipart; the BE accepts
				// the string "true" as well as a boolean.
				if (autoClaimRef.current) formData.append("autoClaim", "true");

				const response = await createCMS(formData);
				const { displayMessage, autoClaim } = response.data;
				if (response.status === 200) {
					// The claim is saved either way — a dispatch that did not start is a
					// warning, never an error. An error toast here would read as "the
					// claim was not created" and invite the operator to re-enter a row
					// that already exists, which is how the same claim ends up filed
					// twice on the marketplace.
					if (autoClaim?.requested && !autoClaim?.dispatched) {
						/*
						 * INFO, not error. The claim IS saved — only the dispatch did not
						 * start. An error here would read as "the claim was not created"
						 * and invite the operator to re-enter a row that already exists,
						 * which is how the same claim gets filed twice on the marketplace.
						 */
						toast.info(displayMessage || "Claim created. Auto claim not started.");
					} else {
						toast.success(displayMessage || "CMS created successfully");
					}
					// Preserve the current platform selection so the next submit still
					// has a valid eCommercePlatform id without waiting for the parent's
					// platform-change effect to re-populate it.
					formik.resetForm({
						values: {
							...initialValues,
							eCommercePlatform: values.eCommercePlatform,
						},
					});
					resetSideImages();
					onSuccess?.();
				}
			} catch (error: any) {
				// The BE rejects a claim that is missing a mandatory field with a
				// 4xx + displayMessage. Axios throws on 4xx, so surface that message
				// instead of the raw error object (which rendered as
				// "AxiosError: Request failed with status code 400").
				const beMessage = error?.response?.data?.displayMessage || error?.response?.data?.message;
				toast.error(beMessage || error?.message || "Something went wrong!");
			} finally {
				setIsSubmitting(false);
				// Always clear, including on the error paths above — otherwise a failed
				// "Save with Create Ticket" would leave the flag armed and the next
				// plain Save would dispatch a ticket the operator never asked for.
				autoClaimRef.current = false;
			}
		},
	});

	/**
	 * Submit and ask the BE to dispatch the auto claim immediately.
	 * Backs the "Save with Create Ticket" button; plain `formik.handleSubmit()`
	 * keeps today's save-only behaviour untouched.
	 */
	const submitWithAutoClaim = useCallback(() => {
		autoClaimRef.current = true;
		formik.handleSubmit();
		// No reset here — onSubmit's `finally` owns clearing the flag, and formik
		// may not have run the handler yet when this returns.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [formik.handleSubmit]);

	// Track the last-loaded claim id in a ref so we can only fire the "loaded"
	// toast on a NEW hit (not every time the debounced lookup re-resolves).
	// Kept out of state / deps so `applyExistingClaim` stays identity-stable.
	const lastLoadedIdRef = useRef<string | null>(null);
	// Formik held in a ref so `applyExistingClaim` can stay deps-free and
	// identity-stable — pulling formik in directly would rebuild the callback
	// on every render and cascade into the parent's debounced find-by-awb
	// effect. (The old `platformFlagsRef` mirror is gone — bundle-merge
	// gating now uses `claim.eCommercePlatform` inside applyExistingClaim,
	// which is race-free.)
	const formikRef = useRef(formik);
	formikRef.current = formik;

	// Called by the parent whenever the AWB + platform lookup resolves. On a
	// hit, prefill the visible form fields with the stored values so the
	// operator sees the claim state and Save flips to update mode. On a miss
	// (claim === null) we drop editing state so the next Save creates a new
	// row.
	//
	// IMPORTANT: This callback is deps-free on purpose — pulling in state
	// (editingCmsId / existingClaim) or the platform flags would rebuild its
	// identity on every render, cascading into the debounced lookup upstream
	// and firing /cms/find-by-awb in an infinite loop.
	const applyExistingClaim = useCallback((claim: ExistingCmsPreview | null) => {
		const f = formikRef.current;
		if (!claim) {
			// React short-circuits setState with the same value, so unconditional
			// calls here are safe (no wasted renders).
			setEditingCmsId(null);
			setExistingClaim(null);
			lastLoadedIdRef.current = null;
			return;
		}
		setEditingCmsId(claim._id);
		setExistingClaim(claim);

		// Only overwrite fields the current form actually renders and where
		// the stored value differs from what's already in the form. Skipping
		// no-op writes avoids feeding formik re-renders that could retrigger
		// the upstream lookup effect.
		//
		// AWBNumber is intentionally NOT overwritten — the operator just typed
		// it, and re-setting the same string still churns formik state, which
		// was the primary cause of the infinite /find-by-awb loop.
		const setIfChanged = (field: keyof ICms, value: any) => {
			if (value === undefined || value === null || value === "") return;
			if ((f.values as any)[field] === value) return;
			f.setFieldValue(field as string, value);
		};
		setIfChanged("typeOfClaim", claim.typeOfClaim);
		setIfChanged("forwardAWB", claim.forwardAWB);
		setIfChanged("customerOrderNumber", claim.customerOrderNumber);
		setIfChanged("remark", claim.remark);
		setIfChanged("returnVideoLink", claim.returnVideoLink);
		setIfChanged("forwardVideoLink", claim.forwardVideoLink);
		setIfChanged("subOrderNumber", claim.subOrderNumber);
		setIfChanged("logisticsPartnerName", claim.logisticsPartnerName);
		// Meesho top-level text fields (rendered on the /cms/update Meesho
		// form). Both `packetId` (free text) and `stateOfThePacket` (dropdown
		// value: "1" | "2") come back from findCmsByAwb and must land in
		// formik so the fields show the stored value instead of empty.
		// Same for `costOfMissingArticle` (partial-article-claim numeric).
		setIfChanged("packetId", (claim as any).packetId);
		setIfChanged("stateOfThePacket", (claim as any).stateOfThePacket);
		setIfChanged("costOfMissingArticle", (claim as any).costOfMissingArticle);
		// AJIO SKU + POB ID. Both describe the same master-data row, and both
		// are re-derivable from the /order lookup — but hydrating the STORED
		// values matters: on a multi-line order the lookup alone would offer
		// the sibling rows again, and an operator opening a claim just to fix
		// its remark should not be re-litigating which POB it was filed under.
		setIfChanged("skuName", claim.skuName);
		setIfChanged("pobId", claim.pobid);
		setIfChanged("returnOrderId", claim.returnOrderId);
		// Per-platform account identifiers surface as top-level fields on
		// findCmsByAwb (only Myntra's lives inside myntraClaimDetails.username,
		// which is hydrated as part of the bundle below). Preselects the
		// Account Username dropdown on /cms/update.
		setIfChanged("ajio_account_email", claim.ajio_account_email);
		setIfChanged("meesho_account_email", claim.meesho_account_email);
		setIfChanged("snapdeal_account_username", claim.snapdeal_account_username);

		/**
		 * WHICH BUNDLE TO MERGE IS THE CLAIM'S OWN QUESTION, not the screen's.
		 *
		 * Gated on `claim.eCommercePlatform` — the authoritative value from the
		 * database — rather than on the platform the page happens to be showing.
		 * Gating it on the screen raced on first load: opening the update page
		 * directly, the company catalogue had not arrived yet, so the platform
		 * fell back to the first entry for one render, every bundle merge was
		 * skipped, and the platform's own fields (the account, Flipkart's claim
		 * area, Xbees' disputed amount, Nykaa's vendor code) never landed in the
		 * form. The claim's own platform string is set before this is called and
		 * never depends on what is rendered.
		 */
		const claimBundle = platformDescriptor(claim.eCommercePlatform || "").bundle;

		if (claim.myntraClaimDetails && claimBundle === "myntra") {
			f.setFieldValue("myntraClaimDetails", {
				...MYNTRA_INITIAL_CLAIM_DETAILS,
				...claim.myntraClaimDetails,
			});
		}
		if (claim.nykaaClaimDetails && claimBundle === "nykaa") {
			f.setFieldValue("nykaaClaimDetails", {
				...NYKAA_INITIAL_CLAIM_DETAILS,
				...claim.nykaaClaimDetails,
			});
		}
		if (claim.otherClaimDetails && claimBundle === "other") {
			/**
			 * A LOADED CLAIM WITH NO ACCOUNT MUST NOT ERASE THE ONE ON SCREEN.
			 *
			 * This merge runs whenever the AWB matches an existing row, and the
			 * spread writes every key of the initial bundle — so a stored claim
			 * that carries no `username` (every Tata CliQ row created before the
			 * server learned to persist one) replaced the account the dropdown had
			 * just auto-selected with "". The operator saw the field filled, never
			 * touched it, and the claim was created with no account.
			 *
			 * The stored value still wins when there IS one: that is the account
			 * the claim was actually filed under, and the form must show it.
			 */
			const loaded = claim.otherClaimDetails as { username?: unknown };
			const loadedUsername = typeof loaded.username === "string" ? loaded.username.trim() : "";
			const current = (f.values as { otherClaimDetails?: { username?: unknown } })
				.otherClaimDetails;
			const currentUsername = typeof current?.username === "string" ? current.username.trim() : "";

			f.setFieldValue("otherClaimDetails", {
				...OTHER_INITIAL_CLAIM_DETAILS,
				...claim.otherClaimDetails,
				...(loadedUsername || !currentUsername ? {} : { username: currentUsername }),
			});
		}
		// Toast only when we transition to a NEW claim id — otherwise every
		// re-lookup for the same AWB would pop a duplicate toast.
		if (lastLoadedIdRef.current !== claim._id) {
			lastLoadedIdRef.current = claim._id;
			toast.success("Existing claim loaded — Save will update this claim");
		}
	}, []);

	// Cancels edit mode without wiping the AWB field — useful when the
	// operator wants to create a fresh claim under the same AWB after a
	// prior one was deleted, or wants to abandon an in-progress edit.
	const cancelEditingMode = useCallback(() => {
		setEditingCmsId(null);
		setExistingClaim(null);
	}, []);

	return {
		formik,
		isSubmitting,
		submitWithAutoClaim,
		editingCmsId,
		existingClaim,
		applyExistingClaim,
		cancelEditingMode,
	};
};
