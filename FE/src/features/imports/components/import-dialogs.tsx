"use client";

import { useState } from "react";
import { SelectField } from "@/components/ui/form-field";
import { eCommercePlatformOptions, importTypeOptions, masterImportPlatformOptions } from "@/config/constant";
import { downloadBlob } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { ExternalOrdersService } from "@/services/externalOrder-service";
import { MasterData } from "@/services/masterData-service";
import { orderDataService } from "@/services/orderData-service";
import { skuDataService } from "@/services/skuData-service";
import { whatsappNumberService } from "@/services/whatsappNumber-service";
import type { ImportJobSummary, WhatsAppNumberUploadResult } from "@/types/imports";
import { ImportDialogShell, type SampleSheet } from "./import-dialog-shell";

const SHEETS = "/assets/sheets";

interface DialogProps {
  onClose: () => void;
  /** Called after a finished import so a screen can reload its table. */
  onImported?: () => void;
  showSampleSheetButton?: boolean;
}

function fileForm(field: string, file: File | null, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  if (file) fd.append(field, file);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

// ---------- Forward and Return AWB linking (TrackVid FilePickerModel) ----------

const SAMPLE_BY_COMBO: Record<string, SampleSheet> = {
  "return-ajio": { label: "Download AJIO Return Sample", href: `${SHEETS}/ajioReturnSheet.xlsx` },
  "forward-ajio": { label: "Download AJIO Forward Sample", href: `${SHEETS}/ajioForwardSheet.xlsx` },
  "return-myntra": { label: "Download Myntra Return Sample", href: `${SHEETS}/myntraReturnSheet.xlsx` },
  "forward-myntra": { label: "Download Myntra Forward Sample", href: `${SHEETS}/myntraForwardSheet.xlsx` },
  "return-amazon": { label: "Download Amazon Return Sample", href: `${SHEETS}/amazonReturnSheet.xlsx` },
  "forward-amazon": { label: "Download Amazon Forward Sample", href: `${SHEETS}/amazonForwardSheet.xlsx` },
};

export function ForwardReturnLinkDialog({ onClose, onImported, showSampleSheetButton = true }: DialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [importType, setImportType] = useState("");
  const [importPlatform, setImportPlatform] = useState("");
  const isFlipkart = importPlatform === "flipkart";
  const sampleKey = importType && importPlatform ? `${importType}-${importPlatform}` : "";

  return (
    <ImportDialogShell
      title="Forward & Return AWB Linking"
      subtitle="Upload an Excel or CSV file from your e-commerce platform"
      size="wide"
      file={file}
      onFileChange={setFile}
      validate={() => {
        if (!importPlatform) return "Please select an e-commerce platform";
        // TrackVid hides Import Type for Flipkart (its sheet carries both AWBs), so it is not required there.
        if (!isFlipkart && !importType) return "Please select an import type";
        if (!file) return "Please select a file to upload";
        return null;
      }}
      onUpload={() => ExternalOrdersService.uploadExternalOrder(fileForm("file", file, { importType: isFlipkart ? "" : importType, importPlatform }))}
      onFinished={() => {
        toast.success("File uploaded successfully");
        onImported?.();
      }}
      onReset={() => {
        setImportPlatform("");
        setImportType("");
      }}
      sampleSheet={showSampleSheetButton ? SAMPLE_BY_COMBO[sampleKey] : undefined}
      onClose={onClose}
      extraBody={
        <div className="c-form-grid">
          <SelectField
            label="E-commerce Platform"
            name="importPlatform"
            value={importPlatform}
            placeholder="Select platform"
            options={eCommercePlatformOptions}
            onChange={(e) => setImportPlatform(e.currentTarget.value)}
            full={isFlipkart}
          />
          {!isFlipkart ? (
            <SelectField
              label="Import Type"
              name="importType"
              value={importType}
              placeholder="Select type"
              options={importTypeOptions}
              onChange={(e) => setImportType(e.currentTarget.value)}
            />
          ) : null}
        </div>
      }
    />
  );
}

// ---------- Change status Return-Created → Return-Delivered (TrackVid UpdateStatus) ----------

export function UpdateStatusDialog({ onClose, onImported, showSampleSheetButton = true }: DialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [importPlatform, setImportPlatform] = useState("");

  return (
    <ImportDialogShell
      title="Change Status: Return-Created → Return-Delivered"
      subtitle="Upload an Excel or CSV with the AWB list to update"
      size="wide"
      file={file}
      onFileChange={setFile}
      validate={() => (!importPlatform || !file ? "Please complete all fields and select the file to upload" : null)}
      onUpload={() => MasterData.uploadStatusFile(fileForm("UpdateRtv", file, { importPlatform }))}
      onFinished={(s) => {
        toast.success(s.queued ? s.message : "File uploaded successfully");
        onImported?.();
      }}
      onReset={() => setImportPlatform("")}
      sampleSheet={
        importPlatform === "AJIO" && showSampleSheetButton ? { label: "Download Status Update Sample", href: `${SHEETS}/Status_Update_Sheet.xlsx` } : undefined
      }
      onClose={onClose}
      extraBody={
        <SelectField
          label="E-commerce Platform"
          name="importPlatform"
          value={importPlatform}
          placeholder="Select platform"
          options={masterImportPlatformOptions}
          onChange={(e) => setImportPlatform(e.currentTarget.value)}
        />
      }
    />
  );
}

// ---------- SKU Data (TrackVid SkuModel) ----------

export function SkuImportDialog({ onClose, onImported, showSampleSheetButton = true }: DialogProps) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <ImportDialogShell
      title="Upload SKU Data"
      subtitle="Excel or CSV file with seller SKU code, color, size, and image link"
      file={file}
      onFileChange={setFile}
      validate={() => (!file ? "Please select a file to upload" : null)}
      onUpload={() => skuDataService.uploadSkuFile(fileForm("ProductSkucodeFile", file))}
      onFinished={() => {
        toast.success("SKU data uploaded successfully");
        onImported?.();
      }}
      sampleSheet={showSampleSheetButton ? { label: "Download SKU Data Sample", href: `${SHEETS}/SKU_Data.xlsx` } : undefined}
      onClose={onClose}
    />
  );
}

