"use client";

import { useState, type FormEvent } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { PasswordField, TextField } from "@/components/ui/form-field";
import { errorMessage, toast } from "@/lib/events";
import { useSelector } from "@/store";
import { FeedService, RTSP_URL_RE } from "@/services/feed-service";
import type { FeedCameraType, IFeed } from "@/types/feed";

interface Values {
  feedName: string;
  cameraType: FeedCameraType;
  rtspURL: string;
  onvif_username: string;
  onvif_password: string;
  onvif_ip: string;
}

/** TrackVid `feedValidation` (yup): feed name required, 2–30 characters. */
function feedNameError(name: string): string | undefined {
  const v = name.trim();
  if (!v) return "Feed Name is required.";
  if (v.length < 2) return "Feed Name is too short!";
  if (v.length > 30) return "Feed Name is too long!";
  return undefined;
}

/** TrackVid `AddFeedForm` submit checks for RTSP feeds (shown in the error banner, first failure wins). */
function rtspError(v: Values): string | null {
  if (v.cameraType !== "rtsp") return null;
  if (!v.rtspURL) return "RTSP URL is required.";
  if (!RTSP_URL_RE.test(v.rtspURL)) return "RTSP URL is invalid.";
  if (v.onvif_username || v.onvif_password || v.onvif_ip) {
    if (!v.onvif_username) return "ONVIF Username is required.";
    if (!v.onvif_password) return "ONVIF Password is required.";
    if (!v.onvif_ip) return "ONVIF IP is required.";
  }
  return null;
}

function FeedTypeOption({
  active,
  icon,
  label,
  description,
  onSelect,
}: {
  active: boolean;
  icon: IconName;
  label: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button type="button" role="radio" aria-checked={active} className={`tv-feed-type ${active ? "is-active" : ""}`.trim()} onClick={onSelect}>
      <span className="tv-feed-type-icon">
        <Icon name={icon} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </button>
  );
}

/** TrackVid `components/Feed/AddFeedForm.tsx`: add or edit a Web Cam / RTSP feed. */
export function FeedFormDialog({ feed, onClose, onSaved }: { feed: IFeed | null; onClose: () => void; onSaved: () => void }) {
  const me = useSelector((s) => s.profile.userProfile);
  const isEdit = Boolean(feed);
  const [values, setValues] = useState<Values>({
    feedName: feed?.feedName ?? "",
    cameraType: feed?.cameraType === "rtsp" ? "rtsp" : "web_cam",
    rtspURL: feed?.rtspURL ?? "",
    onvif_username: feed?.onvif_username ?? "",
    onvif_password: feed?.onvif_password ?? "",
    onvif_ip: feed?.onvif_ip ?? "",
  });
  const [nameTouched, setNameTouched] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const nameError = nameTouched ? feedNameError(values.feedName) : undefined;

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNameTouched(true);
    if (feedNameError(values.feedName)) return;
    const rtsp = rtspError(values);
    if (rtsp) {
      setFormError(rtsp);
      return;
    }
    if (!me) return;
    setSaving(true);
    try {
      const res = await FeedService.addUpdateFeed({
        ...values,
        feedName: values.feedName.trim(),
        feedId: feed?._id,
        user_id: me._id,
        companyId: me.companyId,
      });
      toast.success(res.message);
      setFormError("");
      onSaved();
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDialog
      locked={saving}
      onClose={onClose}
      title={
        <span className="tv-feed-dialog-title">
          {isEdit ? "Edit Feed" : "Add Feed"}
          <small>{isEdit ? "Update feed details" : "Configure a new camera feed"}</small>
        </span>
      }
    >
      <form className="tv-stack" onSubmit={submit} noValidate>
        {formError ? (
          <Banner tone="error" onDismiss={() => setFormError("")}>
            {formError}
          </Banner>
        ) : null}

        <section>
          <h3 className="tv-feed-section-label">Feed Type</h3>
          <div className="tv-feed-types" role="radiogroup" aria-label="Feed type">
            <FeedTypeOption active={values.cameraType === "web_cam"} icon="video-camera" label="Web Cam" description="Browser-based camera" onSelect={() => set("cameraType", "web_cam")} />
            <FeedTypeOption active={values.cameraType === "rtsp"} icon="globe" label="RTSP" description="IP / network camera" onSelect={() => set("cameraType", "rtsp")} />
          </div>
        </section>

        <section>
          <h3 className="tv-feed-section-label">Feed Details</h3>
          <div className="c-form-grid">
            <TextField
              label="Feed Name"
              required
              full
              maxLength={30}
              value={values.feedName}
              error={nameError}
              onChange={(e) => set("feedName", e.currentTarget.value)}
              onBlur={() => setNameTouched(true)}
            />
          </div>
        </section>

        {values.cameraType === "rtsp" ? (
          <>
            <section>
              <h3 className="tv-feed-section-label">RTSP Stream</h3>
              <div className="c-form-grid">
                <TextField
                  label="RTSP URL"
                  required
                  full
                  placeholder="rtsp://user:pass@192.168.0.10:554/stream"
                  value={values.rtspURL}
                  onChange={(e) => set("rtspURL", e.currentTarget.value)}
                />
              </div>
            </section>
            <section>
              <h3 className="tv-feed-section-label">ONVIF Credentials (Optional)</h3>
              <div className="c-form-grid">
                <TextField label="Username" autoComplete="off" value={values.onvif_username} onChange={(e) => set("onvif_username", e.currentTarget.value)} />
                <PasswordField label="Password" autoComplete="new-password" value={values.onvif_password} onChange={(e) => set("onvif_password", e.currentTarget.value)} />
                <TextField label="IP Address" full placeholder="192.168.0.10" value={values.onvif_ip} onChange={(e) => set("onvif_ip", e.currentTarget.value)} />
              </div>
            </section>
          </>
        ) : null}

        <div className="tv-dialog-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {isEdit ? "Save Changes" : "Add Feed"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
