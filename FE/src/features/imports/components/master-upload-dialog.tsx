"use client";

import { useState } from "react";
import { TextField } from "@/components/ui/form-field";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { masterImportPlatformOptions } from "@/config/constant";
import { toast } from "@/lib/events";
import { MasterData } from "@/services/masterData-service";
import type { ImportJobSummary } from "@/types/imports";
import { FileTile, ImportDialogShell } from "./import-dialog-shell";

/** Merge the results of the two Meesho / Myntra uploads into one summary. */
function mergeSummaries(list: ImportJobSummary[]): ImportJobSummary {
  const [first, ...rest] = list;
  return rest.reduce<ImportJobSummary>(
    (acc, s) => ({
      ...acc,
      fileName: `${acc.fileName}, ${s.fileName}`,
      totalRecords: acc.totalRecords + s.totalRecords,
      inserted: acc.inserted + s.inserted,
      updated: acc.updated + s.updated,
      failed: acc.failed + s.failed,
      queued: acc.queued || s.queued,
      message: s.queued ? s.message : acc.message,
      errors: [...acc.errors, ...s.errors],
    }),
    first,
  );
}

function form(entries: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

/** TrackVid `MasterFilePickerModel`: platform → per-platform account field + report files. */
export function MasterUploadDialog({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const [importPlatform, setImportPlatform] = useState("");
  const [orderReportFile, setOrderReportFile] = useState<File | null>(null);
  const [rtvReportFile, setRtvReportFile] = useState<File | null>(null);
  const [combinedFile, setCombinedFile] = useState<File | null>(null);
  const [myntraScanFile, setMyntraScanFile] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");

  const isAjio = importPlatform === "AJIO";
  const isMeesho = importPlatform === "MEESHO";
  const isSnapdeal = importPlatform === "SNAPDEAL";
  const isMyntra = importPlatform === "MYNTRA";
  const useDualReportUI = isAjio || isMeesho;
  const useSingleFileWithUsername = isSnapdeal || isMyntra;

  const resetAllFiles = () => {
    setOrderReportFile(null);
    setRtvReportFile(null);
    setCombinedFile(null);
    setMyntraScanFile(null);
    setEmail("");
    setUsername("");
  };

  const choosePlatform = (value: string) => {
    setImportPlatform(value);
    resetAllFiles();
  };

  const hasFiles = isMyntra
    ? Boolean(rtvReportFile || myntraScanFile)
    : useSingleFileWithUsername
      ? Boolean(rtvReportFile)
      : useDualReportUI
        ? Boolean(orderReportFile || rtvReportFile)
        : Boolean(combinedFile);

  const validate = (): string | null => {
    if (!importPlatform) return "Please select an e-commerce platform.";
    if (isSnapdeal) {
      if (!rtvReportFile) return "Please select a Dropship RTV Report file to upload.";
      if (!username.trim()) return "Please enter the Snapdeal account username.";
      return null;
    }
    if (isMyntra) {
      if (!rtvReportFile && !myntraScanFile) return "Please select a Myntra Returns Report and/or Scan-Video CSV to upload.";
      // Username only matters for the Returns Report (it stamps the master rows + back-fills CMS).
      if (rtvReportFile && !username.trim()) return "Please enter the Myntra account username.";
      return null;
    }
    if (useDualReportUI && !orderReportFile && !rtvReportFile) return "Please select at least one file to upload.";
    if (!useDualReportUI && !combinedFile) return "Please select a file to upload.";
    // TrackVid labels the AJIO email "(Optional)" but still requires it; kept as is.
    if (useDualReportUI && !email.trim()) return `Please enter the ${isMeesho ? "Meesho" : "AJIO"} account email.`;
    return null;
  };

  const upload = async (): Promise<ImportJobSummary> => {
    if (isSnapdeal && rtvReportFile) {
      return MasterData.uploadSnapdealMasterFile(form({ file: rtvReportFile, importPlatform: "SNAPDEAL", username, reportType: "Dropship Rtv Report" }));
    }
    if (isMyntra) {
      const jobs: Promise<ImportJobSummary>[] = [];
      if (rtvReportFile) jobs.push(MasterData.uploadMyntraMasterFile(form({ file: rtvReportFile, importPlatform: "MYNTRA", username, reportType: "Myntra Returns Report" })));
      if (myntraScanFile) jobs.push(MasterData.uploadMyntraScanVideoFile(form({ file: myntraScanFile })));
      return mergeSummaries(await Promise.all(jobs));
    }
    if (isMeesho) {
      const jobs: Promise<ImportJobSummary>[] = [];
      if (orderReportFile) jobs.push(MasterData.uploadMeeshoMasterFile(form({ file: orderReportFile, importPlatform: "MEESHO", reportType: "Dropship Order Report", email })));
      if (rtvReportFile) jobs.push(MasterData.uploadMeeshoMasterFile(form({ file: rtvReportFile, importPlatform: "MEESHO", reportType: "Dropship Rtv Report", email })));
      return mergeSummaries(await Promise.all(jobs));
    }
    const fd = form({ importPlatform });
    if (isAjio && orderReportFile) fd.append("DropshipOrderFile", orderReportFile);
    if (isAjio && rtvReportFile) fd.append("DropshipRtvFile", rtvReportFile);
    if (!isAjio && combinedFile) fd.append("DropshipFile", combinedFile);
    if (isAjio) fd.append("email", email);
    return MasterData.uploadMasterFile(fd);
  };

  const dualTiles = (
    <>
      <FileTile
        label="Dropship Order Report"
        help="Path = Seller Central > Reporting > View Reports > Report Type = Dropship Order Report"
        file={orderReportFile}
        onPick={setOrderReportFile}
        onRemove={() => setOrderReportFile(null)}
      />
      <FileTile
        label="Dropship RTV Report"
        help="Path = Seller Central > Reporting > View Reports > Report Type = Dropship Rtv Report"
        file={rtvReportFile}
        onPick={setRtvReportFile}
        onRemove={() => setRtvReportFile(null)}
      />
    </>
  );

  return (
    <ImportDialogShell
      title="Upload Master Data"
      subtitle="Choose your e-commerce platform and upload the matching reports"
      icon="warehouse"
      size="wide"
      canUpload={Boolean(importPlatform) && hasFiles}
      uploadLabel="Upload Files"
      validate={validate}
      onUpload={upload}
      onFinished={(s) => {
        // TrackVid shows the 202 "queued" message, otherwise "File uploaded successfully".
        toast.success(s.queued ? s.message : "File uploaded successfully");
        onImported?.();
      }}
      onReset={() => choosePlatform("")}
      onClose={onClose}
      extraBody={
        <>
          <div className="tv-platform-pick" role="radiogroup" aria-label="E-commerce Platform">
            {masterImportPlatformOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={importPlatform === o.value}
                className={importPlatform === o.value ? "is-active" : undefined}
                onClick={() => choosePlatform(o.value)}
              >
                <PlatformLogo name={o.label} />
              </button>
            ))}
          </div>

          {isAjio ? (
            <>
              <TextField label="AJIO Account Email (Optional)" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
              {dualTiles}
            </>
          ) : null}

          {isMeesho ? (
            <>
              <TextField label="Meesho Account Email" required type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
              {dualTiles}
            </>
          ) : null}

          {isSnapdeal ? (
            <>
              <TextField label="Snapdeal Account Username" required value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
              <FileTile
                label="Dropship RTV Report"
                help="Path = Seller Panel > Reports > Dropship RTV Report"
                file={rtvReportFile}
                onPick={setRtvReportFile}
                onRemove={() => setRtvReportFile(null)}
              />
            </>
          ) : null}

          {isMyntra ? (
            <>
              <TextField label="Myntra Account Username" required value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
              <FileTile
                label="Myntra Returns Report"
                help="Path = Myntra Partner Portal > Reports > Returns Report"
                file={rtvReportFile}
                onPick={setRtvReportFile}
                onRemove={() => setRtvReportFile(null)}
              />
              <FileTile
                label="Scan Video CSV (Optional)"
                help="External-import scan CSV: columns Scan Video, Scan Type, Tracking Id"
                file={myntraScanFile}
                onPick={setMyntraScanFile}
                onRemove={() => setMyntraScanFile(null)}
              />
            </>
          ) : null}

          {importPlatform && !isAjio && !isMeesho && !isSnapdeal && !isMyntra ? (
            <FileTile label="Combined Report" file={combinedFile} onPick={setCombinedFile} onRemove={() => setCombinedFile(null)} />
          ) : null}
        </>
      }
    />
  );
}
