/**
 * Identifying a native executable from its leading bytes.
 *
 * Exists so the app can tell "ffmpeg is missing" apart from "ffmpeg is for the
 * wrong operating system" - the second happens whenever an installer is built
 * on a different OS than it targets, and spawn() reports it with a message
 * ("%1 is not a valid Win32 application", ENOEXEC) that names neither the file
 * nor the real cause.
 *
 * Pure, so the mapping can be tested without a filesystem or an Electron app.
 *
 * Typed against Uint8Array and a plain string rather than Buffer and
 * NodeJS.Platform: this file is compiled into the renderer as well, and that
 * tsconfig has no Node types. A Buffer is a Uint8Array, so main-process callers
 * pass one unchanged.
 */

export type BinaryFormat = 'pe' | 'macho' | 'elf' | 'unknown'

/** The format a native executable takes on each platform we ship to. */
const EXPECTED: Record<string, BinaryFormat> = {
  win32: 'pe',
  darwin: 'macho',
  linux: 'elf'
}

/** Human name for the OS a given format belongs to, for error messages. */
export const formatOsName = (format: BinaryFormat): string =>
  format === 'pe'
    ? 'Windows'
    : format === 'macho'
      ? 'macOS'
      : format === 'elf'
        ? 'Linux'
        : 'an unrecognised platform'

export const expectedFormatFor = (platform: string): BinaryFormat | null =>
  EXPECTED[platform] ?? null

/**
 * Reads the executable format from the first four bytes of a file.
 *
 * Returns 'unknown' rather than throwing on a short or unrecognised header: an
 * unfamiliar binary is not itself proof of a problem, and the caller only
 * treats a DEFINITE mismatch as fatal.
 */
export const detectBinaryFormat = (head: Uint8Array): BinaryFormat => {
  if (head.length < 4) return 'unknown'

  // "MZ" - DOS header, present on every Windows PE executable.
  if (head[0] === 0x4d && head[1] === 0x5a) return 'pe'
  // 0x7F "ELF".
  if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return 'elf'


  // Mach-O, in its 32/64-bit and byte-swapped spellings, plus the "cafebabe"
  // universal-binary wrapper a macOS fat build uses.
  // Big-endian read by hand: Uint8Array has no readUInt32BE, and pulling in
  // Buffer here would drag Node types into the renderer build. The ?? 0 keeps
  // noUncheckedIndexedAccess happy; the length check above already guarantees
  // all four bytes are present.
  const byte = (index: number): number => head[index] ?? 0
  const magic = ((byte(0) << 24) >>> 0) + (byte(1) << 16) + (byte(2) << 8) + byte(3)
  if (
    magic === 0xfeedface ||
    magic === 0xfeedfacf ||
    magic === 0xcefaedfe ||
    magic === 0xcffaedfe ||
    magic === 0xcafebabe
  ) {
    return 'macho'
  }

  return 'unknown'
}

/**
 * True only when the file is definitely built for a different OS. An 'unknown'
 * format, or a platform with no expectation recorded, is given the benefit of
 * the doubt - refusing to spawn a binary that might work is worse than letting
 * spawn fail on its own.
 */
export const isForeignBinary = (format: BinaryFormat, platform: string): boolean => {
  const expected = expectedFormatFor(platform)
  if (!expected || format === 'unknown') return false
  return format !== expected
}
