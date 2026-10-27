import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/shared/utils';
import {
  driveRepository,
  ROOT_FOLDER_NAME,
  toDriveError,
} from '../repository/drive.repository';
import { pickFile } from '../services/filePicker.service';
import { googleAccountService } from '../services/googleAccount.service';
import type {
  DriveErrorCode,
  DriveFolder,
  DriveItem,
  DriveSource,
} from '../types';

export type BrowserStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UploadState {
  name: string;
  /** 0..1 */
  progress: number;
}

export interface UseFileBrowser {
  status: BrowserStatus;
  error: DriveErrorCode | null;
  /** Google's own explanation for [error], or ''. */
  errorDetail: string;
  /** Asks Google for Drive access (personal account), then reloads. */
  grantAccess: () => Promise<void>;
  /** Breadcrumb from the Akshar folder down to the open folder. */
  path: DriveFolder[];
  folders: DriveItem[];
  files: DriveItem[];
  upload: UploadState | null;
  /** Id of the item an action is running on. */
  busyId: string | null;
  refresh: () => void;
  openFolder: (folder: DriveItem) => void;
  /** Jumps to a breadcrumb entry. */
  goTo: (index: number) => void;
  createFolder: (name: string) => Promise<boolean>;
  /** Picks a file and uploads it to the open folder; false if nothing was uploaded. */
  pickAndUpload: (description: string) => Promise<boolean>;
  setDescription: (item: DriveItem, description: string) => Promise<boolean>;
  trash: (item: DriveItem) => Promise<boolean>;
  /** Makes the file viewable by link; resolves the link, or null on failure. */
  share: (item: DriveItem) => Promise<string | null>;
}

/**
 * Breadcrumb name for the start folder. The shared Drive's start folder is
 * labelled by the UI (translated), so it carries no name here.
 */
const startName = (source: DriveSource) =>
  source.kind === 'account' ? ROOT_FOLDER_NAME : '';

/**
 * File Share state: browsing the start folder of [source] (the account's
 * "Akshar" folder, or the shared Drive's folder), uploading, describing,
 * sharing and trashing files. [onSignedOut] runs when Drive says a personal
 * account is no longer connected.
 */
