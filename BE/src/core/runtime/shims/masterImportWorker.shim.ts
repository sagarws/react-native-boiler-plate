import { MASTER_IMPORT_STATUS } from '@legacy/enum/common.enum';

/**
 * Stand-in for legacy `controllers/MasterImport/masterImportWorker.ts` inside the Nest app.
 *
 * The real file ends with `startWorker();` — loading it starts a BullMQ master-import Worker,
 * which the Nest app must never run (hard rule; workers move in Phase 6). Its only export used
 * outside the worker is `invalidTransitions` (by masterImportOrderReports.controller.ts), so the
 * Nest process gets these constants instead of the worker (see ./index.ts).
 * Copied verbatim; test/e2e/worker-shims.spec.ts fails if they drift from the legacy file.
 * The user decided (2026-11-17) not to change the legacy project, so this replaces option (a).
 */
export const IMPORT_PLATFORM = { AJIO: 'AJIO', MYNTRA: 'MYNTRA', MEESHO: 'MEESHO', OTHER: 'OTHER' };

export const invalidTransitions = {
  [MASTER_IMPORT_STATUS.CANCELLED]: [
    MASTER_IMPORT_STATUS.SHIPPED,
    MASTER_IMPORT_STATUS.RETURN_CREATED,
    MASTER_IMPORT_STATUS.RETURN_CANCELLED,
    MASTER_IMPORT_STATUS.RETURN_DELIVERED,
    MASTER_IMPORT_STATUS.RETURN_NOT_DELIVERED,
    MASTER_IMPORT_STATUS.RETURN_DISPUTE,
    MASTER_IMPORT_STATUS.CANCELLED,
  ],
  [MASTER_IMPORT_STATUS.RETURN_CANCELLED]: [
    MASTER_IMPORT_STATUS.SHIPPED,
    MASTER_IMPORT_STATUS.CANCELLED,
    MASTER_IMPORT_STATUS.RETURN_CREATED,
    MASTER_IMPORT_STATUS.RETURN_DELIVERED,
    MASTER_IMPORT_STATUS.RETURN_NOT_DELIVERED,
    MASTER_IMPORT_STATUS.RETURN_DISPUTE,
    MASTER_IMPORT_STATUS.RETURN_CANCELLED,
  ],
  [MASTER_IMPORT_STATUS.RETURN_CREATED]: [MASTER_IMPORT_STATUS.SHIPPED, MASTER_IMPORT_STATUS.CANCELLED, MASTER_IMPORT_STATUS.RETURN_CREATED],
  [MASTER_IMPORT_STATUS.RETURN_DELIVERED]: [
    MASTER_IMPORT_STATUS.SHIPPED,
    MASTER_IMPORT_STATUS.CANCELLED,
    MASTER_IMPORT_STATUS.RETURN_CREATED,
    MASTER_IMPORT_STATUS.RETURN_CANCELLED,
    MASTER_IMPORT_STATUS.RETURN_DELIVERED,
  ],
  [MASTER_IMPORT_STATUS.RETURN_NOT_DELIVERED]: [
    MASTER_IMPORT_STATUS.SHIPPED,
    MASTER_IMPORT_STATUS.CANCELLED,
    MASTER_IMPORT_STATUS.RETURN_CREATED,
    MASTER_IMPORT_STATUS.RETURN_CANCELLED,
    MASTER_IMPORT_STATUS.RETURN_DELIVERED,
    MASTER_IMPORT_STATUS.RETURN_NOT_DELIVERED,
  ],
  [MASTER_IMPORT_STATUS.RETURN_DISPUTE]: [
    MASTER_IMPORT_STATUS.SHIPPED,
    MASTER_IMPORT_STATUS.CANCELLED,
    MASTER_IMPORT_STATUS.RETURN_CREATED,
    MASTER_IMPORT_STATUS.RETURN_CANCELLED,
    MASTER_IMPORT_STATUS.RETURN_DELIVERED,
    MASTER_IMPORT_STATUS.RETURN_NOT_DELIVERED,
  ],
};

/** The real default export starts the worker; here it is a no-op that says so. */
const startWorker = async (): Promise<void> => {
  console.warn('[worker-shim] masterImportWorker is not started in the Nest app (Phase 6)');
};
export default startWorker;
