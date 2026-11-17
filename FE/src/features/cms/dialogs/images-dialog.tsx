"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Carousel } from "@/components/ui/carousel";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { resolveFileUrl } from "@/features/cms/cms-files";
import { toast } from "@/lib/events";
import { useAsync } from "@/lib/use-async";

export interface LabelledImage {
  label: string;
  key: string;
}

/**
 * Prints the images one per page (browser "Save as PDF"). Replaces TrackVid's jsPDF
 * `createLabelledImagesPdf`: jspdf is not installed, so the PDF comes from the print dialog instead.
 */
function PrintImages({ title, images, onDone }: { title: string; images: readonly { src: string; label: string }[]; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const root = typeof document === "undefined" ? null : document.body;

  useEffect(() => {
    let active = true;
    const previousTitle = document.title;
    const restore = () => {
      document.title = previousTitle;
      if (active) onDone();
    };
    const imgs = Array.from(ref.current?.querySelectorAll("img") ?? []);
    Promise.all(
      imgs.map((img) =>
        img.decode().catch(() => {
          // An image that cannot decode still prints as a broken tile; never block the PDF on it.
        }),
      ),
    ).then(() => {
      if (!active) return;
      // The browser uses the document title as the suggested PDF file name.
      document.title = title;
      window.addEventListener("afterprint", restore, { once: true });
      window.print();
    });
    return () => {
      active = false;
      window.removeEventListener("afterprint", restore);
      document.title = previousTitle;
    };
  }, [title, onDone]);

  if (!root) return null;
  return createPortal(
    <div ref={ref} className="tv-cms-print" aria-hidden="true">
      {images.map((img, i) => (
        <figure key={`${img.src}-${i}`}>
          <img src={img.src} alt={img.label} />
          <figcaption>{img.label}</figcaption>
        </figure>
      ))}
    </div>,
    root,
  );
}

/** Labelled image viewer (carousel + thumbnails) with "Download PDF". Used by the Images and Six Side Images columns. */
export function ImagesDialog({ title, fileName, images, onClose }: { title: string; fileName: string; images: readonly LabelledImage[]; onClose: () => void }) {
  const keys = images.map((i) => i.key).join("|");
  const { data, loading, error, reload } = useAsync(() => Promise.all(images.map(async (img) => ({ src: await resolveFileUrl(img.key), label: img.label }))), [keys]);
  const [printing, setPrinting] = useState(false);
  const donePrinting = useCallback(() => setPrinting(false), []);

  return (
    <AppDialog
      title={title}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!data?.length || printing}
            onClick={() => {
              setPrinting(true);
              toast.info("Choose “Save as PDF” in the print dialog.");
            }}
          >
            {printing ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="download" />}
            {printing ? "Preparing…" : `Download PDF (${images.length})`}
          </button>
        </>
      }
    >
      {loading ? (
        <LoadingState label="Loading images…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data?.length ? (
        <div className="tv-stack">
          <Carousel images={data.map((d) => ({ src: d.src, alt: d.label }))} label={title} />
          <ul className="tv-cms-thumbs">
            {data.map((d, i) => (
              <li key={`${d.src}-${i}`}>
                <img src={d.src} alt="" />
                <span>{d.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="tv-muted">No images attached to this claim</p>
      )}
      {printing && data ? <PrintImages title={fileName} images={data} onDone={donePrinting} /> : null}
    </AppDialog>
  );
}
