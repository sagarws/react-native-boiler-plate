"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";

/** Drag-and-drop / click-to-pick file area. */
export function FileDrop({
  accept,
  multiple = false,
  onFiles,
  title = "Drop a file here or click to browse",
  hint,
  disabled,
}: {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={id}
      className={`tv-dropzone ${over ? "is-over" : ""}`.trim()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <Icon name="upload" />
      <strong>{title}</strong>
      {hint ? <small>{hint}</small> : null}
      <input
        ref={inputRef}
        id={id}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          if (files.length) onFiles(files);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}
