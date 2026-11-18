import { LOCAL_DB_CHANNELS } from '@shared/constants/channels'
import { fail, type Result } from '@shared/types/result'
import {
  deleteLocalRow,
  insertLocalRow,
  listLocalTables,
  readLocalTable,
  updateLocalRow
} from '../services/localDatabase.service'
import { getPreferences } from '../services/preferences.service'
import { registerHandler } from './handler'

/**
 * Developer mode only, checked here as well as in the rail: these read and
 * rewrite the app's own state files, and hiding the page is not the same as
 * refusing the call.
 */
const devOnly =
  <T>(handler: (payload: unknown) => Promise<Result<T>>) =>
  (payload: unknown): Promise<Result<T>> =>
    getPreferences().devMode
      ? handler(payload)
      : Promise.resolve(fail('VALIDATION_ERROR', 'Local Database is available in developer mode only.'))

export const registerLocalDatabaseIpc = (): void => {
  registerHandler(LOCAL_DB_CHANNELS.tables, devOnly(() => listLocalTables()))
  registerHandler(LOCAL_DB_CHANNELS.rows, devOnly(readLocalTable))
  registerHandler(LOCAL_DB_CHANNELS.updateRow, devOnly(updateLocalRow))
  registerHandler(LOCAL_DB_CHANNELS.deleteRow, devOnly(deleteLocalRow))
  registerHandler(LOCAL_DB_CHANNELS.insertRow, devOnly(insertLocalRow))
}
