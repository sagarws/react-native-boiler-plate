/**
 * The parts of an AJIO subject that tell one request from another.
 *
 * AJIO writes "CCTV FOOTAGE REQUIRED||INC0011…||RT2337…||DV0035…" — the first
 * segment is on every row and says nothing. A subject in any other shape is
 * shown whole rather than guessed at.
 */
export const requestIds = (subject: string): string[] => {
  const parts = subject
    .split('||')
    .map(part => part.trim())
    .filter(part => part !== '' && !/cctv\s+footage\s+required/i.test(part))

  return parts.length > 0 ? parts : [subject]
}
