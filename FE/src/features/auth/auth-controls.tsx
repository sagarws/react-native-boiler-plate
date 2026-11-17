"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";

/** Full-width primary submit with TrackVid's `ButtonElement loading` spinner. */
export function SubmitButton({ loading, disabled, children }: { loading: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="submit" className="primary-button" disabled={loading || disabled} aria-busy={loading}>
      {loading ? <span className="tv-spinner small" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/**
 * TrackVid `CompanyLogoUploader` (compact): round avatar that opens a file picker. Rejects SVG and non-images
 * before anything is uploaded. Keyboard: Enter / Space opens the picker.
 */
export function CompanyLogoUploader({
  imageUrl,
  onChange,
  isLoading,
  helperText = "Add your company logo (optional)",
}: {
  imageUrl: string;
  onChange: (file: File) => void;
  isLoading: boolean;
  helperText?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const openPicker = () => inputRef.current?.click();

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      setError("Please select a valid image file (jpg, png, gif).");
      input.value = "";
      return;
    }
    setError("");
    onChange(file);
    input.value = "";
  };

  return (
    <div className="tv-auth-logo">
      <div
        className="tv-auth-logo-picker"
        role="button"
        tabIndex={0}
        aria-label={helperText}
        title={helperText}
        aria-busy={isLoading}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
      >
        {isLoading ? (
          <span className="tv-spinner small" aria-hidden="true" />
        ) : imageUrl ? (
          <img src={imageUrl} alt="Company logo preview" />
        ) : (
          <Icon name="building" />
        )}
        {!isLoading ? (
          <span className="tv-auth-logo-badge" aria-hidden="true">
            <Icon name="camera" />
          </span>
        ) : null}
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleFile} />
      </div>
      {error ? (
        <span className="tv-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
