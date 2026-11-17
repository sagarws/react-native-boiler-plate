"use client";

import { Combobox } from "@/components/ui/combobox";
import { LOGISTICS_PARTNERS } from "@/mocks/cms-create";
import type { ExistingCmsPreview, StoredFile } from "@/types/cms-create";
import { PlatformAccountDropdown, usePlatformAccountAutoSelect } from "@/features/cms-create/account-select";
import { CostOfMissingArticle, FormText, ImageSlot, LeftVideos, RearrangeButton, RemarkField, SectionTitle, TwoColumn, type PlatformFormProps } from "@/features/cms-create/form-bits";
import { errorAt, keyOfUrl, stringAt, type CmsFormik } from "@/features/cms-create/hooks";
import type { MediaSrc } from "@/features/cms-create/media/media-thumb";
import { RearrangeDialog, type ArrangementField } from "@/features/cms-create/rearrange-dialog";
import { useCmsAutoFetch } from "@/features/cms-create/use-cms-auto-fetch";
import { useVmsScreenshots } from "@/features/cms-create/use-vms-screenshots";
import { useSlotPreviews, useVideoPreviews } from "@/features/cms-create/platforms/use-video-previews";

interface SlotDef {
  name: keyof ExistingCmsPreview & string;
  label: string;
  short: string;
  required: boolean;
}

/** Spread shots over a slot list: first → first, last → last, the rest in order between. */
function spread(slots: readonly SlotDef[], shots: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!shots.length || !slots.length) return out;
  out[slots[0].name] = shots[0];
  if (shots.length > 1 && slots.length > 1) out[slots[slots.length - 1].name] = shots[shots.length - 1];
  shots.slice(1, -1).forEach((s, i) => {
    const slot = slots[i + 1];
    if (slot && i + 1 < slots.length - 1) out[slot.name] = s;
  });
  return out;
}

const urlOf = (v: unknown): string | null => (v && typeof v === "object" ? ((v as StoredFile).url ?? null) : null);

/** Right column made of single named slots (Meesho, Snapdeal) with VMS fill + Rearrange. */
function SlotPanel({ props, slots, title }: { props: PlatformFormProps; slots: readonly SlotDef[]; title: string }) {
  const { formik, feedId, existingClaim, carryOverImages, isUpdateMode } = props;
  const [previews, setPreviews] = useSlotPreviews(existingClaim, (c) => Object.fromEntries(slots.map((s) => [s.name, urlOf(c[s.name])])));
  const schema: ArrangementField[] = slots.map((s, i) => ({ fieldName: s.name, label: s.short, position: i === 0 ? "first" : i === slots.length - 1 ? "last" : "middle" }));
  const fields = slots.map((s) => s.name);

  const writeAll = (map: Record<string, MediaSrc | null>) => {
    // Resolve keys before anything moves: a local File keeps the key of the slot it was uploaded into.
    const keys = Object.fromEntries(
      Object.entries(map).map(([name, src]) => {
        if (src === null) return [name, ""];
        if (typeof src === "string") return [name, keyOfUrl(src)];
        const from = fields.find((f) => previews[f] === src);
        return [name, from ? stringAt(formik, from) : ""];
      }),
    );
    setPreviews((p) => ({ ...p, ...map }));
    for (const [name, key] of Object.entries(keys)) void formik.setFieldValue(name, key);
  };

  const vms = useVmsScreenshots({
    awb: formik.values.AWBNumber,
    forwardAwb: formik.values.forwardAWB,
    previews,
    imageFields: fields,
    carryOverImages,
    isUpdateMode,
    populate: (shots) => writeAll(spread(slots, shots)),
    reset: () => writeAll(Object.fromEntries(fields.map((f) => [f, null]))),
  });

  const applyArranged = (arranged: (MediaSrc | null)[]) => {
    writeAll(Object.fromEntries(fields.map((f, i) => [f, arranged[i] ?? null])));
    vms.setFetchedScreenshots((prev) => [...prev, ...arranged.filter((u): u is string => typeof u === "string" && Boolean(u) && !prev.includes(u))]);
  };

  return (
    <>
      <SectionTitle icon="image" title={title} hint="VMS screenshots for the Return AWB fill these slots automatically." />
      <RearrangeButton show={vms.fetchedScreenshots.length > 0 || vms.forwardOnlyScreenshots.length > 0} onClick={() => vms.setRearrangeModalOpen(true)} />
      <div className="tv-grid-2">
        {slots.map((s) => (
          <ImageSlot key={s.name} formik={formik} feedId={feedId} name={s.name} label={s.label} required={s.required} preview={previews[s.name]} onFileChange={(name, file) => setPreviews((p) => ({ ...p, [name]: file }))} size="lg" />
        ))}
      </div>
      {vms.rearrangeModalOpen ? <RearrangeDialog title="Rearrange Product Screenshots" schema={schema} images={vms.rearrangeImagePool} initialSlotImages={vms.rearrangeInitialSlots} onSave={applyArranged} onClose={() => vms.setRearrangeModalOpen(false)} /> : null}
    </>
  );
}