// ---------- Order Data (TrackVid OrderDataModel) ----------

export function OrderDataDialog({ onClose, onImported, showSampleSheetButton = true }: DialogProps) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <ImportDialogShell
      title="Upload Order Data"
      subtitle="Excel or CSV file containing your order records"
      file={file}
      onFileChange={setFile}
      validate={() => (!file ? "Please select a file to upload" : null)}
      onUpload={() => orderDataService.uploadOrderDataFile(fileForm("file", file))}
      onFinished={() => {
        toast.success("Order data uploaded successfully");
        onImported?.();
      }}
      sampleSheet={showSampleSheetButton ? { label: "Download Order Data Sample", href: `${SHEETS}/Order_Data.xlsx` } : undefined}
      onClose={onClose}
    />
  );
}

// ---------- Customer WhatsApp numbers (TrackVid WhatsAppNumberModel) ----------

// Numbers are always saved, but a row only gets a WhatsApp message once its
// AWB / Order ID matches a VMS video — say so instead of a blanket success.
function showUploadResultToast(result: WhatsAppNumberUploadResult | null): void {
  const unmatched = result?.unmatchedRecords ?? 0;
  if (!result?.matchChecked || unmatched === 0) {
    toast.success("WhatsApp numbers uploaded — records are being linked");
    return;
  }
  const ids = result.unmatchedIdentifiers ?? [];
  const list = ids.join(", ") + (unmatched > ids.length ? ` and ${unmatched - ids.length} more` : "");
  const summary = result.matchedRecords
    ? `${result.matchedRecords} of ${result.totalRecords} records matched a VMS video. `
    : "No uploaded record matched a VMS video. ";
  toast.error(`${summary}No VMS video found for: ${list}. Check the AWB / Order ID — the message will be sent once a matching video is recorded.`);
}

function isWhatsAppResult(s: ImportJobSummary): s is WhatsAppNumberUploadResult {
  return "matchChecked" in s;
}

export function WhatsAppNumberDialog({ onClose, onImported, showSampleSheetButton = true }: DialogProps) {
  const [file, setFile] = useState<File | null>(null);

  const downloadSample = async () => {
    // TrackVid fetches the sample from the BE so long AWBs stay text (no scientific notation).
    try {
      const blob = await whatsappNumberService.downloadWhatsAppNumberSample();
      downloadBlob(blob, "WhatsApp_Number_Sample.csv");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to download sample sheet. Please try again."));
    }
  };

  return (
    <ImportDialogShell
      title="Upload Customer WhatsApp Numbers"
      subtitle="Excel or CSV with Order ID, AWB Number, Customer WhatsApp Number, and Customer Name"
      file={file}
      onFileChange={setFile}
      validate={() => (!file ? "Please select a file to upload" : null)}
      onUpload={() => whatsappNumberService.uploadWhatsAppNumberFile(fileForm("file", file))}
      onFinished={(s) => {
        showUploadResultToast(isWhatsAppResult(s) ? s : null);
        onImported?.();
      }}
      sampleSheet={showSampleSheetButton ? { label: "Download WhatsApp Sample", onDownload: () => void downloadSample() } : undefined}
      onClose={onClose}
    />
  );
}
