/* eslint-disable @typescript-eslint/no-var-requires */
import type { Server } from 'http';

/**
 * Everything legacy src/server.ts runs besides HTTP routes: BullMQ workers, Socket.IO, crons,
 * schedulers. Phase 6 cutover: this process REPLACES the legacy main process.
 *
 *   LEGACY_BACKGROUND=on  → start all of it here.   ONLY after the legacy main process is stopped
 *   (default: off)          (same deploy step). Running both = every job and cron runs twice.
 *
 * Copied from legacy server.ts (pin d52efb6e); test/e2e/legacy-background.spec.ts fails if legacy
 * server.ts gains/loses a worker import or a cron schedule that is not mirrored here.
 */
export const isLegacyBackgroundOn = (): boolean => String(process.env.LEGACY_BACKGROUND || '').trim().toLowerCase() === 'on';

export const startLegacyBackground = (httpServer: Server): void => {
  // ---- workers (side-effect imports in legacy server.ts) ----
  require('@legacy/controllers/Imports/importWorker');
  require('@legacy/controllers/Imports/exportWorker');
  require('@legacy/controllers/MasterImport/masterImportExportWorker');
  require('@legacy/controllers/ProductSkucodeMap/productSkucodeMapWorker');
  require('@legacy/controllers/Order/syncOrder.worker');
  require('@legacy/utils/puppeteerForCms/worker');
  require('@legacy/utils/puppeteerForCms/masterImportWorker');
  require('@legacy/utils/googleDrive/cmsDriveWorker');
  // legacy main also runs this one implicitly (masterImportOrderReports.controller imports it);
  // with LEGACY_BACKGROUND=on the worker shim steps aside, so the real module loads here
  require('@legacy/controllers/MasterImport/masterImportWorker');

  const cron = require('node-cron');
  const { adjustCredits } = require('@legacy/utils/cronjob');
  const { startTATCronV2 } = require('@legacy/v2/masterImport/services/tatCron.service');
  const { initializeRealtime } = require('@legacy/services/realtime.service');
  const { scheduleDriveTrashPurge, scheduleEmailPolling, scheduleMyntraAutoClaim } = require('@legacy/workers/scheduler');
  const { cleanupResolvedSupportTickets } = require('@legacy/utils/supportRetention');
  const { reconcileStuckCloudVideos, countStuckCloudVideos } = require('@legacy/utils/stuckCloudVideoWatchdog');
  const { cleanupExpiredPacklogs } = require('@legacy/services/packlog.service');
  const { cleanupExpiredDriveWeekFolders } = require('@legacy/services/googleDriveAccount.service');

  // ---- after DB connect, in legacy order (notification stream + uploads cleanup: main.ts) ----
  // legacy config/db.ts runs migrations after connect in every legacy process
  require('./legacy-migrations').runLegacyMigrations();
  initializeRealtime(httpServer);
  scheduleEmailPolling();
  scheduleDriveTrashPurge();
  scheduleMyntraAutoClaim();

  // ---- crons (verbatim from legacy server.ts) ----
  // Adjust Credits cron - runs at midnight
  cron.schedule("0 0 * * *", async () => {
    console.log(`[Adjust Credits Cron Job Start] Running on end of day : ${new Date().toLocaleString()}`);
    try {
      await adjustCredits();
      console.log("[Adjust Credits Cron Job Success] Completed successfully.");
    } catch (error) {
      console.error("[Adjust Credits Cron Job Error]", error);
    }
  });

  // V2 TAT Cron - runs at 2 AM to auto-transition Return Created → Return Not Delivered
  startTATCronV2();

  // Stuck cloud-video watchdog - every 15 minutes.
  cron.schedule("*/15 * * * *", async () => {
    try {
      const summary = await reconcileStuckCloudVideos();
      const outstanding = await countStuckCloudVideos();   // -1 = could not measure
      if (summary.scanned > 0 || outstanding > 0) {
        console.log(
          `[Cloud Watchdog] scanned=${summary.scanned} repaired=${summary.repaired} ` +
          `retried=${summary.retried} failed=${summary.failed} (lost=${summary.lost}) ` +
          `errors=${summary.errors} | still stuck: ${outstanding < 0 ? "unmeasured" : outstanding}`
        );
      }
      if (outstanding > 100) {
        console.error(`[Cloud Watchdog] ALERT: ${outstanding} cloud videos stuck on "processing" — pipeline likely degraded.`);
      }
    } catch (error) {
      console.error("[Cloud Watchdog Error]", error);
    }
  });

  // Packlog retention - daily at 2:15 AM
  cron.schedule("15 2 * * *", async () => {
    console.log(`[Packlog Retention Cron Start] Running at 2:15 AM : ${new Date().toLocaleString()}`);
    try {
      const summary = await cleanupExpiredPacklogs();
      console.log(
        `[Packlog Retention Cron Success] scanned=${summary.scanned} s3Deleted=${summary.s3Deleted} ` +
        `s3Failed=${summary.s3Failed} deleted=${summary.deleted}`
      );
    } catch (error) {
      console.error("[Packlog Retention Cron Error]", error);
    }
  });

  // Scan & Pack Drive retention - daily at 2:20 AM
  cron.schedule("20 2 * * *", async () => {
    console.log(`[Drive Retention Cron Start] Running at 2:20 AM : ${new Date().toLocaleString()}`);
    try {
      const summary = await cleanupExpiredDriveWeekFolders();
      console.log(
        `[Drive Retention Cron Success] accounts=${summary.accounts} foldersDeleted=${summary.foldersDeleted} ` +
        `foldersFailed=${summary.foldersFailed} accountsSkipped=${summary.accountsSkipped}`
      );
    } catch (error) {
      console.error("[Drive Retention Cron Error]", error);
    }
  });

  // Support chat retention - runs daily at 2:30 AM, deletes resolved tickets >30 days old
  cron.schedule("30 2 * * *", async () => {
    console.log(`[Support Retention Cron Start] Running at 2:30 AM : ${new Date().toLocaleString()}`);
    try {
      const result = await cleanupResolvedSupportTickets();
      console.log(
        `[Support Retention Cron Success] Deleted ${result.deletedTickets} tickets, ${result.deletedMessages} messages, ${result.deletedAttachments} attachments (cutoff: ${result.cutoff.toISOString()}, attachment failures: ${result.attachmentFailures})`
      );
    } catch (error) {
      console.error("[Support Retention Cron Error]", error);
    }
  });

  console.log('[legacy-background] workers, Socket.IO, schedulers and crons started in this process');
};