const MEESHO_SLOTS: SlotDef[] = [
  { name: "barcodeImage", label: "Barcode Image", short: "Barcode Image", required: false },
  { name: "receivedProductImage_1", label: "Received Product Image", short: "Received Image 1", required: true },
  { name: "reverseWayBillImage", label: "Reverse Way Bill", short: "Reverse Way Bill", required: true },
];

const POD_CLAIM_LABEL = "Return/RTO product not received but marked delivered - Need Proof of Delivery";
const STATE_OF_PACKET_OPTIONS = [
  { value: "1", label: "Intact" },
  { value: "2", label: "Tampered" },
];

function AwbPair({ formik, onReturn, onForward, forwardLabel = "Forward AWB" }: { formik: CmsFormik; onReturn: (v: string) => void; onForward: (v: string) => void; forwardLabel?: string }) {
  return (
    <>
      <FormText formik={formik} name="AWBNumber" label="Return AWB Number" required placeholder="Enter AWB Number" onValue={onReturn} />
      <FormText formik={formik} name="forwardAWB" label={forwardLabel} placeholder="Enter Forward AWB" onValue={onForward} />
    </>
  );
}

/** TrackVid `MeeshoForm`: sub-order / packet fields, logistics partner for POD claims, three named image slots. */
export function MeeshoForm(props: PlatformFormProps) {
  const { formik, feedId, header, isPartialArticleClaim, existingClaim } = props;
  const videos = useVideoPreviews(existingClaim);
  const auto = useCmsAutoFetch({ formik, isMeesho: true, onReturnVideoLink: (l) => videos.onLinkChange("returnVideo", l), onForwardVideoLink: (l) => videos.onLinkChange("forwardVideo", l) });
  const account = usePlatformAccountAutoSelect({ platform: "meesho", awb: formik.values.AWBNumber, currentValue: formik.values.meesho_account_email ?? "", onResolve: (a) => void formik.setFieldValue("meesho_account_email", a) });

  const left = (
    <>
      {header}
      <SectionTitle icon="clipboard-text" title="Claim details" />
      <div className="c-form-grid tv-cmsc-grid">
        {isPartialArticleClaim ? <CostOfMissingArticle formik={formik} /> : null}
        {formik.values.typeOfClaimName === POD_CLAIM_LABEL ? (
          <Combobox
            label="Logistics Partner Name"
            required
            value={formik.values.logisticsPartnerName ?? ""}
            onChange={(v) => void formik.setFieldValue("logisticsPartnerName", v)}
            options={LOGISTICS_PARTNERS.map((p) => ({ value: p, label: p }))}
            placeholder="Select Logistics Partner"
            error={errorAt(formik, "logisticsPartnerName")}
            full
          />
        ) : null}
        <RemarkField formik={formik} label="Description" placeholder="Additional Description" />
        <FormText formik={formik} name="subOrderNumber" label="Suborder Number" required placeholder="Enter Suborder Number" onValue={auto.onSubOrderChange} />
        <Combobox
          label="State of The Packet"
          required
          value={formik.values.stateOfThePacket ?? ""}
          onChange={(v) => {
            void formik.setFieldValue("stateOfThePacket", v);
            void formik.setFieldTouched("stateOfThePacket", true, false);
          }}
          options={STATE_OF_PACKET_OPTIONS}
          placeholder="Select State of Packet"
          error={errorAt(formik, "stateOfThePacket")}
        />
        <FormText formik={formik} name="packetId" label="Packet ID" required placeholder="Enter Packet ID" />
        <div className="span-full">
          <PlatformAccountDropdown platform="meesho" label="Meesho Account Username" value={formik.values.meesho_account_email ?? ""} onChange={(v) => void formik.setFieldValue("meesho_account_email", v)} />
        </div>
        <AwbPair
          formik={formik}
          forwardLabel="Forward AWB Number"
          onReturn={(v) => {
            auto.onReturnAwbChange(v);
            account.onReturnAwb(v);
          }}
          onForward={(v) => {
            auto.onForwardAwbChange(v);
            account.onForwardAwb(v);
          }}
        />
      </div>
      <SectionTitle icon="video-camera" title="Videos" />
      <LeftVideos formik={formik} feedId={feedId} previews={videos.previews} onPreviewChange={videos.onPreviewChange} onLinkChange={videos.onLinkChange} />
    </>
  );
  return <TwoColumn left={left} right={<SlotPanel props={props} slots={MEESHO_SLOTS} title="Packet images" />} />;
}

