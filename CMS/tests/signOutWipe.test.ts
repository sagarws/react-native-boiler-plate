import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Signing out forgets this machine's copy of everything — except the AJIO and
 * Snapdeal master-data backups.
 *
 * TWO HALVES, and both matter. The company document, the captured sessions and
 * the refused-session verdicts are one operator's to take with them; leaving
 * them for whoever signs in next is the failure this exists to stop. The
 * backups are the opposite case: they are the marketplaces' own reports,
 * gathered a few days at a time because those windows move on, and the months
 * already past cannot be fetched again. Deleting them costs claims that can no
 * longer be argued.
 *
 * The keep list is therefore EXPLICIT and narrow, and everything else goes —
 * including a store nobody remembered to name, because data left behind after
 * somebody asked for it to be gone is the worse way to be wrong.
 */

const directory = { path: '' }

/** Whether the scheduler's in-memory log was asked to forget itself. */
const cleared = vi.hoisted(() => ({ log: false }))

vi.mock('electron', () => ({ app: { getPath: () => directory.path } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/database', () => ({ dataDirectory: () => join(directory.path, 'data') }))
vi.mock('@main/services/cronLog.store', () => ({
  clearCronLog: () => {
    cleared.log = true

    return Promise.resolve()
  }
}))

const { clearLocalData, isKeptOnSignOut } = await import('@main/services/localData.service')
const { JsonCollection } = await import('@main/database/jsonStore')

beforeAll(async () => {
  directory.path = await mkdtemp(join(tmpdir(), 'trackvid-signout-'))
})

afterAll(async () => {
  await rm(directory.path, { recursive: true, force: true })
})

const dataDir = (): string => join(directory.path, 'data')

const store = async (name: string, rows: unknown[]): Promise<void> => {
  const collection = new JsonCollection({ name, directory: dataDir() })

  await collection.mutate(() => ({ records: rows, result: undefined }))
}

beforeEach(async () => {
  await rm(dataDir(), { recursive: true, force: true })
  await mkdir(dataDir(), { recursive: true })
})

describe('what a sign-out keeps', () => {
  it('keeps the AJIO backup: its settings, its index and every month of rows', () => {
    expect(isKeptOnSignOut('ajio-backup-settings')).toBe(true)
    expect(isKeptOnSignOut('ajio-backup-index')).toBe(true)
    expect(isKeptOnSignOut('ajio-backup-forward-2026-09')).toBe(true)
    expect(isKeptOnSignOut('ajio-backup-return-2025-12')).toBe(true)
  })

  it('keeps the Snapdeal backup: its settings, its index and its one table of rows', () => {
    expect(isKeptOnSignOut('snapdeal-backup-settings')).toBe(true)
    expect(isKeptOnSignOut('snapdeal-backup-index')).toBe(true)
    expect(isKeptOnSignOut('snapdeal-backup-return')).toBe(true)
  })

  it('still keeps the per-month files, for the sign-out before the migration runs', () => {
    /*
     * The rows move into one table at startup. A machine that signs out before
     * it has next launched still has the old files on disk, and dropping the
     * pattern would wipe the months on exactly that one sign-out.
     */
    expect(isKeptOnSignOut('snapdeal-backup-return-2026-09')).toBe(true)
  })

  it('keeps the Snapdeal REQUEST table, which is data rather than history', () => {
    /*
     * Snapdeal builds a report over minutes, and this table is the only record
     * of what has been asked for. Lose it beside rows that survive and the
     * next pass re-requests every window already held — dozens of report
     * builds queued for data sitting on the disk in front of it — while the
     * request calendar reads empty next to a green data calendar.
     */
    expect(isKeptOnSignOut('snapdeal-backup-requests')).toBe(true)
  })

  it('does not keep either backup’s JOB history, which is only this machine’s activity', () => {
    expect(isKeptOnSignOut('ajio-backup-jobs')).toBe(false)
    expect(isKeptOnSignOut('snapdeal-backup-jobs')).toBe(false)
  })

  it('keeps nothing else, however it is named', () => {
    for (const name of [
      'company',
      'platform-sessions',
      'session-rejections',
      'claim-queue',
      'offline-cache',
      'refill-jobs',
      'automation-schedule',
      // Named like a backup file but belonging to neither — the keep list is
      // two marketplaces, not a prefix anybody can opt into.
      'meesho-backup-settings',
      'backup-settings',
      'ajio-backup',
      'snapdeal-backup',
      // A month partition with a malformed stamp. It goes: a name the pattern
      // cannot vouch for is not a file worth keeping somebody's data in.
      'snapdeal-backup-return-2026-9',
      // A store that does not exist yet. It goes, because the alternative is
      // one operator's data surviving on a machine they signed out of.
      'something-added-next-year'
    ]) {
      expect(isKeptOnSignOut(name), name).toBe(false)
    }
  })
})

describe('signing out', () => {
  it('empties the company data and leaves both backups intact', async () => {
    await store('company', [{ secret: 'marketplace password' }])
    await store('session-rejections', [{ key: 'flipkart:a@x.com' }])
    await store('ajio-backup-forward-2026-09', [{ awb: 'VLR123' }])
    await store('ajio-backup-settings', [{ account: 'info@tigc.in' }])
    await store('snapdeal-backup-return', [{ subOrderCode: '74216331124' }])
    await store('snapdeal-backup-settings', [{ username: 'online1@wrogn.com' }])
    await store('snapdeal-backup-requests', [{ id: 'a', from: '2026-09-05', to: '2026-10-03' }])
    // The run histories go with everything else.
    await store('ajio-backup-jobs', [{ jobId: 'one' }])
    await store('snapdeal-backup-jobs', [{ jobId: 'two' }])

    await clearLocalData()

    const read = async (name: string): Promise<unknown[]> =>
      new JsonCollection({ name, directory: dataDir() }).read()

    expect(await read('company')).toEqual([])
    expect(await read('session-rejections')).toEqual([])
    expect(await read('ajio-backup-forward-2026-09')).toEqual([{ awb: 'VLR123' }])
    expect(await read('ajio-backup-settings')).toEqual([{ account: 'info@tigc.in' }])
    expect(await read('snapdeal-backup-return')).toEqual([{ subOrderCode: '74216331124' }])
    expect(await read('snapdeal-backup-settings')).toEqual([{ username: 'online1@wrogn.com' }])
    expect(await read('snapdeal-backup-requests')).toEqual([
      { id: 'a', from: '2026-09-05', to: '2026-10-03' }
    ])
    expect(await read('ajio-backup-jobs')).toEqual([])
    expect(await read('snapdeal-backup-jobs')).toEqual([])
  })

  it('leaves a backup file behind that THIS run never opened', async () => {
    /*
     * THE OTHER HALF OF THE SWEEP. `clearCollections` only reaches stores this
     * process has constructed; the directory sweep that follows deletes
     * everything else by filename. A machine that signed out without ever
     * opening the Snapdeal card has no collection object for its months — so
     * the sweep is the code path that would delete them, and it has to honour
     * the same keep list.
     */
    await writeFile(join(dataDir(), 'snapdeal-backup-return.json'), '[{"subOrderCode":"1"}]', 'utf8')
    await writeFile(join(dataDir(), 'ajio-backup-return-2025-12.json'), '[{"awb":"X"}]', 'utf8')

    await clearLocalData()

    const left = await readdir(dataDir())

    expect(left).toContain('snapdeal-backup-return.json')
    expect(left).toContain('ajio-backup-return-2025-12.json')
  })

  it('removes a file left by a run that is no longer open', async () => {
    // A store this process never touched has no object to clear, and its file
    // would otherwise outlive the sign-out.
    await writeFile(join(dataDir(), 'bulk-spf-jobs.json'), '[{"awb":"VLR999"}]', 'utf8')

    await clearLocalData()

    expect(await readdir(dataDir())).not.toContain('bulk-spf-jobs.json')
  })

  it('takes the bulk claim’s report files with it', async () => {
    const reports = join(directory.path, 'bulk-spf')

    await store('company', [{ any: 'thing' }])
    await writeFile(join(dataDir(), 'keep-me-out-of-the-way.json'), '[]', 'utf8')
    await rm(reports, { recursive: true, force: true })

    await clearLocalData()

    await expect(readdir(reports)).rejects.toThrow()
  })
})

describe("the scheduler's own history", () => {
  it('clears every cron history file', async () => {
    /*
     * One collection per task, so a keep-list that named them individually
     * would be four chances to forget one. They are cleared because they are
     * not KEPT, which is the right way round: leaving a previous operator's
     * run history behind is the failure, and the AJIO backup is the only
     * exception anybody has argued for.
     */
    const data = join(directory.path, 'data')

    await mkdir(data, { recursive: true })

    for (const name of [
      'cron-history-session-refresh',
      'cron-history-ajio-master-data',
      'cron-history-refill-data',
      'cron-history-auto-claim',
      'cron-activity-log'
    ]) {
      expect(isKeptOnSignOut(name), `${name} would survive a sign-out`).toBe(false)
      await writeFile(join(data, `${name}.json`), '[{"id":"x"}]', 'utf8')
    }

    await clearLocalData()

    const left = (await readdir(data)).filter(entry => entry.startsWith('cron-'))

    expect(left).toEqual([])
  })

  it('also clears the copy the scheduler keeps in memory', async () => {
    /*
     * THE HALF THE FILES DO NOT COVER. The activity log is held in this process
     * as well as on disk — that is how it works at all with developer mode off.
     * Clearing the collections deals with the file and leaves four hundred
     * lines of the previous operator's activity in memory, ready for whoever
     * signs in next to read in the Automation log.
     */
    cleared.log = false

    await clearLocalData()

    expect(cleared.log).toBe(true)
  })
})
