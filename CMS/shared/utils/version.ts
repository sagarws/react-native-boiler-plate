/**
 * Minimal semantic-version comparison.
 *
 * Hand-rolled rather than pulling in `semver`: the only thing this app compares
 * is its own `x.y.z` build number against the `trackVidCmsVersion` key stored in
 * appsettings, and the project rule is to prefer built-ins over a dependency.
 * Pre-release suffixes ("1.2.0-beta.1") are recognised and rank BELOW the same
 * release version, which matches semver ordering.
 */
const parse = (value: string): { core: number[]; pre: string } | null => {
  const trimmed = value.trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(trimmed)
  if (!match) return null

  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? ''
  }
}

/** Returns a negative number when `a` is older than `b`, 0 when equal, positive when newer. */
export const compareVersions = (a: string, b: string): number => {
  const left = parse(a)
  const right = parse(b)
  // An unparseable version is treated as equal so a malformed server value can
  // never nag every user with a phantom update.
  if (!left || !right) return 0

  for (let index = 0; index < 3; index += 1) {
    const diff = (left.core[index] ?? 0) - (right.core[index] ?? 0)
    if (diff !== 0) return diff
  }

  if (left.pre === right.pre) return 0
  // 1.2.0 > 1.2.0-beta.1: an absent pre-release always wins.
  if (left.pre === '') return 1
  if (right.pre === '') return -1
  return left.pre < right.pre ? -1 : 1
}

/** True when `latest` is strictly newer than `current`. */
export const isNewerVersion = (current: string, latest: string): boolean =>
  compareVersions(latest, current) > 0
