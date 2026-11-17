"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { PasswordField } from "@/components/ui/form-field";
import { errorMessage, toast } from "@/lib/events";
import { UserService } from "@/services/user-service";
import { useDispatch, useSelector } from "@/store";
import { setUserProfile } from "@/store/profile-slice";

type Stage = "password" | "token";

/**
 * TrackVid `BaseIntegrationDialog`: confirm the account password, then save the Base Link Token on the
 * company (`company.baseLinkToken`). Mounted only while open, so every opening starts on the password step.
 */
export function BaseIntegrationDialog({ onClose }: { onClose: () => void }) {
  const dispatch = useDispatch();
  const userProfile = useSelector((s) => s.profile.userProfile);
  const hasExistingToken = Boolean(userProfile?.company.baseLinkToken);

  const [stage, setStage] = useState<Stage>("password");
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [token, setToken] = useState(userProfile?.company.baseLinkToken ?? "");
  const [tokenTouched, setTokenTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const passwordError = passwordTouched && !password ? "Password is required" : null;
  const tokenError = tokenTouched && !token.trim() ? "Base Link Token is required" : null;

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordTouched(true);
    if (!password) return;
    setSubmitting(true);
    try {
      const res = await UserService.checkPassword({ password });
      if (res.valid) setStage("token");
      else toast.error("Invalid password");
    } catch (err) {
      toast.error(errorMessage(err, "Invalid password"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitToken = async (e: FormEvent) => {
    e.preventDefault();
    setTokenTouched(true);
    if (!token.trim()) return;
    if (!userProfile) {
      toast.error("Profile not loaded yet");
      return;
    }
    setSubmitting(true);
    try {
      const user = await UserService.updateUser({ company: { ...userProfile.company, baseLinkToken: token.trim() } }, userProfile._id);
      dispatch(setUserProfile(user));
      toast.success(hasExistingToken ? "Base Link Token updated" : "Base.com connected successfully");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save Base Link Token"));
    } finally {
      setSubmitting(false);
    }
  };

  const header =
    stage === "password"
      ? { icon: "lock" as const, title: "Verify your password", description: "Confirm your account password to manage Base.com." }
      : {
          icon: "link" as const,
          title: hasExistingToken ? "Update Base Link Token" : "Connect Base.com",
          description: "The Base Link Token lets TrackVid surface video links inside your Base.com order rows.",
        };

  return (
    <AppDialog
      title={
        <span className="tv-int-dialog-head">
          <span className="icon-tile tile-blue">
            <Icon name={header.icon} />
          </span>
          <span className="tv-int-dialog-title">
            {header.title}
            <small>{header.description}</small>
          </span>
        </span>
      }
      onClose={onClose}
      locked={submitting}
    >
      {stage === "password" ? (
        <form className="tv-stack" onSubmit={(e) => void submitPassword(e)} noValidate>
          <PasswordField
            label="Password"
            placeholder="Enter your account password"
            autoFocus
            autoComplete="current-password"
            value={password}
            error={passwordError}
            onChange={(e) => setPassword(e.currentTarget.value)}
            onBlur={() => setPasswordTouched(true)}
          />
          <div className="tv-dialog-footer">
            <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? <span className="tv-spinner small" aria-hidden="true" /> : null}
              Continue
            </button>
          </div>
        </form>
      ) : (
        <form className="tv-stack" onSubmit={(e) => void submitToken(e)} noValidate>
          <PasswordField
            label="Base Link Token"
            placeholder="Paste your Base Link Token"
            autoFocus
            autoComplete="off"
            value={token}
            error={tokenError}
            hint="You can find this token inside your Base.com account settings."
            onChange={(e) => setToken(e.currentTarget.value)}
            onBlur={() => setTokenTouched(true)}
          />
          <div className="tv-dialog-footer">
            <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? <span className="tv-spinner small" aria-hidden="true" /> : null}
              {hasExistingToken ? "Update Token" : "Connect"}
            </button>
          </div>
        </form>
      )}
    </AppDialog>
  );
}
