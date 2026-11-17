"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  GENERIC_ERROR_MESSAGE,
  GOOGLE_DRIVE_CONNECTED_MESSAGE,
  GOOGLE_DRIVE_ERROR_MESSAGES,
  GOOGLE_DRIVE_GENERIC_ERROR,
  GOOGLE_DRIVE_QUERY_CONNECTED,
  GOOGLE_DRIVE_QUERY_ERROR,
} from "@/config/app-constant";
import { errorMessage, toast } from "@/lib/events";
import { useAsync } from "@/lib/use-async";
import { GoogleDriveService, MOCK_CONSENT_PREFIX } from "@/services/googleDrive-service";
import type { GoogleConsentResult } from "@/types/integrations";

/**
 * TrackVid `useGoogleDrive`: Drive connection state + connect (Google consent) + refresh. Also consumes
 * the `?driveConnected=` / `?driveError=` params the OAuth callback appends, toasts once, and strips them.
 * Must render inside <Suspense> (reads search params).
 */
export function useGoogleDrive() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: status, loading, error, reload, setData } = useAsync(() => GoogleDriveService.getStatus(), []);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  /** Callback URL while the (mocked) Google consent screen is open. */
  const [consentCallback, setConsentCallback] = useState<string | null>(null);
  const handledRef = useRef<string | null>(null);

  const search = searchParams.toString();
  useEffect(() => {
    const params = new URLSearchParams(search);
    const connected = params.get(GOOGLE_DRIVE_QUERY_CONNECTED);
    // Guard against the dev double-run toasting twice for the same redirect.
    if (connected === null || handledRef.current === search) return;
    handledRef.current = search;
    const code = params.get(GOOGLE_DRIVE_QUERY_ERROR);
    if (connected === "1") toast.success(GOOGLE_DRIVE_CONNECTED_MESSAGE);
    else toast.error((code && GOOGLE_DRIVE_ERROR_MESSAGES[code]) || GOOGLE_DRIVE_GENERIC_ERROR);
    params.delete(GOOGLE_DRIVE_QUERY_CONNECTED);
    params.delete(GOOGLE_DRIVE_QUERY_ERROR);
    const rest = params.toString();
    router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
    void Promise.resolve().then(reload);
  }, [search, pathname, router, reload]);

  /** TrackVid sends the browser to Google; the mock opens the consent dialog instead. */
  const connect = async () => {
    setConnecting(true);
    try {
      const callbackUrl = `${pathname}${search ? `?${search}` : ""}`;
      const { url } = await GoogleDriveService.getAuthUrl(callbackUrl);
      if (!url.startsWith(MOCK_CONSENT_PREFIX)) throw new Error(GOOGLE_DRIVE_GENERIC_ERROR);
      setConsentCallback(decodeURIComponent(url.slice(MOCK_CONSENT_PREFIX.length)));
    } catch (err) {
      toast.error(errorMessage(err, GENERIC_ERROR_MESSAGE));
    } finally {
      setConnecting(false);
    }
  };

  /** The consent screen answered (null = the user cancelled): navigate like the BE redirect would. */
  const finishConsent = async (result: GoogleConsentResult | null) => {
    if (!consentCallback) return;
    setConnecting(true);
    try {
      const next = await GoogleDriveService.completeConsent(consentCallback, result);
      setConsentCallback(null);
      router.replace(next, { scroll: false });
    } catch (err) {
      toast.error(errorMessage(err, GOOGLE_DRIVE_GENERIC_ERROR));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async (): Promise<boolean> => {
    setDisconnecting(true);
    try {
      await GoogleDriveService.disconnect();
      setData((prev) => ({ rootFolderName: prev?.rootFolderName ?? "", connected: false, status: "not_connected" }));
      return true;
    } catch (err) {
      toast.error(errorMessage(err, "Could not disconnect Google Drive."));
      return false;
    } finally {
      setDisconnecting(false);
    }
  };

  return {
    status,
    loading,
    error,
    connecting,
    disconnecting,
    consentOpen: consentCallback !== null,
    connect,
    finishConsent,
    cancelConsent: () => setConsentCallback(null),
    disconnect,
    refresh: reload,
  };
}
