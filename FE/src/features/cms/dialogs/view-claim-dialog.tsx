"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { VideoPlayer } from "@/components/ui/video-player";
import ROUTE_URLS from "@/config/route";
import { isImageKey, safeMediaUrl, useFileUrl } from "@/features/cms/cms-files";
import type { FileMetadata, ICms } from "@/types/cms";

const formatWhen = (raw?: string): string => {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function ReadOnlyField({ label, value, full = false }: { label: string; value?: string | null; full?: boolean }) {
  return (
    <div className={`tv-cms-ro ${full ? "span-full" : ""}`.trim()}>
      <span>{label}</span>
      <p>{value && String(value).length ? value : "—"}</p>
    </div>
  );
}

function AttachmentTile({ label, fileKey }: { label: string; fileKey: string }) {
  const { url, loading } = useFileUrl(fileKey);
  const image = isImageKey(fileKey) || isImageKey(url ?? "");
  return (
    <figure className="tv-cms-attachment">
      <figcaption>{label}</figcaption>
      <div className="tv-cms-attachment-box">
        {loading ? (
          <Skeleton width="100%" height={120} />
        ) : !url ? (
          <span className="tv-muted tv-small">
            <Icon name="image" /> Not attached
          </span>
        ) : image ? (
          <>
            <img src={url} alt={label} />
            <a className="icon-button tv-cms-open" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label} in new tab`}>
              <Icon name="external-link" />
            </a>
          </>
        ) : (
          <a className="tv-link" href={url} target="_blank" rel="noopener noreferrer">
            <Icon name="file-text" /> Open document
          </a>
        )}
      </div>
    </figure>
  );
}

const keyOf = (f: FileMetadata | string | null | undefined): string => (typeof f === "string" ? f : f?.fileKey ?? "");

/** Files each platform attaches, in the order its update form shows them (TrackVid ViewClaimModal `attachments`). */
function attachmentsFor(row: ICms): { label: string; fileKey: string }[] {
  const p = row.eCommercePlatform.trim().toLowerCase();
  const list: { label: string; fileKey: string }[] = [];
  const add = (label: string, f: FileMetadata | string | null | undefined) => list.push({ label, fileKey: keyOf(f) });
  if (p === "myntra") {
    add("Shipping Label", row.myntraClaimDetails?.shippingLabelImage);
    (row.myntraClaimDetails?.packingImages ?? []).forEach((f, i) => add(`Packing Image ${i + 1}`, f));
  } else if (p === "meesho") {
    add("Barcode Image", row.barcodeImage);
    add("Received Image 1", row.receivedProductImage_1);
    add("Received Image 2", row.receivedProductImage_2);
    add("Received Image 3", row.receivedProductImage_3);
    add("Reverse Waybill", row.reverseWayBillImage);
  } else if (p === "snapdeal") {
    add("Outer Package Image 1", row.outerPackageImage_1);
    add("Outer Package Image 2", row.outerPackageImage_2);
    add("Inner Package Image 1", row.innerPackageImage_1);
    add("Inner Package Image 2", row.innerPackageImage_2);
    add("Product Image 1", row.productImage_1);
    add("Product Image 2", row.productImage_2);
    add("POD Image 1", row.podImage_1);
    add("POD Image 2", row.podImage_2);
  } else if (p === "amazon") {
    add("Shipping Label", row.otherClaimDetails?.shippingLabelImage);
    add("Serial Number Image", row.otherClaimDetails?.serialNumberImage);
    (row.otherClaimDetails?.contentsOfReturnImages ?? []).forEach((f, i) => add(`Contents of Return ${i + 1}`, f));
  } else if (p === "flipkart" || p === "tata cliq" || p === "tatacliq" || p === "delhivery") {
    add("Shipping Label", row.otherClaimDetails?.shippingLabelImage);
    (row.otherClaimDetails?.packingImages ?? []).forEach((f, i) => add(`Packing Image ${i + 1}`, f));
  } else if (p === "xbees") {
    (row.otherClaimDetails?.packingImages ?? []).forEach((f, i) => add(`Packing Image ${i + 1}`, f));
  } else {
    add("Return Product Image", row.returnProductImage);
    add("Forward Sent Product Image", row.forwardSentProductImage);
    add("Product Side Images (PDF)", row.sixSideImages);
    add("POD Proof", row.podProof);
    add("Barcode Image", row.barcodeImage);
    add("Received Product Image 1", row.receivedProductImage_1);
    add("Received Product Image 2", row.receivedProductImage_2);
    add("Received Product Image 3", row.receivedProductImage_3);
    add("Reverse Waybill", row.reverseWayBillImage);
    add("Outer Package 1", row.outerPackageImage_1);
    add("Outer Package 2", row.outerPackageImage_2);
  }
  return list.filter((a) => Boolean(a.fileKey));
}

function extraFieldsFor(row: ICms): { label: string; value: string }[] {
  const p = row.eCommercePlatform.trim().toLowerCase();
  const out: { label: string; value?: string }[] = [];
  if (p === "meesho") {
    const raw = String(row.stateOfThePacket ?? "").trim();
    out.push({ label: "Packet ID", value: row.packetId }, { label: "Sub Order Number", value: row.subOrderNumber }, { label: "State of the Packet", value: raw === "1" ? "Intact" : raw === "2" ? "Tampered" : "" });
  }
  if (p === "snapdeal") out.push({ label: "Sub Order Number", value: row.subOrderNumber });
  if (p === "amazon") out.push({ label: "Fulfillment Channel", value: row.otherClaimDetails?.fulfillmentChannel }, { label: "Type of Claim (Issue Area)", value: row.otherClaimDetails?.parentSelection });
  if (p === "flipkart") out.push({ label: "Claim Area", value: row.otherClaimDetails?.claimArea });
  if (p === "tata cliq" || p === "tatacliq") out.push({ label: "Reason of QC Failure", value: row.otherClaimDetails?.parentSelection });
  if (p === "delhivery") out.push({ label: "Freight Lane", value: row.otherClaimDetails?.domestic });
  if (p === "xbees") out.push({ label: "Dispute Amount", value: row.otherClaimDetails?.disputeAmount ? String(row.otherClaimDetails.disputeAmount) : "" });
  if (p === "nykaa" || p === "nykaa fashion") {
    out.push({ label: "Vendor Code", value: row.nykaaClaimDetails?.vendorCode }, { label: "SKU ID", value: row.nykaaClaimDetails?.skuId }, { label: "Return Type", value: row.nykaaClaimDetails?.returnType });
  }
  return out.filter((e): e is { label: string; value: string } => Boolean(e.value));
}

/** TrackVid `ViewClaimModal`: read-only view of a row (no API calls), with "Edit Claim" into /cms/update. */
export function ViewClaimDialog({ row, onClose }: { row: ICms; onClose: () => void }) {
  const router = useRouter();
  const platform = row.eCommercePlatform || "";
  const p = platform.trim().toLowerCase();
  const isBundle = ["myntra", "meesho", "snapdeal", "amazon", "flipkart", "tata cliq", "tatacliq", "delhivery", "xbees"].includes(p);
  const isNykaa = p === "nykaa" || p === "nykaa fashion";
  const accountEmail =
    row.ajio_account_email || row.meesho_account_email || row.snapdeal_account_username || row.myntraClaimDetails?.username || row.otherClaimDetails?.username || row.nykaaClaimDetails?.username || "";
  const attachments = attachmentsFor(row);
  const extras = extraFieldsFor(row);
  const additional = (row.additionalFields ?? []).filter((f) => f.key || f.value);
  const canEdit = Boolean(row.AWBNumber && platform);
  const mode = row.processingMode === "desktop" ? "Desktop app" : row.processingMode === "manual" ? "Manual" : row.processingMode ? "Automated" : "";
  const damagedVideo = row.myntraClaimDetails?.damagedProductVideoLink || row.myntraClaimDetails?.damagedProductVideo?.fileKey;

  return (
    <AppDialog
      title={
        <span className="tv-row">
          View SPF Claim
          {row.status ? <StatusPill value={row.status} /> : null}
          {row.feed?.name ? <span className="c-status blue">{row.feed.name}</span> : null}
        </span>
      }
      onClose={onClose}
      size="xl"
      className="tv-cms-view"
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!canEdit}
            onClick={() => {
              onClose();
              router.push(`${ROUTE_URLS.CMS_UPDATE}?awb=${encodeURIComponent(row.AWBNumber)}&platform=${encodeURIComponent(platform)}`);
            }}
          >
            <Icon name="pencil" /> Edit Claim
          </button>
        </>
      }
    >
      <div className="tv-cms-view-grid">
        <div className="tv-stack">
          <div className="tv-cms-ro-grid">
            <ReadOnlyField label="E-commerce Platform" value={platform} />
            <ReadOnlyField label="Type Of Claim" value={row.typeOfClaim} />
            <ReadOnlyField label={platform ? `${platform.toUpperCase()} Account` : "Account"} value={accountEmail} full />
            <ReadOnlyField label="Return AWB Number" value={row.AWBNumber} />
            <ReadOnlyField label="Forward AWB" value={row.forwardAWB} />
            {!isBundle ? (
              <>
                <ReadOnlyField label="Customer Order Number" value={row.customerOrderNumber} />
                <ReadOnlyField label="SKU" value={row.seller_sku} />
              </>
            ) : null}
            {!isBundle && !isNykaa ? (
              <>
                <ReadOnlyField label="Brand" value={row.order_Brand} />
                <ReadOnlyField label="POB ID" value={row.pobid} />
                <ReadOnlyField label="Account Type" value={row.accountType} />
              </>
            ) : null}
            <ReadOnlyField label="Processing Mode" value={mode} />
            <ReadOnlyField label="Forward Order Date" value={formatWhen(row.forwardOrderDate)} />
            <ReadOnlyField label="Return Delivery Date" value={formatWhen(row.returnDeliveryDate)} />
            <ReadOnlyField label={p === "meesho" ? "Description" : "Remark"} value={row.remark} full />
            {extras.map((e) => (
              <ReadOnlyField key={e.label} label={e.label} value={e.value} />
            ))}
          </div>
          <hr className="tv-divider" />
          <div className="tv-grid-2">
            <div className="tv-stack" style={{ gap: 6 }}>
              <strong className="tv-small tv-muted">Return Video</strong>
              <VideoPlayer src={safeMediaUrl(row.returnVideoLink)} title={`Return video ${row.AWBNumber}`} downloadName={`${row.AWBNumber}-return`} />
            </div>
            <div className="tv-stack" style={{ gap: 6 }}>
              <strong className="tv-small tv-muted">Forward Video</strong>
              <VideoPlayer src={safeMediaUrl(row.forwardVideoLink)} title={`Forward video ${row.AWBNumber}`} downloadName={`${row.AWBNumber}-forward`} />
            </div>
          </div>
          {p === "myntra" ? (
            <div className="tv-stack" style={{ gap: 6 }}>
              <strong className="tv-small tv-muted">Damaged Product Video</strong>
              <VideoPlayer src={safeMediaUrl(damagedVideo)} title="Damaged product video" />
            </div>
          ) : null}
          {row.scriptProcessingError ? (
            <>
              <hr className="tv-divider" />
              <ReadOnlyField label="Script Processing Error" value={row.scriptProcessingError} full />
            </>
          ) : null}
        </div>
        <div className="tv-stack">
          <strong className="tv-small tv-muted">Attachments</strong>
          {attachments.length ? (
            <div className="tv-cms-attachments">
              {attachments.map((a) => (
                <AttachmentTile key={a.label} label={a.label} fileKey={a.fileKey} />
              ))}
            </div>
          ) : (
            <p className="tv-muted tv-small" style={{ textAlign: "center", padding: "12px 0" }}>
              No attachments on this claim.
            </p>
          )}
          {additional.length ? (
            <>
              <hr className="tv-divider" />
              <strong className="tv-small tv-muted">Additional Fields</strong>
              {additional.map((f, i) =>
                isImageKey(f.value) || f.value.startsWith("/") ? (
                  <AttachmentTile key={f._id || i} label={f.key || `Field ${i + 1}`} fileKey={f.value} />
                ) : (
                  <ReadOnlyField key={f._id || i} label={f.key || `Field ${i + 1}`} value={f.value} />
                ),
              )}
            </>
          ) : null}
        </div>
      </div>
    </AppDialog>
  );
}
