import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  DRIVE_NOT_CONFIGURED,
  driveCredentialsService,
  type DriveCredentialStatus,
} from '@/features/capture';

export interface UseSharedDrive {
  status: DriveCredentialStatus;
  /** False until the stored status has been read once. */
  loaded: boolean;
  refresh: () => void;
}

/**
 * The shared Google Drive set in Settings → File Management. Re-read when
 * the screen regains focus, so values changed in Settings apply on return.
 */
export function useSharedDrive(): UseSharedDrive {
  const [status, setStatus] =
    useState<DriveCredentialStatus>(DRIVE_NOT_CONFIGURED);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    void driveCredentialsService.getStatus().then(next => {
      if (!mounted.current) return;
      setStatus(next);
      setLoaded(true);
    });
  }, []);

  useFocusEffect(refresh);

  return { status, loaded, refresh };
}
