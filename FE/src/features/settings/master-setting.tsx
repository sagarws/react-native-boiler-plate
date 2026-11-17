"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/states";
import { errorMessage, toast } from "@/lib/events";
import { tatMasterSettingService } from "@/services/tatMasterSetting-service";
import { useDispatch, useSelector } from "@/store";
import { getUserProfile } from "@/store/profile-slice";
import type { IEcommerce } from "@/types/common";
import { DaysRow, SettingsSection, YesNoToggle } from "./settings-shared";

/**
 * TrackVid `components/common/MasterSetting.tsx`: Master Data on / off for the company, and the
 * per-platform TAT period (days) while it is on. TAT edits are saved with the Ecommerce Claims "Save".
 */
export function MasterSetting({
  platforms,
  onTatPeriodChange,
  canEdit,
}: {
  platforms: readonly IEcommerce[];
  onTatPeriodChange: (id: string, value: number) => void;
  canEdit: boolean;
}) {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.profile.userProfile);
  const [override, setOverride] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const isMasterData = override ?? Boolean(user?.company.settings.isUsingMasterData);

  const handleToggle = async (next: boolean) => {
    // The endpoint flips the flag, so clicking the option that is already active must not call it.
    if (next === isMasterData || loading) return;
    const companyId = user?.companyId;
    if (!companyId) return;
    setOverride(next);
    setLoading(true);
    try {
      const res = await tatMasterSettingService.MasterDataActiveOrNot(companyId);
      if (res.isSuccess) toast.success(res.displayMessage);
      else {
        toast.error(res.displayMessage);
        setOverride(!next);
      }
    } catch (err) {
      setOverride(!next);
      toast.error(errorMessage(err, "Failed to update Master Data"));
    } finally {
      setLoading(false);
    }
    void dispatch(getUserProfile());
  };

  return (
    <SettingsSection
      icon="database"
      title="Master Data"
      description="Use centrally managed credentials and TAT periods across the workspace. Manage marketplace accounts from the Integrations page."
      action={
        <div className="tv-row">
          {loading ? <Spinner label="Updating Master Data" /> : null}
          <YesNoToggle label="Use Master Data" value={isMasterData} onChange={(v) => void handleToggle(v)} disabled={loading || !canEdit} />
        </div>
      }
    >
      {isMasterData ? (
        <div className="tv-stack">
          <h3 className="tv-settings-subtitle">TAT Period (in days)</h3>
          {platforms.length === 0 ? (
            <div className="tv-settings-empty">No platforms configured yet.</div>
          ) : (
            <div className="tv-settings-days-grid">
              {platforms.map((p, i) => (
                <DaysRow
                  key={p._id ?? `new-${i}`}
                  name={p.name || `Platform ${i + 1}`}
                  inputName="tatPeriod"
                  value={p.tatPeriod}
                  disabled={!canEdit || !p._id}
                  onChange={(value) => {
                    if (p._id) onTatPeriodChange(p._id, value);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ) : undefined}
    </SettingsSection>
  );
}
