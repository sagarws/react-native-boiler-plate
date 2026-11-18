import { LOCAL_DB_CHANNELS } from '@shared/constants/channels'
import type {
  LocalRowDelete,
  LocalRowInsert,
  LocalRowUpdate,
  LocalTable,
  LocalTablePage,
  LocalTableQuery
} from '@shared/types/localDatabase'
import type { Result } from '@shared/types/result'
import { invoke } from './ipcClient'

/** Renderer-side wrapper over the Local Database channels. */

export const listLocalTables = (): Promise<Result<LocalTable[]>> =>
  invoke<LocalTable[]>(LOCAL_DB_CHANNELS.tables)

export const readLocalTable = (query: LocalTableQuery): Promise<Result<LocalTablePage>> =>
  invoke<LocalTablePage>(LOCAL_DB_CHANNELS.rows, query)

export const updateLocalRow = (edit: LocalRowUpdate): Promise<Result<true>> =>
  invoke<true>(LOCAL_DB_CHANNELS.updateRow, edit)

export const deleteLocalRow = (edit: LocalRowDelete): Promise<Result<true>> =>
  invoke<true>(LOCAL_DB_CHANNELS.deleteRow, edit)

export const insertLocalRow = (edit: LocalRowInsert): Promise<Result<true>> =>
  invoke<true>(LOCAL_DB_CHANNELS.insertRow, edit)