export function useFileBrowser(
  source: DriveSource | null,
  onSignedOut: () => void,
): UseFileBrowser {
  const [status, setStatus] = useState<BrowserStatus>('idle');
  const [error, setErrorCode] = useState<DriveErrorCode | null>(null);
  const [errorDetail, setErrorDetail] = useState('');
  const setError = useCallback((code: DriveErrorCode | null) => {
    setErrorCode(code);
    if (!code) setErrorDetail('');
  }, []);
  const [path, setPath] = useState<DriveFolder[]>([]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fail = useCallback(
    (raw: unknown) => {
      const e = toDriveError(raw);
      setErrorDetail(e.detail);
      if (e.code === 'not_connected' && source?.kind === 'account')
        onSignedOut();
      if (e.code === 'unknown')
        logger.error('files: Drive operation failed', raw);
      return e.code;
    },
    [onSignedOut, source?.kind],
  );

  const load = useCallback(
    async (folderPath: DriveFolder[]) => {
      const gen = ++generation.current;
      const folder = folderPath[folderPath.length - 1];
      if (!folder) return;
      setStatus('loading');
      setError(null);
      try {
        const next = await driveRepository.list(folder.id);
        if (!mounted.current || gen !== generation.current) return;
        setItems(next);
        setStatus('ready');
      } catch (raw) {
        if (!mounted.current || gen !== generation.current) return;
        setError(fail(raw));
        setStatus('error');
      }
    },
    [fail, setError],
  );

  const sourceKey = source
    ? source.kind === 'account'
      ? `account:${source.email}`
      : `shared:${source.folderId}`
    : '';

  // (Re)start at the source's start folder whenever the source changes.
  useEffect(() => {
    generation.current++;
    setItems([]);
    setPath([]);
    setError(null);
    if (!source) {
      setStatus('idle');
      return;
    }
    const gen = generation.current;
    setStatus('loading');
    driveRepository
      .startFolder(source)
      .then(id => {
        if (!mounted.current || gen !== generation.current) return;
        const start = [{ id, name: startName(source) }];
        setPath(start);
        void load(start);
      })
      .catch(raw => {
        if (!mounted.current || gen !== generation.current) return;
        setError(fail(raw));
        setStatus('error');
      });
    // load/fail are stable per source; sourceKey captures the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const refresh = useCallback(() => {
    if (path.length) void load(path);
    else if (source) {
      // The start folder itself failed: retry from the top.
      setStatus('loading');
      driveRepository
        .startFolder(source)
        .then(id => {
          const start = [{ id, name: startName(source) }];
          setPath(start);
          return load(start);
        })
        .catch(raw => {
          setError(fail(raw));
          setStatus('error');
        });
    }
  }, [source, fail, load, path, setError]);

  const openFolder = useCallback(
    (folder: DriveItem) => {
      const next = [...path, { id: folder.id, name: folder.name }];
      setPath(next);
      void load(next);
    },
    [load, path],
  );

  const goTo = useCallback(
    (index: number) => {
      const next = path.slice(0, index + 1);
      setPath(next);
      void load(next);
    },
    [load, path],
  );

  const current = path[path.length - 1];

  const createFolder = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!current || !trimmed) return false;
      try {
        const folder = await driveRepository.createFolder(
          current.id,
          trimmed.slice(0, 100),
        );
        if (mounted.current) setItems(prev => [folder, ...prev]);
        return true;
      } catch (raw) {
        if (mounted.current) setError(fail(raw));
        return false;
      }
    },
    [current, fail, setError],
  );

  const pickAndUpload = useCallback(
    async (description: string) => {
      if (!current || upload) return false;
      let picked;
      try {
        picked = await pickFile();
      } catch {
        if (mounted.current) setError('unknown');
        return false;
      }
      if (!picked) return false;
      setUpload({ name: picked.name, progress: 0 });
      setError(null);
      try {
        const created = await driveRepository.upload(
          current.id,
          picked,
          description.trim().slice(0, 500),
          progress =>
            mounted.current && setUpload({ name: picked.name, progress }),
        );
        if (mounted.current)
          setItems(prev => [
            ...prev.filter(i => i.isFolder),
            created,
            ...prev.filter(i => !i.isFolder),
          ]);
        return true;
      } catch (raw) {
        if (mounted.current) setError(fail(raw));
        return false;
      } finally {
        if (mounted.current) setUpload(null);
      }
    },
    [current, fail, setError, upload],
  );

  const replace = (updated: DriveItem) =>
    setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)));

  const run = useCallback(
    async <T>(item: DriveItem, work: () => Promise<T>): Promise<T | null> => {
      setBusyId(item.id);
      setError(null);
      try {
        return await work();
      } catch (raw) {
        if (mounted.current) setError(fail(raw));
        return null;
      } finally {
        if (mounted.current) setBusyId(null);
      }
    },
    [fail, setError],
  );

  const setDescription = useCallback(
    async (item: DriveItem, description: string) => {
      const updated = await run(item, () =>
        driveRepository.setDescription(
          item.id,
          description.trim().slice(0, 500),
        ),
      );
      if (updated && mounted.current) replace(updated);
      return updated !== null;
    },
    [run],
  );

  const trash = useCallback(
    async (item: DriveItem) => {
      const done = await run(item, async () => {
        await driveRepository.trash(item.id);
        return true;
      });
      if (done && mounted.current)
        setItems(prev => prev.filter(i => i.id !== item.id));
      return done === true;
    },
    [run],
  );

  const share = useCallback(
    async (item: DriveItem) => {
      const link = await run(item, () => driveRepository.share(item.id));
      if (link && mounted.current)
        replace({ ...item, shared: true, webViewLink: link });
      return link;
    },
    [run],
  );

  const grantAccess = useCallback(async () => {
    if (await googleAccountService.grantDriveAccess()) refresh();
  }, [refresh]);

  return {
    status,
    error,
    errorDetail,
    grantAccess,
    path,
    folders: items.filter(i => i.isFolder),
    files: items.filter(i => !i.isFolder),
    upload,
    busyId,
    refresh,
    openFolder,
    goTo,
    createFolder,
    pickAndUpload,
    setDescription,
    trash,
    share,
  };
}
