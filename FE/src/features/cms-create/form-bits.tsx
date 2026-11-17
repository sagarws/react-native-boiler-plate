"use client";

import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { TextareaField, TextField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/states";
import { errorMessage, toast } from "@/lib/events";
import { uploadCmsImage } from "@/services/cms-create-service";
import type { ExistingCmsPreview } from "@/types/cms-create";
import { errorAt, stringAt, type CmsFormik } from "@/features/cms-create/hooks";
import { FileInput } from "@/features/cms-create/media/file-input";
import { useMediaCapture } from "@/features/cms-create/media/media-capture-provider";
import { isFileSrc, MediaImage, type MediaSrc } from "@/features/cms-create/media/media-thumb";

export interface PlatformFormProps {
  formik: CmsFormik;
  feedId: string;
  /** Platform picker + claim-type cascade, rendered at the top of the left column. */
  header: ReactNode;
  sideImages: MediaSrc[];
  setSideImages: (files: MediaSrc[]) => void;
  isPartialArticleClaim: boolean;
  skus: string[];
  setSkus: (skus: string[]) => void;
  skuPickerOpen: boolean;
  setSkuPickerOpen: (open: boolean) => void;
  /** AjioForm doubles as the common layout; POB ID is AJIO-only. */
  isAjio: boolean;
  existingClaim: ExistingCmsPreview | null;
  carryOverImages: string[];
  isUpdateMode: boolean;
}

/** Two-column editor: form on the left (~60%), media workspace on the right. */
export function TwoColumn({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="tv-cmsc-layout">
      <section className="glass-card tv-cmsc-main">{left}</section>
      <aside className="glass-card tv-cmsc-media" aria-label="Claim media">
        {right}
      </aside>
    </div>
  );
}

export function SectionTitle({ icon, title, hint }: { icon: "video-camera" | "image" | "clipboard-text" | "user" | "package"; title: string; hint?: ReactNode }) {
  return (
    <div className="product-section-heading tv-cmsc-heading">
      <span className="product-section-icon">
        <Icon name={icon} />
      </span>
      <div>
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </div>
    </div>
  );
}

export const req = (text: string) => (
  <>
    {text} <small className="tv-cmsc-req">*</small>
  </>
);

/** Bind a plain text input to a (nested) formik path. */
export function FormText({ formik, name, label, placeholder, required, type = "text", onValue, readOnly, onClick, hint, full }: { formik: CmsFormik; name: string; label: ReactNode; placeholder?: string; required?: boolean; type?: string; onValue?: (v: string) => void; readOnly?: boolean; onClick?: () => void; hint?: ReactNode; full?: boolean }) {
  return (
    <TextField
      label={required ? req(String(label)) : label}
      name={name}
      type={type}
      placeholder={placeholder}
      value={stringAt(formik, name)}
      onChange={(e) => (onValue ? onValue(e.currentTarget.value) : void formik.setFieldValue(name, e.currentTarget.value))}
      onBlur={() => void formik.setFieldTouched(name, true)}
      error={errorAt(formik, name)}
      readOnly={readOnly}
      onClick={onClick}
      hint={hint}
      full={full}
    />
  );
}

export function RemarkField({ formik, label = "Remark", placeholder }: { formik: CmsFormik; label?: string; placeholder?: string }) {
  return (
    <TextareaField
      label={label}
      name="remark"
      rows={2}
      placeholder={placeholder ?? label}
      value={stringAt(formik, "remark")}
      onChange={(e) => void formik.setFieldValue("remark", e.currentTarget.value)}
      onBlur={() => void formik.setFieldTouched("remark", true)}
    />
  );
}

export function CostOfMissingArticle({ formik }: { formik: CmsFormik }) {
  return <FormText formik={formik} name="costOfMissingArticle" label="Cost of Missing Article" placeholder="Enter Cost of Missing Article" type="number" full />;
}

export const fileHandlers = (formik: CmsFormik) => ({
  setFieldValue: (f: string, v: string) => void formik.setFieldValue(f, v),
  setFieldTouched: (f: string) => void formik.setFieldTouched(f, true, false),
});

/** A labelled single upload slot with its error line. */
export function ImageSlot({ formik, feedId, name, label, required, preview, onFileChange, hint, size = "md", disableCapture, accept, maxMb, setValue }: { formik: CmsFormik; feedId: string; name: string; label: string; required?: boolean; preview: MediaSrc | null | undefined; onFileChange: (name: string, file: File | null) => void; hint?: ReactNode; size?: "sm" | "md" | "lg"; disableCapture?: boolean; accept?: string; maxMb?: number; setValue?: (field: string, value: string) => void }) {
  const err = errorAt(formik, name);
  const h = fileHandlers(formik);
  return (
    <div className="tv-cmsc-field">
      <span className="tv-cmsc-label">
        {required ? req(label) : label}
        {hint ? <em>{hint}</em> : null}
      </span>
      <FileInput name={name} label={label} feedId={feedId} preview={preview} onFileChange={onFileChange} setFieldValue={setValue ?? h.setFieldValue} setFieldTouched={h.setFieldTouched} error={Boolean(err)} size={size} disableCapture={disableCapture} accept={accept} maxMb={maxMb} />
      {err ? <span className="tv-field-error">{err}</span> : null}
    </div>
  );
}

/** TrackVid `LeftVideos`: Return video (required: file or link) + Forward video, each upload / record or paste a link. */
export function LeftVideos({ formik, feedId, previews, onPreviewChange, onLinkChange }: { formik: CmsFormik; feedId: string; previews: { returnVideo: MediaSrc | null; forwardVideo: MediaSrc | null }; onPreviewChange: (name: string, file: File | null) => void; onLinkChange: (side: "returnVideo" | "forwardVideo", value: string) => void }) {
  const h = fileHandlers(formik);
  const eitherError = formik.touched.returnVideo || formik.touched.returnVideoLink || formik.touched.eitherVideoOrLink ? formik.errors.eitherVideoOrLink : undefined;
  const block = (side: "returnVideo" | "forwardVideo", title: ReactNode, linkName: "returnVideoLink" | "forwardVideoLink", placeholder: string) => (
    <div className="tv-cmsc-video-card">
      <div className="tv-row-between">
        <span className="tv-cmsc-label">{title}</span>
        {side === "returnVideo" && typeof eitherError === "string" ? <span className="tv-field-error">{eitherError}</span> : null}
      </div>
      <FileInput name={side} label={side === "returnVideo" ? "Return video" : "Forward video"} feedId={feedId} preview={previews[side]} onFileChange={onPreviewChange} setFieldValue={h.setFieldValue} setFieldTouched={h.setFieldTouched} isVideo size="lg" error={formik.errors[side] === "*Unsupported File Format"}>
        <Icon name="camera" />
        <span>Choose a video</span>
      </FileInput>
      {!previews[side] ? (
        <>
          <div className="tv-cmsc-or">or paste link</div>
          <input
            className="tv-input"
            name={linkName}
            placeholder={placeholder}
            aria-label={placeholder}
            value={stringAt(formik, linkName)}
            onChange={(e) => {
              const v = e.currentTarget.value;
              void formik.setFieldValue(linkName, v);
              onLinkChange(side, v);
            }}
            onBlur={() => void formik.setFieldTouched(linkName, true)}
          />
        </>
      ) : null}
    </div>
  );
  return (
    <div className="tv-grid-2 tv-cmsc-videos">
      {block("returnVideo", req("Upload Return Video"), "returnVideoLink", "Return Video Link")}
      {block("forwardVideo", "Upload Forward Video", "forwardVideoLink", "Forward Video Link")}
    </div>
  );
}

export function RearrangeButton({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <button type="button" className="secondary-button compact-button tv-cmsc-rearrange-btn" onClick={onClick}>
      <Icon name="arrows-down-up" /> Rearrange Images
    </button>
  );
}

export function PreviewDialog({ src, title, onClose }: { src: MediaSrc; title: string; onClose: () => void }) {
  return (
    <AppDialog title={title} onClose={onClose} size="wide">
      <div className="tv-cmsc-viewer">
        <MediaImage src={src} alt={title} />
      </div>
    </AppDialog>
  );
}

export interface SlotItem {
  key: string;
  src: MediaSrc | null;
}

/**
 * Packing / evidence image grid (Myntra, Flipkart, Delhivery, Amazon contents): each slot uploads on its own,
 * slots show `min(max, max(defaultSlots, filled + 1))`, filled slots drag to reorder (arrow buttons too), remove
 * compacts the list.
 */
export function MultiImageSlots({ items, onChange, max, defaultSlots, maxMb, feedId, label, numbered = true }: { items: SlotItem[]; onChange: (items: SlotItem[]) => void; max: number; defaultSlots: number; maxMb: number; feedId: string; label: string; numbered?: boolean }) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [view, setView] = useState<MediaSrc | null>(null);
  const filled = items.filter((i) => i.key).length;
  const visible = Math.min(max, Math.max(defaultSlots, filled + 1));

  const upload = async (file: File, index: number) => {
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`Each image must be less than ${maxMb}MB`);
      return;
    }
    setUploading(index);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("feedId", feedId || "");
      const res = await uploadCmsImage(fd);
      const next = [...items];
      const at = Math.min(index, items.filter((i) => i.key).length);
      next[at] = { key: res.data.key, src: file };
      onChange(next.filter((i) => i && i.key).slice(0, max));
    } catch (e) {
      toast.error(errorMessage(e, "Upload failed"));
    } finally {
      setUploading(null);
    }
  };

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  return (
    <>
      <div className="tv-cmsc-multi">
        {Array.from({ length: visible }, (_, i) => {
          const item = items[i];
          const isFilled = Boolean(item?.key);
          return (
            <div
              key={i}
              className={`tv-cmsc-multi-slot ${isFilled ? "is-filled" : ""} ${dragOver === i ? "is-over" : ""}`}
              draggable={isFilled}
              onDragStart={(e) => {
                if (!isFilled) return;
                e.dataTransfer.effectAllowed = "move";
                setDragFrom(i);
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                setDragOver(i);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) move(dragFrom, Math.min(i, items.length - 1));
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
            >
              <input
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                type="file"
                accept="image/jpg,image/png,image/jpeg"
                hidden
                aria-label={`${label} ${i + 1}`}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (f) void upload(f, i);
                }}
              />
              {uploading === i ? (
                <Spinner />
              ) : isFilled && item?.src ? (
                <>
                  <MediaImage src={item.src} alt={`${label} ${i + 1}`} className="tv-cmsc-slot-media" />
                  {numbered ? <span className="tv-cmsc-arrange-num">{i + 1}</span> : null}
                  <button type="button" className="tv-cmsc-view" onClick={() => setView(item.src)} aria-label={`View ${label} ${i + 1}`}>
                    <Icon name="eye" />
                  </button>
                  <button type="button" className="tv-cmsc-remove" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${label} ${i + 1}`}>
                    <Icon name="trash" />
                  </button>
                  <span className="tv-cmsc-move">
                    <button type="button" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Move earlier">
                      <Icon name="caret-left" />
                    </button>
                    <button type="button" disabled={i >= items.length - 1} onClick={() => move(i, i + 1)} aria-label="Move later">
                      <Icon name="caret-right" />
                    </button>
                  </span>
                </>
              ) : (
                <button type="button" className="tv-cmsc-slot-empty" onClick={() => inputs.current[i]?.click()}>
                  <Icon name="image" />
                  <span>Upload</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      {view ? <PreviewDialog src={view} title={label} onClose={() => setView(null)} /> : null}
    </>
  );
}

/** TrackVid `UploadModal`: pick up to nine side images, review, Save. */
function UploadImagesDialog({ initial, onSave, onClose }: { initial: MediaSrc[]; onSave: (files: MediaSrc[]) => void; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<MediaSrc[]>(initial);
  const [error, setError] = useState("");
  return (
    <AppDialog
      title="Upload Images"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              if (images.length) onSave(images);
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/jpg"
        multiple
        hidden
        aria-label="Choose side images"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          if (images.length + files.length > 9) {
            setError("You can only select up to 9 images.");
            return;
          }
          setError("");
          setImages((prev) => [...prev, ...files]);
        }}
      />
      <button type="button" className={`tv-dropzone tv-cmsc-upload-zone ${error ? "has-error" : ""}`} onClick={() => input.current?.click()}>
        <Icon name="upload" />
        <strong>Upload</strong>
        <span className="tv-muted">Max you can select 9 images</span>
        {error ? <span className="tv-field-error">{error}</span> : null}
      </button>
      <div className="tv-cmsc-side-grid">
        {images.map((img, i) => (
          <div key={isFileSrc(img) ? `${img.name}-${img.lastModified}-${i}` : `${img}-${i}`} className="tv-cmsc-side-item">
            <MediaImage src={img} alt={`Side image ${i + 1}`} />
            <button type="button" className="tv-cmsc-remove" onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove side image ${i + 1}`}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
    </AppDialog>
  );
}

/** TrackVid `SixSideImagesInput`: 3–9 side images (upload dialog or live multi-capture), stored PDF tile on update. */
export function SixSideImages({ sideImages, setSideImages, existingPdfUrl }: { sideImages: MediaSrc[]; setSideImages: (files: MediaSrc[]) => void; existingPdfUrl?: string }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [view, setView] = useState<MediaSrc | null>(null);
  const media = useMediaCapture();
  const capture = () => {
    if (!media) return;
    media.openSideCapture({ files: sideImages.filter(isFileSrc), onSave: (files) => setSideImages([...sideImages.filter((s) => !isFileSrc(s)), ...files].slice(0, 9)) });
  };
  const box = (
    <div className="tv-cmsc-side-item tv-cmsc-split">
      <button type="button" onClick={() => setUploadOpen(true)}>
        <Icon name="image" />
        <span>Upload</span>
      </button>
      <button type="button" onClick={capture}>
        <Icon name="camera" />
        <span>Capture</span>
      </button>
    </div>
  );
  const hasAny = sideImages.length > 0 || Boolean(existingPdfUrl);
  return (
    <>
      <div className={`tv-cmsc-side-grid ${hasAny ? "" : "is-empty"}`}>
        {existingPdfUrl ? (
          <a className="tv-cmsc-side-item tv-cmsc-pdf-tile" href={existingPdfUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="file-text" />
            <strong>View PDF</strong>
            <small>Stored</small>
          </a>
        ) : null}
        {sideImages.map((img, i) => (
          <div key={isFileSrc(img) ? `${img.name}-${img.lastModified}-${i}` : `${i}-${img.slice(-24)}`} className="tv-cmsc-side-item">
            <MediaImage src={img} alt={`Side image ${i + 1}`} />
            <button type="button" className="tv-cmsc-view" onClick={() => setView(img)} aria-label={`View side image ${i + 1}`}>
              <Icon name="eye" />
            </button>
            <button type="button" className="tv-cmsc-remove" onClick={() => setSideImages(sideImages.filter((_, j) => j !== i))} aria-label={`Remove side image ${i + 1}`}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
        {sideImages.length < 9 ? box : null}
      </div>
      {uploadOpen ? <UploadImagesDialog initial={sideImages} onSave={(files) => setSideImages(files.slice(0, 9))} onClose={() => setUploadOpen(false)} /> : null}
      {view ? <PreviewDialog src={view} title="Side image" onClose={() => setView(null)} /> : null}
    </>
  );
}
