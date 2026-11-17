"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "@/components/icons/icon";
import { errorMessage, toast } from "@/lib/events";
import { useDispatch } from "@/store";
import { setUserProfile } from "@/store/profile-slice";
import { AuthService } from "@/services/auth-service";
import { UserService } from "@/services/user-service";
import type { IUser } from "@/types/common";

/**
 * TrackVid `CompanyLogoUploader` + `uploadImg`: pick an image (not SVG), preview it locally, upload,
 * then refresh the profile. The preview is a local object URL, revoked when replaced or on unmount.
 */
export function CompanyLogoUploader({ user, disabled }: { user: IUser; disabled: boolean }) {
  const dispatch = useDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      setError("Please select a valid image file (jpg, png, gif).");
      return;
    }
    setError("");
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const uploaded = await AuthService.uploadFile(file);
      const updated = await UserService.updateUser({ company: { ...user.company, fileKey: uploaded.fileKey, fileName: uploaded.fileName } }, user._id);
      dispatch(setUserProfile(updated));
      toast.success("Image uploaded successfully");
    } catch (err) {
      // The earlier preview URL is already revoked; fall back to the saved logo.
      setPreview(null);
      toast.error(errorMessage(err, "Image upload failed"));
    } finally {
      setUploading(false);
    }
  };

  const src = preview ?? user.company.logo ?? null;

  return (
    <div className="tv-profile-logo">
      <button
        type="button"
        className="tv-profile-logo-pick"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        aria-label="Click the avatar to upload a new logo"
      >
        {uploading ? <span className="tv-spinner" aria-hidden="true" /> : src ? <img src={src} alt="Company logo" /> : <Icon name="building" />}
        {!uploading ? (
          <span className="tv-profile-logo-badge" aria-hidden="true">
            <Icon name="camera" />
          </span>
        ) : null}
      </button>
      <div>
        <span className="tv-profile-eyebrow">Company Logo</span>
        <strong>{disabled ? "Only users who can edit the profile can change the logo" : "Click the avatar to upload a new logo"}</strong>
        <small className="tv-muted">PNG or JPG · square images look best{user.company.fileName ? ` · current: ${user.company.fileName}` : ""}</small>
        {error ? (
          <span className="tv-field-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e)} />
    </div>
  );
}
