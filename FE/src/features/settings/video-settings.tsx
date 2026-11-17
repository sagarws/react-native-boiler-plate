"use client";

import { useEffect, useRef, useState } from "react";
import { SelectField } from "@/components/ui/form-field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { percentageOptions } from "@/config/constant";
import { errorMessage, toast } from "@/lib/events";
import { useAsync } from "@/lib/use-async";
import { AppSettingsService } from "@/services/app-settings";
import { UserService, type IAppVideoSettings } from "@/services/user-service";
import { Calculator } from "./calculator";
import { SettingsSection, useCanEditSettings } from "./settings-shared";

const SAVE_DEBOUNCE_MS = 1000;

async function saveVideoSettings(payload: IAppVideoSettings): Promise<void> {
  try {
    const res = await UserService.updateAppVideoSettings(payload);
    toast.success(res.message || "Settings updated successfully");
  } catch (err) {
    toast.error(errorMessage(err, "Something went wrong"));
  }
}

/**
 * TrackVid `components/settings/VideoSettings.tsx`: compression, storage duration, return condition
 * popup and auto-bookmark (left), storage pricing calculator (right). Changes save automatically
 * after one second without further edits.
 */
export function VideoSettings() {
  const canEdit = useCanEditSettings();
  const video = useAsync(() => UserService.getAppVideoSettings(), []);
  const appSettings = useAsync(() => AppSettingsService.getAppSettings(), []);
  const bookmark = useAsync(() => UserService.getAutoBookmarkVideoSettings(), []);

  const [form, setForm] = useState<IAppVideoSettings | null>(null);
  const [bookmarkOverride, setBookmarkOverride] = useState<boolean | null>(null);
  const debounce = useRef<{ timer: number | null; pending: IAppVideoSettings | null }>({ timer: null, pending: null });

  // Leaving the tab with an edit still waiting: cancel the timer and save it right away.
  useEffect(() => {
    const d = debounce.current;
    return () => {
      if (d.timer !== null) window.clearTimeout(d.timer);
      d.timer = null;
      if (d.pending) void saveVideoSettings(d.pending);
      d.pending = null;
    };
  }, []);

  const current = form ?? video.data;

  const handleChange = (next: IAppVideoSettings) => {
    setForm(next);
    const d = debounce.current;
    d.pending = next;
    if (d.timer !== null) window.clearTimeout(d.timer);
    d.timer = window.setTimeout(() => {
      d.timer = null;
      const payload = d.pending;
      d.pending = null;
      if (payload) void saveVideoSettings(payload);
    }, SAVE_DEBOUNCE_MS);
  };

  const autoBookmarkEnabled = bookmarkOverride ?? bookmark.data?.enabled ?? false;
  const updateAutoBookmark = async (enabled: boolean) => {
    const previous = autoBookmarkEnabled;
    setBookmarkOverride(enabled);
    try {
      const res = await UserService.updateAutoBookmarkVideoSettings({ enabled });
      toast.success(res.message || "Auto-bookmark settings updated successfully");
    } catch (err) {
      // Put the radio back: the server kept the old value.
      setBookmarkOverride(previous);
      toast.error(errorMessage(err, "Failed to update auto-bookmark settings"));
    }
  };

  let left;
  if (video.loading && !video.data) left = <LoadingState label="Loading video settings…" />;
  else if (video.error || !current) left = <ErrorState message={video.error} onRetry={video.reload} title="Could not load video settings" />;
  else {
    const popup = current.returnConditionPopup;
    left = (
      <div className="tv-stack">
        <SettingsSection icon="arrows-in" title="Video Compression Settings" description="What level of compression would you like to apply to all the recorded videos?">
          <SelectField
            label="Compression Percentage"
            name="company.compressPercentage"
            value={current.compressPercentage}
            options={percentageOptions}
            disabled={!canEdit}
            onChange={(e) => handleChange({ ...current, compressPercentage: e.currentTarget.value })}
          />
        </SettingsSection>

        <SettingsSection
          icon="database"
          title="Video Storage Settings"
          description={
            <>
              For how many days would you like to store all your recorded videos?
              <br />
              (Favorite videos will remain in the cloud until you un-mark them as favorites.)
            </>
          }
        >
          {appSettings.error ? (
            <ErrorState message={appSettings.error} onRetry={appSettings.reload} title="Could not load storage options" />
          ) : !appSettings.data ? (
            <LoadingState label="Loading storage options…" />
          ) : (
            <div className="tv-settings-radios" role="radiogroup" aria-label="Video storage duration">
              {appSettings.data.backupDurationRates.map((rate) => (
                <label key={rate.days} className="tv-check">
                  <input
                    type="radio"
                    name="backupDuration"
                    value={rate.days}
                    checked={current.backupDuration === rate.days}
                    disabled={!canEdit}
                    onChange={() => handleChange({ ...current, backupDuration: rate.days })}
                  />
                  {rate.days} days
                </label>
              ))}
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          icon="bell"
          title="Return Order Condition Popup"
          description="Enable / disable the return order condition popup and CMS-page redirection."
        >
          <div className="tv-stack tv-settings-checks">
            <label className="tv-check">
              <input
                type="checkbox"
                checked={popup.isShow}
                disabled={!canEdit}
                onChange={(e) => handleChange({ ...current, returnConditionPopup: { ...popup, isShow: e.currentTarget.checked } })}
              />
              Show Return Condition Popup
            </label>
            <label className="tv-check">
              <input
                type="checkbox"
                checked={popup.isShow ? popup.isRedirectOnBad : false}
                disabled={!canEdit || !popup.isShow}
                onChange={(e) => handleChange({ ...current, returnConditionPopup: { ...popup, isRedirectOnBad: e.currentTarget.checked } })}
              />
              Redirect to CMS page on Bad Condition
            </label>
          </div>
        </SettingsSection>

        <SettingsSection
          icon="star"
          title="Auto-Bookmark Forward Videos"
          description={'Auto-bookmark all forward parcel videos when the CMS / RMS status is "Pending" or "In Review"?'}
        >
          {bookmark.error ? (
            <ErrorState message={bookmark.error} onRetry={bookmark.reload} title="Failed to fetch auto-bookmark settings" />
          ) : bookmark.loading && !bookmark.data ? (
            <LoadingState label="Loading…" />
          ) : (
            <div className="tv-settings-radios" role="radiogroup" aria-label="Auto-bookmark forward videos">
              {[
                { v: true, text: "Yes" },
                { v: false, text: "No" },
              ].map(({ v, text }) => (
                <label key={text} className="tv-check">
                  <input
                    type="radio"
                    name="autoBookmark"
                    checked={autoBookmarkEnabled === v}
                    disabled={!canEdit}
                    onChange={() => void updateAutoBookmark(v)}
                  />
                  {text}
                </label>
              ))}
            </div>
          )}
        </SettingsSection>
      </div>
    );
  }

  return (
    <div className="tv-settings-split">
      <div>{left}</div>
      <div>
        <Calculator />
      </div>
    </div>
  );
}
