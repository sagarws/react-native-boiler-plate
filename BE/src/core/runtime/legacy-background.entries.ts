/**
 * COMPILE-ONLY. Never import this file at runtime: loading it would start every legacy worker.
 * legacy-background.ts loads these modules lazily with require(); TypeScript only compiles (and
 * tsc-alias only rewrites) legacy files reachable through static imports, so they are listed here
 * to make the build emit them into dist/legacy. Guarded by test/e2e/legacy-background.spec.ts.
 */
import '@legacy/controllers/Imports/exportWorker';
import '@legacy/controllers/Imports/importWorker';
import '@legacy/controllers/MasterImport/masterImportExportWorker';
import '@legacy/controllers/MasterImport/masterImportWorker';
import '@legacy/controllers/MasterImport/orderDataImportWorker';
import '@legacy/controllers/Order/syncOrder.worker';
import '@legacy/controllers/ProductSkucodeMap/productSkucodeMapWorker';
import '@legacy/controllers/WhatsApp/whatsappMessageWorker';
import '@legacy/controllers/WhatsappDataImport/whatsappDataImportWorker';
import '@legacy/migrations/migration';
import '@legacy/services/googleDriveAccount.service';
import '@legacy/services/packlog.service';
import '@legacy/services/realtime.service';
import '@legacy/utils/cronjob';
import '@legacy/utils/googleDrive/cmsDriveWorker';
import '@legacy/utils/puppeteerForCms/masterImportWorker';
import '@legacy/utils/puppeteerForCms/worker';
import '@legacy/utils/stuckCloudVideoWatchdog';
import '@legacy/utils/supportRetention';
import '@legacy/utils/uploadsCleanup';
import '@legacy/v2/masterImport/services/fileTracker.service';
import '@legacy/v2/masterImport/services/importPipeline.service';
import '@legacy/v2/masterImport/services/meesho/meeshoFileTracker.service';
import '@legacy/v2/masterImport/services/myntra/myntraFileTracker.service';
import '@legacy/v2/masterImport/services/snapdeal/snapdealFileTracker.service';
import '@legacy/v2/masterImport/services/tatCron.service';
import '@legacy/v2/masterImport/workers/masterImportWorker.v2';
import '@legacy/v2/masterImport/workers/meeshoMasterImportWorker.v2';
import '@legacy/v2/masterImport/workers/myntraMasterImportWorker.v2';
import '@legacy/v2/masterImport/workers/orderDataWorker.v2';
import '@legacy/v2/masterImport/workers/snapdealMasterImportWorker.v2';
import '@legacy/workers/scheduler';
