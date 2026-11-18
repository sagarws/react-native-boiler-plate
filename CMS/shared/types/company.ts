/** The locally-held company document as the renderer receives it: secrets redacted. */
export interface CompanyDocumentView {
  /** ISO timestamp of the fetch that produced this copy. */
  fetchedAt: string
  /** The document, same shape as Mongo holds it, with secrets replaced. */
  document: Record<string, unknown>
  /**
   * Mongo's own version markers, lifted out so the card can show them.
   *
   * `__v` and `updatedAt` change on every write to the company, so comparing
   * them against the database answers "is this copy stale?" exactly, rather
   * than by scanning a tree for a field that looks different.
   */
  version: { v: number | null; updatedAt: string | null }
}
