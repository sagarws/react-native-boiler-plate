/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Background work of legacy src/MasterImportServer.ts (workers, v2 pipeline workers, cleanup
 * crons, WhatsApp workers). This process REPLACES the legacy MasterImportServer: never run both.
 * Mirror-tested against MasterImportServer.ts by test/e2e/legacy-background.spec.ts.
 */
export const startMasterImportServerBackground = async (): Promise<void> => {
  // side-effect worker imports of legacy MasterImportServer.ts
  require('@legacy/controllers/MasterImport/masterImportWorker');
  require('@legacy/controllers/MasterImport/orderDataImportWorker');
  require('@legacy/controllers/Imports/importWorker');
  require('@legacy/controllers/Imports/exportWorker');
  require('@legacy/controllers/ProductSkucodeMap/productSkucodeMapWorker');
  require('@legacy/controllers/WhatsappDataImport/whatsappDataImportWorker');
  const startWhatsAppMessageWorkers = require('@legacy/controllers/WhatsApp/whatsappMessageWorker').default;
  const { startGlobalCleanupCron } = require('@legacy/v2/masterImport/services/fileTracker.service');
  const { triggerDeferredFile } = require('@legacy/v2/masterImport/services/importPipeline.service');
  const { startGlobalCleanupCron: startMeeshoGlobalCleanupCron } = require('@legacy/v2/masterImport/services/meesho/meeshoFileTracker.service');
  const { startGlobalCleanupCron: startSnapdealGlobalCleanupCron } = require('@legacy/v2/masterImport/services/snapdeal/snapdealFileTracker.service');
  const { startGlobalCleanupCron: startMyntraGlobalCleanupCron } = require('@legacy/v2/masterImport/services/myntra/myntraFileTracker.service');
  const { runUploadsCleanupOnBoot, startUploadsCleanupInterval } = require('@legacy/utils/uploadsCleanup');

  // connectDB().then(...) in legacy, same order
  require('@legacy/v2/masterImport/workers/masterImportWorker.v2');
  require('@legacy/v2/masterImport/workers/orderDataWorker.v2');
  require('@legacy/v2/masterImport/workers/meeshoMasterImportWorker.v2');
  require('@legacy/v2/masterImport/workers/snapdealMasterImportWorker.v2');
  require('@legacy/v2/masterImport/workers/myntraMasterImportWorker.v2');
  startMeeshoGlobalCleanupCron();
  startSnapdealGlobalCleanupCron();
  startMyntraGlobalCleanupCron();
  startGlobalCleanupCron(triggerDeferredFile);
  runUploadsCleanupOnBoot();
  startUploadsCleanupInterval();
  await startWhatsAppMessageWorkers('master-import');
  console.log('[master-import-server] workers, pipeline workers and cleanup crons started in this process');
};
