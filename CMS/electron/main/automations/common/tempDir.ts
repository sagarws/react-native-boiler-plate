import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'

/**
 * Runs `work` against a fresh temp directory and removes it afterwards.
 *
 * Every claim downloads customer photos and videos to disk before attaching
 * them. They are removed on every exit path, including a thrown error — this is
 * an operator's own machine, not a server, and the evidence is a customer's.
 */
export const withTempDir = async <T>(work: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), 'trackvid-claim-'))

  try {
    return await work(dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
