import { NYKAA_BULK_DDR_CHANNELS } from '@shared/constants/channels'
import {
  chooseDdrFile,
  ddrRunStatus,
  downloadDdrTemplate,
  openDdrReport,
  retryDdrRun,
  startDdrRun
} from '../services/nykaaBulkDdr.service'
import { registerHandler } from './handler'

export const registerNykaaBulkDdrIpc = (): void => {
  registerHandler(NYKAA_BULK_DDR_CHANNELS.chooseFile, () => chooseDdrFile())
  registerHandler(NYKAA_BULK_DDR_CHANNELS.downloadTemplate, () => downloadDdrTemplate())
  // `{ upload }` — only a path this session's file dialog returned is accepted.
  registerHandler(NYKAA_BULK_DDR_CHANNELS.start, startDdrRun)
  registerHandler(NYKAA_BULK_DDR_CHANNELS.retry, () => retryDdrRun())
  registerHandler(NYKAA_BULK_DDR_CHANNELS.status, () => ddrRunStatus())
  registerHandler(NYKAA_BULK_DDR_CHANNELS.openReport, () => openDdrReport())
}
