/** A Snapdeal or Flipkart backup written to a zip in Downloads. */
export interface BackupArchiveExport {
  path: string
  files: number
  rows: number
  months: number
  bytes: number
}

/** A zip merged back in. Rows already held are skipped, never doubled. */
export interface BackupArchiveImport {
  path: string
  added: number
  /** Rows already held whose blank fields the import filled in. */
  updated: number
  skipped: number
  /** Month files that could not be read. */
  failed: number
  months: number
}
