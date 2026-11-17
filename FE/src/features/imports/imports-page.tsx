"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon, type IconName } from "@/components/icons/icon";
import { Banner } from "@/components/ui/banner";
import { IconTile } from "@/components/ui/card-primitives";
import { Combobox } from "@/components/ui/combobox";
import { PageHeading } from "@/components/ui/page-heading";
import { toast } from "@/lib/events";
import { canAccess } from "@/lib/permissions";
import { useSelector } from "@/store";
import type { ImportDataType } from "@/types/imports";
import { ForwardReturnLinkDialog, OrderDataDialog, SkuImportDialog, UpdateStatusDialog, WhatsAppNumberDialog } from "./components/import-dialogs";
import { LinkedAwbCard } from "./components/linked-awb-card";
import { MasterUploadDialog } from "./components/master-upload-dialog";
import { ScanReturnParcelDialog } from "./components/scan-return-parcel-dialog";

type OpenDialog = "master" | "link" | "status" | "sku" | "order" | "whatsapp" | null;

const STATUS_CHANGE: ImportDataType = 'Change status from "Return Created" to "Return-Delivered"';

const BASE_OPTIONS: { label: string; value: ImportDataType }[] = [
  { label: "Forward and Return AWB linking", value: "Forward and Return AWB linking" },
  { label: 'Change status from "Return-Created" to "Return-Delivered"', value: STATUS_CHANGE },
  { label: "SKU Data", value: "SKU Data" },
  { label: "Order Data", value: "Order Data" },
  { label: "Customer WhatsApp Number Data", value: "Customer WhatsApp Number Data" },
];

const DIALOG_BY_TYPE: Record<ImportDataType, Exclude<OpenDialog, null>> = {
  "Master Data": "master",
  "Forward and Return AWB linking": "link",
  [STATUS_CHANGE]: "status",
  "SKU Data": "sku",
  "Order Data": "order",
  "Customer WhatsApp Number Data": "whatsapp",
};

function isDataType(value: string): value is ImportDataType {
  return value in DIALOG_BY_TYPE;
}

function SectionLabel({ icon, title, subtitle }: { icon: IconName; title: string; subtitle: string }) {
  return (
    <div className="tv-imports-section-label">
      <IconTile name={icon} tone="amber" />
      <div>
        <h2>{title}</h2>
        <p className="tv-muted tv-small">{subtitle}</p>
      </div>
    </div>
  );
}

/** TrackVid `ExternalImports` ("Import External VMS/Return Data"). */
export function ImportsPage() {
  const user = useSelector((s) => s.profile.userProfile);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const notificationId = searchParams.get("id") ?? "";

  const [dataType, setDataType] = useState("");
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [scanType, setScanType] = useState<"good" | "bad">("good");
  const [scanOpen, setScanOpen] = useState(false);
  const [dismissedId, setDismissedId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const hasEditPermission = canAccess(user, ["admin"], ["external_imports::edit"]);
  const hasMasterImportPermission = canAccess(user, ["admin"], ["master_data::edit"]);
  const options = user?.company?.settings?.isUsingMasterData ? [{ label: "Master Data", value: "Master Data" as const }, ...BASE_OPTIONS] : BASE_OPTIONS;

  const handleImport = () => {
    if (!dataType || !isDataType(dataType)) {
      toast.error("Please select a data type to import");
      return;
    }
    setDialog(DIALOG_BY_TYPE[dataType]);
  };

  const handleScanReturnParcel = (type: "good" | "bad") => {
    setScanType(type);
    setScanOpen(true);
  };

  // A new click on the same notification after the URL was cleared must open it again.
  if (!notificationId && dismissedId) setDismissedId("");
  const showNotificationScan = Boolean(notificationId) && notificationId !== dismissedId;
  const closeDialog = () => setDialog(null);
  const imported = () => setRefreshKey((k) => k + 1);

  return (
    <div className="tv-page tv-imports">
      <PageHeading
        title="Import External VMS/Return Data"
        subtitle="Import data files or scan return parcels. Verify the file's accuracy before uploading — you are accountable for any errors in your imports."
      />

      <Banner tone="warning">
        TrackVid is not liable for any mistakes or inaccuracies resulting from incorrect data uploads. Please double-check your file before importing.
      </Banner>

      <div className="tv-imports-grid">
        <section className="glass-card tv-imports-card">
          <SectionLabel icon="upload" title="Import Data" subtitle="Choose what type of data you want to upload, then pick your file." />
          <div className="tv-imports-row">
            <Combobox label="Select Data Type" placeholder="Search data types…" options={options} value={dataType} onChange={setDataType} />
            {hasEditPermission || hasMasterImportPermission ? (
              <button type="button" className="primary-button" onClick={handleImport}>
                <Icon name="upload" /> Import
              </button>
            ) : (
              <p className="tv-muted tv-small">You do not have permission to import data.</p>
            )}
          </div>
        </section>

        <section className="glass-card tv-imports-card">
          <SectionLabel icon="qr-code" title="Scan Return Parcel" subtitle="Mark each physically received return parcel as Good or Bad." />
          <div className="tv-row">
            <button type="button" className="primary-button tv-scan-good" onClick={() => handleScanReturnParcel("good")}>
              <Icon name="check-circle" /> Good Parcel
            </button>
            <button type="button" className="danger-button" onClick={() => handleScanReturnParcel("bad")}>
              <Icon name="x-circle" /> Bad Parcel
            </button>
          </div>
        </section>
      </div>

      <LinkedAwbCard refreshKey={refreshKey} canEdit={hasEditPermission} />

      {dialog === "master" ? <MasterUploadDialog onClose={closeDialog} onImported={imported} /> : null}
      {dialog === "link" ? <ForwardReturnLinkDialog onClose={closeDialog} onImported={imported} /> : null}
      {dialog === "status" ? <UpdateStatusDialog onClose={closeDialog} onImported={imported} /> : null}
      {dialog === "sku" ? <SkuImportDialog onClose={closeDialog} onImported={imported} /> : null}
      {dialog === "order" ? <OrderDataDialog onClose={closeDialog} onImported={imported} /> : null}
      {dialog === "whatsapp" ? <WhatsAppNumberDialog onClose={closeDialog} onImported={imported} /> : null}

      {scanOpen || showNotificationScan ? (
        <ScanReturnParcelDialog
          key={showNotificationScan ? notificationId : `scan-${scanType}`}
          type={scanType}
          notificationId={showNotificationScan ? notificationId : ""}
          onClose={() => {
            setScanOpen(false);
            if (notificationId) setDismissedId(notificationId);
          }}
          onLeaveNotification={() => router.replace(pathname)}
        />
      ) : null}
    </div>
  );
}