const SNAPDEAL_SLOTS: SlotDef[] = [
  { name: "outerPackageImage_1", label: "Outer Package Image 1", short: "Outer Package 1", required: true },
  { name: "outerPackageImage_2", label: "Outer Package Image 2", short: "Outer Package 2", required: false },
  { name: "innerPackageImage_1", label: "Inner Package Image 1", short: "Inner Package 1", required: true },
  { name: "innerPackageImage_2", label: "Inner Package Image 2", short: "Inner Package 2", required: false },
  { name: "productImage_1", label: "Product Image 1", short: "Product Image 1", required: true },
  { name: "productImage_2", label: "Product Image 2", short: "Product Image 2", required: false },
  { name: "podImage_1", label: "POD Image 1", short: "POD Image 1", required: true },
  { name: "podImage_2", label: "POD Image 2", short: "POD Image 2", required: false },
];

/** TrackVid `SnapdealForm`: account, AWBs, sub-order, remark, videos and eight package / product / POD slots. */
export function SnapdealForm(props: PlatformFormProps) {
  const { formik, feedId, header, isPartialArticleClaim, existingClaim } = props;
  const videos = useVideoPreviews(existingClaim);
  const auto = useCmsAutoFetch({ formik, isSnapdeal: true, onReturnVideoLink: (l) => videos.onLinkChange("returnVideo", l), onForwardVideoLink: (l) => videos.onLinkChange("forwardVideo", l) });
  const account = usePlatformAccountAutoSelect({ platform: "snapdeal", awb: formik.values.AWBNumber, currentValue: formik.values.snapdeal_account_username ?? "", onResolve: (a) => void formik.setFieldValue("snapdeal_account_username", a) });

  const left = (
    <>
      {header}
      <SectionTitle icon="clipboard-text" title="Claim details" />
      <div className="c-form-grid tv-cmsc-grid">
        {isPartialArticleClaim ? <CostOfMissingArticle formik={formik} /> : null}
        <div className="span-full">
          <PlatformAccountDropdown platform="snapdeal" label="Snapdeal Account Username" value={formik.values.snapdeal_account_username ?? ""} onChange={(v) => void formik.setFieldValue("snapdeal_account_username", v)} />
        </div>
        <AwbPair
          formik={formik}
          onReturn={(v) => {
            auto.onReturnAwbChange(v);
            account.onReturnAwb(v);
          }}
          onForward={(v) => {
            auto.onForwardAwbChange(v);
            account.onForwardAwb(v);
          }}
        />
        <FormText formik={formik} name="subOrderNumber" label="Suborder Number" placeholder="Enter Suborder Number" onValue={auto.onSubOrderChange} />
        <RemarkField formik={formik} placeholder="Additional Remark" />
      </div>
      <SectionTitle icon="video-camera" title="Videos" />
      <LeftVideos formik={formik} feedId={feedId} previews={videos.previews} onPreviewChange={videos.onPreviewChange} onLinkChange={videos.onLinkChange} />
    </>
  );
  return <TwoColumn left={left} right={<SlotPanel props={props} slots={SNAPDEAL_SLOTS} title="Package images" />} />;
}
