import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { DownloadedInstaller, InstallerCleanupResult } from '@shared/types/update'
import { fail, ok, type Result } from '@shared/types/result'
import { env } from '../config/env'
import { readCompany } from './company.store'
import { logger } from './logger'

/**
 * Old TrackVid CMS installers in the operator's Downloads folder.
 *
 * Every manual update leaves one behind — `TrackVid-CMS-x64-setup.exe`, then
 * `… (1).exe`, `… (2).exe` — so main.ts deletes them on every launch.
 *
 * THE NAME CHECK IS THE WHOLE SAFETY. Only `.exe` files directly in Downloads
 * (no subfolders) whose name holds "TrackVid" then "CMS", joined by nothing, a
 * space, a dot, a dash or an underscore.
 *
 * PERMANENT AND SILENT, by the operator's choice — no Recycle Bin, no prompt,
 * nothing on screen; only the log records it. An installer is always
 * downloadable again, which is what makes that acceptable, and why the name
 * check must never widen past installers.
 */
const INSTALLER_NAME = /trackvid[\s._-]*cms.*\.exe$/i

export const isCmsInstaller = (name: string): boolean => INSTALLER_NAME.test(name)

const downloadsDir = (): string => app.getPath('downloads')

const findInstallers = async (): Promise<DownloadedInstaller[]> => {
  const dir = downloadsDir()
  const entries = await readdir(dir, { withFileTypes: true })
  const found: DownloadedInstaller[] = []

  for (const entry of entries) {
    // isFile() is false for a symlink, so a link pointing elsewhere is skipped.
    if (!entry.isFile() || !isCmsInstaller(entry.name)) continue

    try {
      const { size } = await stat(join(dir, entry.name))

      found.push({ name: entry.name, bytes: size })
    } catch {
      /* gone between the listing and the stat — nothing to offer */
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name))
}

export const deleteDownloadedInstallers = async (): Promise<Result<InstallerCleanupResult>> => {
  let installers: DownloadedInstaller[]

  try {
    installers = await findInstallers()
  } catch (error) {
    logger.warn('[installer-cleanup] could not read the Downloads folder', error)

    return fail('INTERNAL_ERROR', 'Could not read the Downloads folder')
  }

  const result: InstallerCleanupResult = { removed: [], failed: [] }

  for (const installer of installers) {
    try {
      await unlink(join(downloadsDir(), installer.name))
      result.removed.push(installer)
    } catch (error) {
      // Usually an installer that is still running, which Windows keeps locked.
      result.failed.push({
        name: installer.name,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }

  logger.info(
    `[installer-cleanup] deleted ${result.removed.length} installer(s), ${result.failed.length} failed`
  )

  return ok(result)
}

const REPORT_TIMEOUT_MS = 10_000

const companyName = async (): Promise<string> => {
  try {
    const name = (await readCompany())?.company.name

    return typeof name === 'string' && name.trim() ? name.trim() : 'Unknown company'
  } catch {
    return 'Unknown company'
  }
}

/**
 * Records a cleanup on the report server (MAIN_VITE_INSTALLER_REPORT_URL):
 * which company, and how many installers went. Best-effort — a server that is
 * down or unconfigured only costs a log line, and nothing is retried.
 */
const reportCleanup = async (deletedCount: number): Promise<void> => {
  if (!env.installerReportUrl) return

  try {
    const response = await fetch(env.installerReportUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: await companyName(), deletedCount }),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS)
    })

    if (!response.ok) logger.warn(`[installer-cleanup] report refused: HTTP ${response.status}`)
  } catch (error) {
    logger.warn('[installer-cleanup] report not sent', error)
  }
}

/** On launch: delete the installers, then report once if any actually went. */
export const cleanUpInstallersAtLaunch = async (): Promise<void> => {
  const result = await deleteDownloadedInstallers()

  if (result.success && result.data.removed.length > 0) {
    await reportCleanup(result.data.removed.length)
  }
}
