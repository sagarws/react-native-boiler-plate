import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { CheckedReplyFile } from './ticketThread'

/**
 * A ticket reply's files, on disk for as long as `work` runs.
 *
 * Meesho's and Snapdeal's core uploads take a PATH — they stream the file into
 * the same multipart body the claim flow sends. The renderer hands over bytes,
 * so they are written to a private folder under the OS temp directory, named as
 * the operator named them (that name is what the portal shows), and the folder
 * is removed afterwards whatever happens.
 */
export const withReplyFilesOnDisk = async <T>(
  files: CheckedReplyFile[],
  work: (paths: { file: CheckedReplyFile; path: string }[]) => Promise<T>
): Promise<T> => {
  if (files.length === 0) return work([])

  const folder = await mkdtemp(path.join(app.getPath('temp'), 'trackvid-reply-'))

  try {
    const written = await Promise.all(
      files.map(async (file, index) => {
        // Its own sub-folder per file, so two files with one name cannot collide.
        const dir = path.join(folder, String(index))
        const target = path.join(dir, file.name)

        await mkdir(dir)
        await writeFile(target, file.data)

        return { file, path: target }
      })
    )

    return await work(written)
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
  }
}
