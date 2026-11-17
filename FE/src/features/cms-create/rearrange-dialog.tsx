"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { MediaImage, type MediaSrc } from "@/features/cms-create/media/media-thumb";

export interface ArrangementField {
  fieldName: string;
  label: string;
  position: "first" | "last" | "middle";
}

interface Slot {
  id: string;
  image: MediaSrc | null;
}

const toneOf = (p: ArrangementField["position"]) => (p === "first" ? "is-first" : p === "last" ? "is-last" : "is-middle");

function initialSlots(schema: ArrangementField[], images: MediaSrc[], initial?: Record<string, MediaSrc | null | undefined>): Slot[] {
  const first = schema.find((s) => s.position === "first");
  const last = schema.find((s) => s.position === "last");
  const middle = schema.filter((s) => s.position === "middle");
  const ordered: Slot[] = [...(first ? [first] : []), ...middle, ...(last ? [last] : [])].map((f) => ({ id: f.fieldName, image: null }));
  if (initial) {
    return ordered.map((slot) => ({ ...slot, image: initial[slot.id] ?? null }));
  }
  if (!images.length) return ordered;
  const set = (id: string | undefined, image: MediaSrc | undefined) => {
    const slot = ordered.find((s) => s.id === id);
    if (slot && image) slot.image = image;
  };
  set(first?.fieldName, images[0]);
  if (images.length > 1) set(last?.fieldName, images[images.length - 1]);
  if (images.length > 2) images.slice(1, -1).forEach((img, i) => set(middle[i]?.fieldName, img));
  else if (images.length === 2) set(middle[0]?.fieldName, images[1]);
  return ordered;
}

type Drag = { kind: "slot"; index: number } | { kind: "pool"; image: MediaSrc } | null;

/**
 * TrackVid `RearrangeModal`: drag VMS screenshots between the platform's named slots (first = green, last = red,
 * middle = blue), or from the "available" pool into a slot. Arrow buttons move a slot's image one place for
 * keyboard users. Save hands back one entry per slot in schema order ("" / null when empty).
 */
export function RearrangeDialog({
  onClose,
  onSave,
  images,
  schema,
  initialSlotImages,
  title = "Rearrange Screenshots",
}: {
  onClose: () => void;
  onSave: (arranged: (MediaSrc | null)[]) => void;
  images: MediaSrc[];
  schema: ArrangementField[];
  initialSlotImages?: Record<string, MediaSrc | null | undefined>;
  title?: string;
}) {
  const [slots, setSlots] = useState<Slot[]>(() => initialSlots(schema, images, initialSlotImages));
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<number | null>(null);

  const placed = new Set(slots.map((s) => s.image).filter((v): v is MediaSrc => v !== null));
  const available = images.filter((img) => img && !placed.has(img));

  const swap = (a: number, b: number) =>
    setSlots((prev) => {
      if (a < 0 || b < 0 || a >= prev.length || b >= prev.length) return prev;
      const next = prev.map((s) => ({ ...s }));
      const tmp = next[a].image;
      next[a].image = next[b].image;
      next[b].image = tmp;
      return next;
    });

  const dropOn = (index: number) => {
    if (!drag) return;
    if (drag.kind === "slot") swap(drag.index, index);
    else {
      setSlots((prev) => {
        const next = prev.map((s) => ({ ...s }));
        const source = next.findIndex((s) => s.image === drag.image);
        if (source !== -1) {
          next[source].image = next[index].image;
          next[index].image = drag.image;
        } else next[index].image = drag.image;
        return next;
      });
    }
    setDrag(null);
    setOver(null);
  };

  const clearSlot = (index: number) => setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, image: null } : s)));

  return (
    <AppDialog
      title={title}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <button type="button" className="secondary-button" onClick={() => setSlots(initialSlots(schema, images, initialSlotImages))}>
            Reset
          </button>
          <span className="tv-cmsc-grow" />
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              onSave(slots.map((s) => s.image));
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <p className="tv-muted">Drag and drop images between slots. You can place any image in any slot you want.</p>
      <div className="tv-cmsc-legend">
        {schema.map((f) => (
          <span key={f.fieldName} className={toneOf(f.position)}>
            <i />
            {f.label}
          </span>
        ))}
      </div>
      {available.length > 0 ? (
        <div className="tv-cmsc-pool">
          <span className="tv-small tv-muted">Available Images (drag to any slot):</span>
          <div className="tv-cmsc-pool-list">
            {available.map((img, i) => (
              <div
                key={`pool-${i}`}
                className={`tv-cmsc-pool-item ${drag?.kind === "pool" && drag.image === img ? "is-dragging" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", `pool:${i}`);
                  setDrag({ kind: "pool", image: img });
                }}
                onDragEnd={() => setDrag(null)}
              >
                <MediaImage src={img} alt={`Available ${i + 1}`} />
                <button
                  type="button"
                  className="tv-cmsc-pool-add"
                  aria-label={`Place available image ${i + 1} in the first empty slot`}
                  onClick={() =>
                    setSlots((prev) => {
                      const empty = prev.findIndex((s) => !s.image);
                      if (empty === -1) return prev;
                      return prev.map((s, j) => (j === empty ? { ...s, image: img } : s));
                    })
                  }
                >
                  <Icon name="plus" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {slots.length === 0 ? <p className="tv-muted">No slots configured</p> : null}
      <div className="tv-cmsc-slots">
        {slots.map((slot, index) => {
          const field = schema.find((f) => f.fieldName === slot.id);
          const tone = toneOf(field?.position ?? "middle");
          return (
            <div key={slot.id} className={`tv-cmsc-arrange ${tone}`}>
              <span className="tv-cmsc-arrange-label">{field?.label ?? slot.id}</span>
              <div
                className={`tv-cmsc-arrange-box ${slot.image ? "" : "is-empty"} ${over === index ? "is-over" : ""} ${drag?.kind === "slot" && drag.index === index ? "is-dragging" : ""}`}
                draggable={Boolean(slot.image)}
                onDragStart={(e) => {
                  if (!slot.image) return;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", `slot:${index}`);
                  setDrag({ kind: "slot", index });
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (drag) setOver(index);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dropOn(index);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
              >
                {slot.image ? (
                  <>
                    <MediaImage src={slot.image} alt={field?.label ?? "Slot image"} />
                    <span className="tv-cmsc-arrange-num">{index + 1}</span>
                    <span className="tv-cmsc-arrange-grip" aria-hidden="true">
                      <Icon name="drag-handle" />
                    </span>
                  </>
                ) : (
                  <span className="tv-cmsc-arrange-drop">
                    <Icon name="image" />
                    Drop here
                  </span>
                )}
              </div>
              <div className="tv-cmsc-arrange-actions">
                <button type="button" className="icon-button" disabled={index === 0 || !slot.image} onClick={() => swap(index, index - 1)} aria-label={`Move ${field?.label ?? "image"} earlier`}>
                  <Icon name="caret-left" />
                </button>
                <button type="button" className="icon-button" disabled={!slot.image} onClick={() => clearSlot(index)} aria-label={`Empty ${field?.label ?? "slot"}`}>
                  <Icon name="x" />
                </button>
                <button type="button" className="icon-button" disabled={index === slots.length - 1 || !slot.image} onClick={() => swap(index, index + 1)} aria-label={`Move ${field?.label ?? "image"} later`}>
                  <Icon name="caret-right" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </AppDialog>
  );
}
